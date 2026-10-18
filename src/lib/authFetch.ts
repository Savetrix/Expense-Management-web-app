// fetch() with the session's access token, for the callers that can't go
// through the axios client (the chat stream, chat history, email
// forwarding — all Next API routes that vouch for the token with the
// backend before doing anything). Same policy as api.ts: refresh ahead of
// expiry, and on a 401 refresh once and re-send. Re-sending is safe for these
// routes even for a POST: a 401 from them means the token was refused before
// any work started (see lib/chatHistory/apiAuth.ts, lib/inboundEmail/apiAuth.ts).
//
// Signs the user out (SESSION_EXPIRED) only when the refresh itself fails or
// the re-sent request is refused too. Guarded for SSR like the rest of lib/.
import { getFreshAccessToken, refreshAccessToken } from "./api";
import { SESSION_EXPIRED, sessionEmitter } from "./sessionManager";

const withToken = (init: RequestInit | undefined, token: string | null): RequestInit => {
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return { ...init, headers };
};

const storedToken = (): string | null =>
  typeof window === "undefined" ? null : window.localStorage.getItem("accessToken");

export async function authFetch(input: string, init?: RequestInit): Promise<Response> {
  const sent = await getFreshAccessToken();
  const response = await fetch(input, withToken(init, sent));
  if (response.status !== 401) return response;

  let fresh: string;
  try {
    // A refresh that finished while this request was in flight already
    // produced a newer token — use it instead of refreshing again.
    const current = storedToken();
    fresh = current && current !== sent ? current : await refreshAccessToken();
  } catch {
    sessionEmitter.emit(SESSION_EXPIRED);
    return response;
  }

  const retried = await fetch(input, withToken(init, fresh));
  if (retried.status === 401) sessionEmitter.emit(SESSION_EXPIRED);
  return retried;
}
