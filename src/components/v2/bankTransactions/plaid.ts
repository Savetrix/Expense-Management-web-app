import type { ComponentType } from "react";

export interface PlaidLinkMetadata {
  institutionName?: string;
  accounts: { id: string; name: string; mask?: string; subtype?: string }[];
}

export interface PlaidLinkLauncherProps {
  /** Short-lived token the backend creates (POST /plaid/link-token). null until it has been fetched. */
  linkToken: string | null;
  /** Plaid Link finished: send publicToken to the backend (POST /plaid/exchange-public-token), which returns the accounts. */
  onSuccess(publicToken: string, metadata: PlaidLinkMetadata): void;
  /** The user closed Plaid Link without connecting, or Link failed. */
  onExit(): void;
}

/**
 * Contract for the component that opens Plaid Link. Nothing is wired up yet.
 *
 * To plug in the real flow, implement a component with these props, e.g. with
 * `react-plaid-link`:
 *
 *   const { open, ready } = usePlaidLink({
 *     token: linkToken,
 *     onSuccess: (publicToken, meta) =>
 *       onSuccess(publicToken, {
 *         institutionName: meta.institution?.name,
 *         accounts: meta.accounts.map((a) => ({ id: a.id, name: a.name, mask: a.mask ?? undefined, subtype: a.subtype })),
 *       }),
 *     onExit: () => onExit(),
 *   });
 *   useEffect(() => { if (ready) open(); }, [ready, open]);
 *   return null;
 *
 * Without a package, load https://cdn.plaid.com/link/v2/stable/link-initialize.js
 * and call `Plaid.create({ token: linkToken, onSuccess, onExit }).open()`.
 * Pass the implementation to ConnectBankModal through its `Launcher` prop.
 */
export type PlaidLinkLauncher = ComponentType<PlaidLinkLauncherProps>;
