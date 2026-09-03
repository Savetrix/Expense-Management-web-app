// Shared Meta Pixel helper for the landing page's signup CTAs.
// Fires the "Lead" event on click. Reporting only — this does not change
// any ad set's optimization goal.

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

export function trackSignupClick() {
  if (typeof window !== "undefined" && typeof window.fbq === "function") {
    window.fbq("track", "Lead");
  }
}
