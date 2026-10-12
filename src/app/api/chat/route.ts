// The only OpenAI touchpoint in this app, and the first backend route this
// repo has ever had — see architecture doc §3/§4/§5. Every retrieval tool
// call forwards the REQUESTING USER'S OWN Bearer + X-QB-Id headers to the
// Savetrix backend; there is no separate/service credential, so the
// backend's existing per-company authorization is what scopes every answer.
//
// Uses the official `openai` Node SDK, which needs the Node runtime (not
// Edge) — see architecture doc §4.6.
export const runtime = "nodejs";
// Vercel plan's exact function-duration ceiling wasn't confirmed against the
// dashboard (see architecture doc §4.6 — "confirm rather than assume").
// 60s comfortably covers a multi-tool-call turn on today's usage; revisit if
// tool calls start timing out in production.
export const maxDuration = 60;

import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { RunnableToolFunctionWithParse } from "openai/lib/RunnableFunction";

import { randomUUID } from "node:crypto";

import { resolveChatUser } from "@/lib/chatHistory/identity";
import { ConsumedOperations } from "@/lib/chatbot/consent";
import { CONFIRM_MARKER, CONSENT_FRAME_PREFIX, CONSENT_FRAME_SUFFIX } from "@/lib/chatbot/confirmMarker";
import { chatToolSchemas } from "@/lib/chatbot/toolSchemas";
import { buildSystemPrompt, CHAT_MODEL } from "@/lib/chatbot/systemPrompt";
import { callTool, TOOL_NAMES } from "@/lib/chatbot/tools";
import { PROVIDERS } from "@/lib/accountingProvider";

const MAX_HISTORY_MESSAGES = 20;
const MAX_OUTPUT_TOKENS = 1000;

// The exact-phrase instruction behind CONFIRM_MARKER ("repeat this sentence
// verbatim") turns out to sometimes make the model repeat ITSELF — confirmed
// live: a single completion (no tool call, no second round involved) can
// stream the same confirmation paragraph, or just the marker line, twice in
// a row. Since a legitimate confirmation message should only ever end with
// this sentence once, cutting everything after the first occurrence is a
// safe, deterministic backstop regardless of why the repeat happened.
function truncateAfterFirstConfirmMarker(text: string): string {
  const firstEnd = text.indexOf(CONFIRM_MARKER);
  if (firstEnd === -1) return text;
  const secondStart = text.indexOf(CONFIRM_MARKER, firstEnd + CONFIRM_MARKER.length);
  if (secondStart === -1) return text;
  return text.slice(0, firstEnd + CONFIRM_MARKER.length);
}
const MAX_TOOL_ROUNDTRIPS = 6;

interface ChatRequestMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequestBody {
  message: string;
  history?: ChatRequestMessage[];
  companyName?: string;
  /** Display name of the active company's accounting software (validated below). */
  providerName?: string;
  /**
   * Set by the client only when the human accepted the confirmation dialog
   * immediately before this turn. This — not the model's own `confirm: true`
   * argument — is what authorizes a destructive tool (see callTool).
   */
  userConfirmed?: boolean;
  /**
   * Consent ticket the client received out of band when confirmation was
   * requested, echoed back on the turn where the user accepted the dialog.
   */
  confirmationToken?: string;
}

