"use client";

import { useEffect, useRef } from "react";
import { usePlaidLink } from "react-plaid-link";

import type { PlaidLinkLauncherProps } from "./plaid";

// Opens Plaid Link as soon as it is ready (react-plaid-link loads Plaid's own
// script from cdn.plaid.com). Bank sign-in happens inside Plaid's window; this
// component only ever sees the one-time public token and the account summary.
// It renders nothing.
export function PlaidLinkLauncher({ linkToken, onSuccess, onExit }: PlaidLinkLauncherProps) {
  const opened = useRef(false);
  const { open, ready } = usePlaidLink({
    token: linkToken,
    // Typed nullable by the library; a success without a token is treated as an exit.
    onSuccess: (publicToken, meta) =>
      publicToken
        ? onSuccess(publicToken, {
        institutionId: meta.institution?.institution_id ?? undefined,
        institutionName: meta.institution?.name ?? undefined,
            accounts: meta.accounts.map((a) => ({ id: a.id, name: a.name, mask: a.mask ?? undefined, subtype: a.subtype ?? undefined })),
          })
        : onExit(),
    onExit: () => onExit(),
  });

  useEffect(() => {
    if (ready && linkToken && !opened.current) {
      opened.current = true;
      open();
    }
  }, [ready, linkToken, open]);

  return null;
}
