import { showToast } from "@/lib/dialogManager";

// Front-end-only flows (the bookkeeping features beyond invoice scanning)
// run on local mock data until their APIs exist. Every control that needs a
// backend call is labelled with BE_SUFFIX and calls notifyBackendPending, so
// the flow can still be clicked through end to end while making it obvious
// which steps the backend team still has to wire up.
export const BE_SUFFIX = "(BE)";

/** Appends the "(BE)" marker to a button label. */
export function beLabel(label: string): string {
  return `${label} ${BE_SUFFIX}`;
}

/** Tells the user the action ran against mock data only. */
export function notifyBackendPending(action: string): void {
  showToast(`${action} ${BE_SUFFIX}: shown with sample data until the backend is connected.`, "info");
}
