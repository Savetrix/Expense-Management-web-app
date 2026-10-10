import { createAsyncThunk } from "@reduxjs/toolkit";

import { SESSION_EXPIRED, sessionEmitter } from "../../lib/sessionManager";
import type { Conversation, ConversationSummary } from "../../lib/chatHistory/types";
// Type-only: chatSlice imports this file and store/index imports chatSlice, so
// a value import here would close a runtime cycle.
import type { RootState } from "..";

// Thunks for the chat-history routes under /api/chat/history.
//
// Unlike every other *Api.ts in this folder these do NOT go through lib/api.ts:
// the endpoints are this app's own route handlers on the same origin, not the
// Savetrix backend, so there's no baseURL to resolve and no refresh-token
// interceptor to inherit. Credentials are passed explicitly from Redux state,
// exactly like ChatPanel's existing fetch to /api/chat (architecture doc §4.2).
//
// The server derives the user from the Bearer token and scopes storage to it,
// so nothing here sends (or could usefully send) a user id.

const HISTORY_URL = "/api/chat/history";

interface RejectionValue {
  message: string;
  statusCode?: number;
}

class HistoryRequestError extends Error {
  constructor(message: string, readonly statusCode?: number) {
    super(message);
    this.name = "HistoryRequestError";
  }
}

function requireCredentials(state: RootState): { accessToken: string; qbConnectionId: string } {
  const accessToken: string | undefined = state.auth.user?.data?.accessToken;
  const qbConnectionId = state.quickBooks.qbConnectionId;
  if (!accessToken) throw new HistoryRequestError("You need to sign in to use chat history.", 401);
  if (!qbConnectionId) throw new HistoryRequestError("Connect an accounting company first.", 400);
  return { accessToken, qbConnectionId };
}

async function historyFetch(state: RootState, path: string, init?: RequestInit): Promise<Response> {
  const { accessToken, qbConnectionId } = requireCredentials(state);
  const response = await fetch(`${HISTORY_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${accessToken}`,
      "X-QB-Id": qbConnectionId,
      ...init?.headers,
    },
  });

  if (response.ok) return response;

  // Mirrors ChatPanel's handling of /api/chat: a server-rejected token means
  // this session is over, not that history is broken.
  if (response.status === 401) sessionEmitter.emit(SESSION_EXPIRED);
  const body = await response.json().catch(() => null);
  throw new HistoryRequestError(body?.error || "Couldn't reach chat history. Please try again.", response.status);
}

function reject(error: unknown, fallback: string): RejectionValue {
  if (error instanceof HistoryRequestError) return { message: error.message, statusCode: error.statusCode };
  return { message: error instanceof Error ? error.message : fallback };
}

// ================================
// LIST CONVERSATIONS
// ================================
export const fetchConversations = createAsyncThunk<
  ConversationSummary[],
  void,
  { state: RootState; rejectValue: RejectionValue }
>("chat/fetchConversations", async (_: void, thunkAPI) => {
  try {
    // Structural logging only — never the conversation bodies, which can carry
    // invoice and banking detail (architecture doc §5).
    console.log("========== CHAT HISTORY LIST REQUEST ==========");
    const response = await historyFetch(thunkAPI.getState(), "");
    const body = await response.json();
    const conversations: ConversationSummary[] = Array.isArray(body?.conversations) ? body.conversations : [];
    console.log(`========== CHAT HISTORY LIST SUCCESS (${conversations.length}) ==========`);
    return conversations;
  } catch (error) {
    console.log("========== CHAT HISTORY LIST ERROR ==========");
    return thunkAPI.rejectWithValue(reject(error, "Failed to load chat history"));
  }
});

// ================================
// OPEN ONE CONVERSATION
// ================================
export const openConversation = createAsyncThunk<
  Conversation,
  string,
  { state: RootState; rejectValue: RejectionValue }
>("chat/openConversation", async (conversationId: string, thunkAPI) => {
  try {
    console.log("========== CHAT HISTORY OPEN REQUEST ==========");
    const response = await historyFetch(thunkAPI.getState(), `/${encodeURIComponent(conversationId)}`);
    const body = await response.json();
    if (!body?.conversation) throw new HistoryRequestError("That conversation is no longer available.", 404);
    console.log("========== CHAT HISTORY OPEN SUCCESS ==========");
    return body.conversation as Conversation;
  } catch (error) {
    console.log("========== CHAT HISTORY OPEN ERROR ==========");
    return thunkAPI.rejectWithValue(reject(error, "Failed to open conversation"));
  }
});

// ================================
// SAVE THE LIVE CONVERSATION
// ================================
// Reads the messages out of state at call time rather than taking them as an
// argument: this is dispatched right after a stream finishes, when the caller's
// closure still holds the pre-stream messages array.
export const saveCurrentConversation = createAsyncThunk<
  ConversationSummary | null,
  void,
  { state: RootState; rejectValue: RejectionValue }
>("chat/saveCurrentConversation", async (_: void, thunkAPI) => {
  const state = thunkAPI.getState();
  const { messages, conversationId } = state.chat;
  if (messages.length === 0) return null;

  try {
    console.log("========== CHAT HISTORY SAVE REQUEST ==========");
    const response = await historyFetch(state, "", {
      method: "POST",
      body: JSON.stringify({
        conversationId,
        messages: messages.map((message) => ({ id: message.id, role: message.role, content: message.content })),
      }),
    });
    const body = await response.json();
    console.log("========== CHAT HISTORY SAVE SUCCESS ==========");
    return (body?.conversation ?? null) as ConversationSummary | null;
  } catch (error) {
    console.log("========== CHAT HISTORY SAVE ERROR ==========");
    return thunkAPI.rejectWithValue(reject(error, "Failed to save conversation"));
  }
});

// ================================
// DELETE A CONVERSATION
// ================================
export const deleteConversation = createAsyncThunk<
  string,
  string,
  { state: RootState; rejectValue: RejectionValue }
>("chat/deleteConversation", async (conversationId: string, thunkAPI) => {
  try {
    console.log("========== CHAT HISTORY DELETE REQUEST ==========");
    await historyFetch(thunkAPI.getState(), `/${encodeURIComponent(conversationId)}`, { method: "DELETE" });
    console.log("========== CHAT HISTORY DELETE SUCCESS ==========");
    return conversationId;
  } catch (error) {
    console.log("========== CHAT HISTORY DELETE ERROR ==========");
    return thunkAPI.rejectWithValue(reject(error, "Failed to delete conversation"));
  }
});
