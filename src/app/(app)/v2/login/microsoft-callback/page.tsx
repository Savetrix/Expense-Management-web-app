"use client";

import { useEffect } from "react";

// Dedicated MSAL popup redirectUri target, nested under /v2/login so
// AuthGate's PUBLIC_ROUTES prefix match ("/v2/login") covers it too — this
// page must render (and its effect must run) before authentication exists,
// since it's carrying the auth code back from the IdP.
//
// This msal-browser version completes a popup flow via a BroadcastChannel
// "redirect bridge" rather than the opener polling the popup's location
// directly — the page loaded at redirectUri must call
// broadcastResponseToMainFrame() to relay the auth response back and close
// itself. It renders nothing because it never stays open long enough to
// matter.
export default function MicrosoftAuthCallbackPage() {
  useEffect(() => {
    import("@azure/msal-browser/redirect-bridge").then(({ broadcastResponseToMainFrame }) => {
      broadcastResponseToMainFrame().catch(() => {
        // No matching opener/request state (e.g. page opened directly,
        // or state expired) — nothing more to do here.
      });
    });
  }, []);

  return null;
}
