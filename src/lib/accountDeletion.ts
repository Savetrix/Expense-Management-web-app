// Account deletion — the pure half (types, the typed-confirmation check, and
// the "what will happen" lines the dialog shows), kept out of the component
// so it can be unit-tested. Backend contract (Scantrix_API
// user_deletion.service.js):
//   GET    /users/me/deletion-preview → DeletionPreview
//   DELETE /users/me  { confirmText }  → soft-deletes the account, cancels a
//          Stripe plan, closes every company the user owns (members lose
//          access) and removes the user from other teams.

// Must match the backend's DELETION_CONFIRM_TEXT. The preview also returns it
// (preview.confirmText), which the dialog prefers so the two can't drift.
export const DELETION_CONFIRM_TEXT = "delete my account";

export interface DeletionPreviewConnection {
  _id: string;
  name: string;
  provider?: { id: string; name: string };
  memberCount: number;
}

export interface DeletionPreview {
  confirmText: string;
  ownedConnections: DeletionPreviewConnection[];
  membershipCount: number;
  subscription: {
    plan: string;
    status: string;
    provider: string | null;
    willBeCancelled: boolean;
    mustCancelInStore: boolean;
  } | null;
}

// Same rule as the backend: trimmed, case-insensitive — phone keyboards
// capitalise the first letter on their own.
export const isDeletionConfirmTextValid = (typed: string, expected: string = DELETION_CONFIRM_TEXT): boolean =>
  typed.trim().toLowerCase() === expected.trim().toLowerCase();

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// One line per consequence, most severe first. Always ends with the account
// itself, so the list is never empty even for a user with nothing connected.
export const describeDeletionImpact = (preview: DeletionPreview): string[] => {
  const lines: string[] = [];

  for (const conn of preview.ownedConnections) {
    const software = conn.provider?.name ? ` (${conn.provider.name})` : "";
    lines.push(
      conn.memberCount > 0
        ? `${conn.name}${software} will be disconnected, and ${plural(conn.memberCount, "team member", "team members")} will lose access to it.`
        : `${conn.name}${software} will be disconnected.`,
    );
  }

  if (preview.membershipCount > 0) {
    lines.push(`You will be removed from ${plural(preview.membershipCount, "team", "teams")} you were invited to.`);
  }

  if (preview.subscription?.willBeCancelled) {
    lines.push("Your subscription will be cancelled right away. No further payments will be taken.");
  }

  // Signing in again revives the account as a fresh start (backend
  // auth.controller.js) — none of the data above comes back with it; only a
  // support restore does that.
  lines.push("You will be signed out. Signing up again later starts a fresh account, without a free trial.");
  return lines;
};

// App Store / Google Play plans can't be cancelled by us — the user has to
// do it in the store, or they keep being charged. null when not applicable.
export const storeCancellationWarning = (preview: DeletionPreview): string | null => {
  const sub = preview.subscription;
  if (!sub?.mustCancelInStore) return null;
  const store = sub.provider === "google" ? "Google Play" : "the App Store";
  return `Your subscription was bought through ${store}, so we can't cancel it for you. Cancel it in ${store} as well, or you will keep being charged.`;
};
