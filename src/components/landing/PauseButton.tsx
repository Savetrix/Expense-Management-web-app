"use client";

import { useEffect, useSyncExternalStore } from "react";

// Pause/Play for every animation on the landing page (design-handoff SPEC §3).
// There are two copies, one under the demo and one in the narrow-layout hero
// meta, and they share this one state. The state is applied as classes on the
// page root because the CSS reads it there: .no-motion freezes every loop on
// its finished frame, and .resumed stops the one-off load-in animations from
// replaying once motion comes back.

const ROOT = ".lp2-page";

let paused = false;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function toggle(root: Element | null) {
  paused = !paused;
  root?.classList.toggle("no-motion", paused);
  root?.classList.toggle("resumed", !paused);
  listeners.forEach((listener) => listener());
}

export function PauseButton({ className }: { className: string }) {
  const isPaused = useSyncExternalStore(
    subscribe,
    () => paused,
    () => false,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const root = document.querySelector(ROOT);
    // Coming back to the page after pausing: keep it paused.
    if (paused) root?.classList.add("no-motion");
    // Reduced motion starts in .no-motion. The CSS already shows every
    // finished frame under the same media query and hides this button, so
    // adding the class here changes nothing on screen; it keeps the root's
    // state the same as the design's.
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      root?.classList.add("no-motion");
    }
  }, []);

  return (
    <button
      type="button"
      className={className}
      aria-label={isPaused ? "Play animations" : "Pause animations"}
      aria-pressed={isPaused}
      onClick={(event) => toggle(event.currentTarget.closest(ROOT))}
    >
      {" "}
      {isPaused ? (
        <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2.5 1.4v7.2L8.6 5z" fill="currentColor" />
        </svg>
      ) : (
        <svg width={10} height={10} viewBox="0 0 10 10" aria-hidden="true">
          <rect x="2" y="1.5" width={2} height={7} rx=".6" fill="currentColor" />
          <rect x="6" y="1.5" width={2} height={7} rx=".6" fill="currentColor" />
        </svg>
      )}{" "}
      <span>{isPaused ? "Play" : "Pause"}</span>{" "}
    </button>
  );
}
