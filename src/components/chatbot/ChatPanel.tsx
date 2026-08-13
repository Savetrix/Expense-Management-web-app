"use client";

import { ArrowLeft, History, Plus, Puzzle, Send, Sparkles, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";

import { ChatHistoryList } from "@/components/chatbot/ChatHistoryList";
import { ChatMessage } from "@/components/chatbot/ChatMessage";
import { ChatQuickActions } from "@/components/chatbot/ChatQuickActions";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { CONFIRM_MARKER, CONSENT_FRAME_PREFIX, CONSENT_FRAME_SUFFIX } from "@/lib/chatbot/confirmMarker";
import { confirmDialog } from "@/lib/dialogManager";
import { SESSION_EXPIRED, sessionEmitter } from "@/lib/sessionManager";
import { deleteConversation, fetchConversations, openConversation, saveCurrentConversation } from "@/store/chat/chatApi";
import {
  appendAssistantChunk,
  sendMessage,
  startAssistantMessage,
  startNewConversation,
  streamCompleted,
  streamFailed,
} from "@/store/chat/chatSlice";
import { useAppDispatch, useAppSelector } from "@/store/hooks";

let nextMessageId = 0;
const newMessageId = () => `chat-${Date.now()}-${++nextMessageId}`;

type View = "chat" | "history";

// The server appends the consent ticket as a U+001F-delimited control frame
// after the assistant's text (see /api/chat). It must never be rendered.
const CONSENT_FRAME_RE = new RegExp(`${CONSENT_FRAME_PREFIX}([^${CONSENT_FRAME_SUFFIX}]*)${CONSENT_FRAME_SUFFIX}`);

function extractConsentTicket(text: string): string | undefined {
  return CONSENT_FRAME_RE.exec(text)?.[1] || undefined;
}

function stripConsentFrame(text: string): string {
  // Removes a complete frame, and also any dangling prefix from a chunk that
  // split mid-frame.
  return text.replace(CONSENT_FRAME_RE, "").split(CONSENT_FRAME_PREFIX)[0];
}

export function ChatPanel({ companyName, onClose }: { companyName?: string; onClose: () => void }) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const accessToken: string | undefined = useAppSelector((state) => state.auth.user?.data?.accessToken);
  const qbConnectionId = useAppSelector((state) => state.quickBooks.qbConnectionId);
  const messages = useAppSelector((state) => state.chat.messages);
  const status = useAppSelector((state) => state.chat.status);
  const error = useAppSelector((state) => state.chat.error);
  const conversations = useAppSelector((state) => state.chat.conversations);
  const historyStatus = useAppSelector((state) => state.chat.historyStatus);
  const historyError = useAppSelector((state) => state.chat.historyError);
  const openError = useAppSelector((state) => state.chat.openError);

  const [input, setInput] = useState("");
  const [view, setView] = useState<View>("chat");
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // sendText() can be re-invoked from handlePendingConfirmation() well after
  // the render that created its closure (it awaits a real user click on the
  // confirm dialog) — reading `messages` straight from that stale closure
  // would build history missing the very turn that's still in flight. This
  // ref always holds the latest committed messages for that re-entrant call.
  const messagesRef = useRef(messages);

  const streaming = status === "streaming";

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  const loadHistory = useCallback(() => {
    if (!accessToken || !qbConnectionId) return;
    dispatch(fetchConversations());
  }, [accessToken, qbConnectionId, dispatch]);

  // Fetch on entering the history view, and re-fetch if the active company
  // changes while it's open — the list is scoped to that company server-side,
  // so the rows on screen would otherwise belong to the previous one.
  useEffect(() => {
    if (view === "history") loadHistory();
  }, [view, loadHistory]);

  // `opts.userConfirmed` is set ONLY by handlePendingConfirmation, i.e. only
  // when the human actually accepted the dialog. The server treats it as the
  // authorization for a destructive tool — the model's own `confirm: true`
  // argument is not sufficient on its own (see src/lib/chatbot/tools.ts).
  const sendText = async (text: string, opts: { userConfirmed?: boolean; confirmationToken?: string } = {}) => {
    if (!text || streaming || !accessToken || !qbConnectionId) return;

    const history = messagesRef.current.map((m) => ({ role: m.role, content: m.content }));
    setInput("");
    dispatch(sendMessage({ id: newMessageId(), role: "user", content: text }));
    const assistantId = newMessageId();
    dispatch(startAssistantMessage({ id: assistantId }));

    let assistantText = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "X-QB-Id": qbConnectionId,
        },
        body: JSON.stringify({
          message: text,
          history,
          companyName,
          ...(opts.userConfirmed ? { userConfirmed: true } : {}),
          ...(opts.confirmationToken ? { confirmationToken: opts.confirmationToken } : {}),
        }),
      });

      if (!res.ok) {
        if (res.status === 401) {
          sessionEmitter.emit(SESSION_EXPIRED);
        }
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || "Something went wrong. Please try again.");
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error("Streaming isn't supported in this browser.");
      const decoder = new TextDecoder();

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const delta = decoder.decode(value, { stream: true });
        if (delta) {
          assistantText += delta;
          // The consent frame is a control message, not content. Buffer it out
          // rather than rendering it: it arrives only at the very end, so
          // holding back any partial frame costs nothing visually.
          const visible = stripConsentFrame(delta);
          if (visible) dispatch(appendAssistantChunk({ id: assistantId, delta: visible }));
        }
      }

      dispatch(streamCompleted());
      const ticket = extractConsentTicket(assistantText);
      if (assistantText.includes(CONFIRM_MARKER)) {
        void handlePendingConfirmation(stripConsentFrame(assistantText), ticket);
      }
    } catch (err) {
      dispatch(streamFailed(err instanceof Error ? err.message : "Something went wrong. Please try again."));
    } finally {
      // Persist once per completed turn — NOT per streamed token. The obvious
      // "save whenever messages change" effect fires on every
      // appendAssistantChunk, which would mean one POST per token.
      //
      // Runs on the failure path too, so a question whose answer errored out is
      // still in the user's history. Dispatched without awaiting and reading
      // state at call time (see saveCurrentConversation): saving is a
      // background effect and must never block or replace the answer on screen.
      dispatch(saveCurrentConversation());
    }
  };

  // The model paraphrases its own explanation of a pending destructive action,
  // but is instructed (systemPrompt.ts) to always end that explanation with
  // CONFIRM_MARKER verbatim — that's the deterministic signal sendText() above
  // watches for. Surfacing it as a real confirmDialog(), instead of leaving
  // the user to notice the sentence and type "yes" themselves, is the whole
  // point: a tap they can trust beats a chat reply they have to get right.
  const handlePendingConfirmation = async (assistantText: string, confirmationToken?: string) => {
    // Split/join (not a single .replace()) because the underlying multi-round
    // tool-calling stream sometimes emits this exact sentence more than once
    // in the same turn — seen live in production — and a plain .replace()
    // only strips the first occurrence, leaving a stray copy in the dialog.
    const description = assistantText.split(CONFIRM_MARKER).join("").replace(/\n{3,}/g, "\n\n").trim();
    const confirmed = await confirmDialog({
      title: "Confirm this action",
      message: description || "This action can't be undone.",
      confirmLabel: "Yes, proceed",
      cancelLabel: "Cancel",
      tone: "destructive",
    });
    // Strict === true: this is the human click the server treats as the
    // authorization for a destructive tool. Never widen it to a truthy check.
    if (confirmed === true) sendText("Yes, proceed.", { userConfirmed: true, confirmationToken });
  };

  const handleSend = () => sendText(input.trim());

  const handleQuickAction = (text: string) => {
    setInput(text);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      const start = text.indexOf("[");
      const end = text.indexOf("]");
      if (start >= 0 && end > start) el.setSelectionRange(start, end + 1);
      else el.setSelectionRange(text.length, text.length);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // In the history view, Escape steps back to the chat instead of closing the
    // whole panel — closing from a sub-view loses the user's place.
    if (event.key !== "Escape") return;
    if (view === "history") setView("chat");
    else onClose();
  };

  const handleSelectConversation = async (id: string) => {
    setOpeningId(id);
    try {
      const result = await dispatch(openConversation(id));
      // Stay on the list when it fails, so the error is visible next to the row
      // the user tried to open.
      if (openConversation.fulfilled.match(result)) setView("chat");
    } finally {
      setOpeningId(null);
    }
  };

  const handleDeleteConversation = async (id: string) => {
    // Deleting is irreversible — there's no trash to restore from — so it goes
    // through the app's shared confirm dialog like every other destructive
    // action here, rather than deleting straight off a hover button.
    const confirmed = await confirmDialog({
      title: "Delete this conversation?",
      message: "It will be removed from your chat history. This can't be undone.",
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!confirmed) return;

    setDeletingId(id);
    try {
      await dispatch(deleteConversation(id));
    } finally {
      setDeletingId(null);
    }
  };

  const handleNewChat = () => {
    dispatch(startNewConversation());
    setView("chat");
  };

  return (
    <div
      ref={panelRef}
      tabIndex={-1}
      onKeyDown={handlePanelKeyDown}
      role="dialog"
      aria-modal="true"
      aria-label="Chat assistant"
      className="fixed inset-y-0 right-0 z-[90] flex h-screen w-full max-w-md flex-col border-l border-border bg-white shadow-xl outline-none"
    >
      <div className="flex h-16 shrink-0 items-center gap-[var(--space-xs)] border-b border-border px-[var(--space-lg)]">
        {view === "history" && (
          <button
            type="button"
            onClick={() => setView("chat")}
            aria-label="Back to chat"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-background-alt"
          >
            <ArrowLeft size={18} strokeWidth={2} />
          </button>
        )}

        <div className="min-w-0 flex-1">
          <h2 className="truncate text-h3 font-bold text-trust-navy">
            {view === "history" ? "Chat history" : "Assistant"}
          </h2>
          {companyName && <p className="truncate text-caption text-text-secondary">{companyName}</p>}
        </div>

        {view === "chat" && qbConnectionId && (
          <>
            <ChatQuickActions disabled={streaming} onSelect={handleQuickAction} />
            {messages.length > 0 && (
              <button
                type="button"
                onClick={handleNewChat}
                aria-label="Start a new chat"
                title="New chat"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-background-alt"
              >
                <Plus size={18} strokeWidth={2} />
              </button>
            )}
            <button
              type="button"
              onClick={() => setView("history")}
              aria-label="View chat history"
              title="Chat history"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-background-alt"
            >
              <History size={18} strokeWidth={2} />
            </button>
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-text-secondary hover:bg-background-alt"
        >
          <X size={18} strokeWidth={2} />
        </button>
      </div>

      {!qbConnectionId ? (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={<Puzzle size={28} strokeWidth={1.75} />}
            title="Connect QuickBooks to chat"
            description="The assistant answers questions about your invoices, vendors, and accounts — connect a QuickBooks company first."
            actionLabel="Go to Integrations"
            onAction={() => router.push("/accounting-software")}
          />
        </div>
      ) : view === "history" ? (
        <ChatHistoryList
          conversations={conversations}
          status={historyStatus}
          // An open that failed is reported here, next to the row that failed;
          // a list-level failure otherwise.
          error={openError ?? historyError}
          openingId={openingId}
          deletingId={deletingId}
          onSelect={handleSelectConversation}
          onDelete={handleDeleteConversation}
          onRetry={loadHistory}
        />
      ) : (
        <>
          <div ref={listRef} className="flex-1 space-y-[var(--space-md)] overflow-y-auto px-[var(--space-lg)] py-[var(--space-md)]">
            {messages.length === 0 && (
              <p className="pt-[var(--space-xl)] text-center text-body-sm text-text-secondary">
                Ask me to look something up — or to make a change, like creating a vendor or posting an
                invoice to QuickBooks. Tap <Sparkles size={14} strokeWidth={2} className="inline align-text-bottom" /> above
                for examples. Answers only cover your currently active company.
              </p>
            )}
            {messages.map((message, index) => (
              <div
                key={message.id}
                aria-live={index === messages.length - 1 && streaming ? "off" : "polite"}
              >
                <ChatMessage message={message} />
              </div>
            ))}
            {status === "error" && error && <ErrorState message={error} />}
          </div>

          <div className="shrink-0 border-t border-border p-[var(--space-md)]">
            <div className="flex items-end gap-[var(--space-sm)]">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={handleKeyDown}
                disabled={streaming || !accessToken}
                placeholder="Ask a question, or ask me to make a change…"
                rows={2}
                className="min-h-[44px] flex-1 resize-none rounded-md border border-border px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-text-primary outline-none focus:border-primary disabled:opacity-60"
              />
              <Button
                type="button"
                size="sm"
                loading={streaming}
                disabled={!input.trim() || !accessToken}
                onClick={handleSend}
                aria-label="Send message"
              >
                <Send size={16} strokeWidth={2} />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
