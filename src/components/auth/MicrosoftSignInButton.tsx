"use client";

import type { IPublicClientApplication } from "@azure/msal-browser";
import { useRef, useState } from "react";

import { useAppDispatch } from "@/store/hooks";
import { microsoftLogin } from "@/store/auth/authApi";

interface MicrosoftSignInButtonProps {
  onSuccess: () => void;
  onError: (message: string) => void;
}

// Microsoft has no entry in simple-icons (same situation BrandIcon.tsx
// already documents for Tally) — rendered as a plain wordmark rather than a
// hand-approximated logo.
//
// "common" as the default authority accepts both Azure AD work/school
// accounts and personal Microsoft accounts (Outlook.com/Hotmail/Live) — the
// latter is what makes this an actual "Sign in with Outlook" option and not
// just organizational SSO. Override via NEXT_PUBLIC_MICROSOFT_TENANT_ID if
// the backend team wants to restrict this later.
export function MicrosoftSignInButton({ onSuccess, onError }: MicrosoftSignInButtonProps) {
  const dispatch = useAppDispatch();
  const [loading, setLoading] = useState(false);
  const msalRef = useRef<IPublicClientApplication | null>(null);
  const msalInitRef = useRef<Promise<IPublicClientApplication> | null>(null);

  const clientId = process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID;
  const tenantId = process.env.NEXT_PUBLIC_MICROSOFT_TENANT_ID || "common";

  // Lazily created (and initialized) on first click rather than at module
  // load — MSAL's PublicClientApplication touches window/sessionStorage,
  // and this component may render before the "Coming Soon" clientId check
  // even resolves in some environments.
  const getMsalInstance = async () => {
    if (msalRef.current) return msalRef.current;
    if (!msalInitRef.current) {
      msalInitRef.current = (async () => {
        const { PublicClientApplication } = await import("@azure/msal-browser");
        const instance = new PublicClientApplication({
          auth: {
            clientId: clientId as string,
            authority: `https://login.microsoftonline.com/${tenantId}`,
            // This msal-browser version completes a popup flow via a
            // BroadcastChannel "redirect bridge" rather than the opener
            // polling the popup's location directly — the page at
            // redirectUri must call broadcastResponseToMainFrame() (see
            // src/app/v2/login/microsoft-callback/page.tsx). It's nested
            // under /v2/login specifically so AuthGate's PUBLIC_ROUTES
            // prefix match covers it — this page must render while
            // unauthenticated, since it's what delivers the auth code that
            // establishes auth in the first place.
            redirectUri:
              typeof window !== "undefined"
                ? `${window.location.origin}/v2/login/microsoft-callback`
                : undefined,
          },
        });
        await instance.initialize();
        msalRef.current = instance;
        return instance;
      })();
    }
    return msalInitRef.current;
  };

  const handleClick = async () => {
    if (!clientId || loading) return;
    setLoading(true);
    try {
      const instance = await getMsalInstance();
      const result = await instance.loginPopup({ scopes: ["openid", "profile", "email"] });
      if (!result.idToken) {
        onError("Microsoft sign-in did not return an identity token.");
        return;
      }
      const dispatched = await dispatch(microsoftLogin({ idToken: result.idToken }));
      if (microsoftLogin.fulfilled.match(dispatched)) {
        onSuccess();
      } else {
        const payload = dispatched.payload;
        onError(typeof payload === "string" ? payload : "Microsoft sign-in failed");
      }
    } catch (error: any) {
      // Fires when someone closes the popup themselves — not a real
      // failure, so it shouldn't surface as a form error.
      if (error?.errorCode === "user_cancelled") {
        // no-op
      } else if (error?.errorCode === "interaction_in_progress") {
        // A prior popup attempt was interrupted (closed early, bridge
        // timeout, etc.) before MSAL's own cleanup could clear its
        // "interaction in progress" flag, which it tracks in sessionStorage
        // (key `msal.interaction.status`) independently of this component's
        // lifecycle. Every subsequent loginPopup() call is rejected before a
        // new popup even opens until that flag is cleared, so clear it
        // ourselves (only if it's our own clientId's flag — same guard MSAL
        // uses internally) and let the user retry.
        if (typeof window !== "undefined") {
          try {
            const raw = window.sessionStorage.getItem("msal.interaction.status");
            const stuck = raw ? JSON.parse(raw) : null;
            if (stuck?.clientId === clientId) {
              window.sessionStorage.removeItem("msal.interaction.status");
            }
          } catch {
            // malformed or inaccessible storage — nothing more we can do
          }
        }
        onError("A previous Microsoft sign-in attempt didn't finish. Please try again.");
      } else {
        onError(error?.errorMessage || error?.message || "Microsoft sign-in failed");
      }
    } finally {
      setLoading(false);
    }
  };

  if (!clientId) {
    // No client ID configured in this environment (and the backend endpoint
    // this calls doesn't exist yet either) — same disabled/"Coming Soon"
    // precedent as AppleSignInButton and pickProfileImage rather than a
    // button that would just fail on click.
    return (
      <button
        type="button"
        disabled
        className="inline-flex h-[50px] w-full cursor-not-allowed items-center justify-center rounded-md border border-border bg-background-alt text-body font-semibold text-text-secondary"
      >
        Continue with Microsoft (Coming Soon)
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={loading}
      className="inline-flex h-[50px] w-full items-center justify-center rounded-md border border-border bg-white text-body font-semibold text-text-primary hover:bg-background-alt disabled:cursor-not-allowed disabled:opacity-60"
    >
      {loading ? "Signing in…" : "Continue with Microsoft"}
    </button>
  );
}