// Best-effort, single-instance-only rate limit — see architecture doc §7.11.
// This does NOT hold across serverless instances/regions; it only bounds
// abuse that lands repeatedly on the same warm instance. A real per-user
// cap needs a shared store (e.g. Redis) and is called out as an open
// question (§9) for whoever owns the rate-limit budget.
//
// Keyed on the VERIFIED user id, not the raw bearer token: keying on the
// token let anyone mint a fresh bucket per request by varying a string they
// chose themselves, which made the cap meaningless against the case it
// exists for. It also kept live credentials in instance memory.
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const requestTimestamps = new Map<string, number[]>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const timestamps = (requestTimestamps.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  requestTimestamps.set(key, timestamps);
  return timestamps.length > RATE_LIMIT_MAX_REQUESTS;
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("authorization");
  const accessToken = authHeader?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  // Reject if the Bearer token is missing — this must be sent explicitly by
  // the client on every request. Route Handlers run server-side and have no
  // access to the browser's localStorage, so there's no accessToken to read
  // here even if we wanted to (architecture doc §4.2).
  if (!accessToken) {
    return Response.json({ error: "Missing Authorization header." }, { status: 401 });
  }

  const qbConnectionId = request.headers.get("x-qb-id")?.trim();
  // A missing QB connection means "user hasn't connected QuickBooks yet" —
  // every retrieval tool needs this header (architecture doc §4.2).
  if (!qbConnectionId) {
    return Response.json({ error: "Missing X-QB-Id header. Connect an accounting company first." }, { status: 400 });
  }

  // Until now this route only checked that an Authorization header EXISTED —
  // any string ran a full OpenAI completion before the first tool call failed,
  // making /api/chat an unauthenticated inference proxy billed to us. The
  // history routes already verified properly; this brings chat in line with
  // them (src/lib/chatHistory/apiAuth.ts).
  const identity = await resolveChatUser(accessToken);
  if (identity.kind === "unauthenticated") {
    return Response.json({ error: "Session expired. Please sign in again." }, { status: 401 });
  }
  if (identity.kind === "unavailable") {
    console.log("[chat] identity unavailable:", identity.reason);
    return Response.json({ error: "Chat is temporarily unavailable. Please try again." }, { status: 503 });
  }

  if (isRateLimited(identity.userId)) {
    return Response.json({ error: "Too many requests. Please slow down." }, { status: 429 });
  }

  if (!process.env.OPENAI_API_KEY) {
    return Response.json({ error: "Chat is not configured on this server." }, { status: 500 });
  }

  let body: ChatRequestBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  if (!body?.message || typeof body.message !== "string") {
    return Response.json({ error: "Missing message." }, { status: 400 });
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const history = Array.isArray(body.history) ? body.history.slice(-MAX_HISTORY_MESSAGES) : [];
  const messages: ChatCompletionMessageParam[] = [
    // Client-supplied and it lands in the system prompt — only known names pass.
    {
      role: "system",
      content: buildSystemPrompt(
        body.companyName,
        Object.values(PROVIDERS).some((p) => p.name === body.providerName) ? body.providerName : undefined,
      ),
    },
    ...history.map((m): ChatCompletionMessageParam => ({ role: m.role, content: m.content })),
    { role: "user", content: body.message },
  ];

  // Identifies this HTTP request for consent-ticket binding: a ticket minted
  // while serving a request is refused within that same request, so the model
  // cannot mint one and immediately spend it (see lib/chatbot/consent.ts).
  const requestId = randomUUID();
  const consumed = new ConsumedOperations();
  const pendingTickets: string[] = [];

  // Every tool call closes over THIS request's accessToken/qbConnectionId —
  // never a shared/service credential (architecture doc §5, §7.3).
  const tools: RunnableToolFunctionWithParse<Record<string, unknown>, unknown>[] = chatToolSchemas.map((tool) => ({
    type: "function",
    function: {
      name: tool.function.name,
      description: tool.function.description ?? "",
      parameters: tool.function.parameters ?? {},
      parse: (input: string) => {
        try {
          return JSON.parse(input);
        } catch {
          return {};
        }
      },
      function: (args: Record<string, unknown>) => {
        if (!TOOL_NAMES.includes(tool.function.name as (typeof TOOL_NAMES)[number])) {
          return { error: `Unknown tool: ${tool.function.name}` };
        }
        return callTool(tool.function.name, args, accessToken, qbConnectionId, {
          userConfirmed: body.userConfirmed === true,
          requestId,
          consumed,
          confirmedTicket: typeof body.confirmationToken === "string" ? body.confirmationToken : undefined,
          pendingTickets,
        });
      },
    },
  }));

  const runner = openai.chat.completions.runTools(
    {
      model: CHAT_MODEL,
      max_completion_tokens: MAX_OUTPUT_TOKENS,
      messages,
      stream: true,
      tools,
    },
    { maxChatCompletions: MAX_TOOL_ROUNDTRIPS },
  );

  const encoder = new TextEncoder();
  let streamErrored = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Buffer each completion round's text instead of streaming it live, and
      // only flush once a round turns out to be the final one (no
      // tool_calls) — a round that also calls a tool gets its buffered text
      // discarded, guarding against a round's text being superseded by a
      // later, redundant tool-calling round (a multi-round turn can have a
      // round that writes visible text alongside a further tool call).
      //
      // Separately — confirmed live, not hypothetical — a SINGLE completion
      // with no tool call at all can still repeat itself: gpt-5.4-mini's
      // "repeat this exact sentence" instruction (CONFIRM_MARKER) sometimes
      // makes it stream the confirmation paragraph, or just the marker line,
      // twice in a row within one round. truncateAfterFirstConfirmMarker
      // catches that case at flush time regardless of round structure.
      let roundBuffer = "";
      let emittedAnything = false;

      runner.on("content", (delta) => {
        roundBuffer += delta;
      });
      runner.on("message", (message) => {
        if (message.role !== "assistant") return;
        if (message.tool_calls?.length) {
          roundBuffer = "";
          return;
        }
        if (roundBuffer) {
          controller.enqueue(encoder.encode(truncateAfterFirstConfirmMarker(roundBuffer)));
          emittedAnything = true;
        }
        roundBuffer = "";
      });
      // Structural logging only — never log full message/tool payloads,
      // which can include invoice/banking data (architecture doc §5).
      runner.on("functionToolCall", (call) => {
        console.log("[chat] tool call:", call.name);
      });
      runner.on("error", (error) => {
        streamErrored = true;
        console.log("[chat] stream error:", error?.name, error?.message);
        controller.error(error);
      });
      runner
        .done()
        .then(() => {
          if (streamErrored) return;
          // runTools() stops after maxChatCompletions rounds by simply
          // RETURNING — it does not throw (verified in the SDK's
          // AbstractChatCompletionRunner). So a turn where every round called
          // a tool ends with zero bytes written, and the user is left staring
          // at an empty assistant bubble even though tool calls, possibly
          // including writes, already ran. Say so instead of showing nothing.
          if (!emittedAnything) {
            controller.enqueue(
              encoder.encode(
                "I wasn't able to finish that request — it needed more steps than I'm allowed to take in one go. " +
                  "Some of those steps may already have run, so please check the relevant invoice or vendor before retrying.",
              ),
            );
          }
          // Hand the client the ticket for the operation the user is being
          // asked about. It travels outside the model's context on purpose —
          // the client stores it and returns it with the confirming turn, so
          // the write that runs is provably the one the dialog described.
          if (pendingTickets.length > 0) {
            controller.enqueue(
              encoder.encode(`${CONSENT_FRAME_PREFIX}${pendingTickets[0]}${CONSENT_FRAME_SUFFIX}`),
            );
          }
          controller.close();
        })
        .catch(() => {
          // Already surfaced via the 'error' listener above.
        });
    },
    cancel() {
      runner.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
