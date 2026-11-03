"use client";

import { useState } from "react";

interface AvatarProps {
  name: string;
  photoURL?: string | null;
  size?: "sm" | "md" | "base" | "lg";
  /** "square" for table-row chips (GL/vendor code style), "circle" for people. */
  shape?: "circle" | "square";
  /** Pre-computed initials (e.g. a 2-letter vendor code via vendorInitials(),
   *  or a person's via personInitials()) — overrides the default derivation
   *  from `name` (first letter of its first and last word). */
  initials?: string;
  /** Overrides the default bg-accent-bg/text-accent-text-on-bg tone, e.g. for
   *  a status-driven chip color (see InvoiceListContentV2's avatar tone). */
  toneClassName?: string;
}

const sizeClasses: Record<NonNullable<AvatarProps["size"]>, string> = {
  sm: "h-6 w-6 text-caption",
  md: "h-7 w-7 text-caption",
  base: "h-8 w-8 text-caption",
  lg: "h-9 w-9 text-body-sm",
};

const nameInitials = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  const last = words.length > 1 ? words[words.length - 1].charAt(0) : "";
  return `${words[0].charAt(0)}${last}`.toUpperCase();
};

// Centralizes the initials-chip markup that was previously duplicated ad hoc
// in AppShell and DashboardContentV2 — every v2 table/list row that needs a
// person or entity avatar should use this instead of re-deriving initials
// styling per screen. A photo that fails to load (expired Google/S3 link,
// deleted file) falls back to the initials instead of a broken image.
export function Avatar({
  name,
  photoURL,
  size = "md",
  shape = "circle",
  initials,
  toneClassName = "bg-accent-bg text-accent-text-on-bg",
}: AvatarProps) {
  // Keyed by URL so a new photo gets a fresh try after an old one failed.
  const [failedURL, setFailedURL] = useState<string | null>(null);
  const display = initials || nameInitials(name) || "?";
  const showPhoto = !!photoURL && failedURL !== photoURL;
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden font-bold ${toneClassName} ${
        sizeClasses[size]
      } ${shape === "circle" ? "rounded-full" : "rounded-md"}`}
    >
      {showPhoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoURL} alt={name} className="h-full w-full object-cover" onError={() => setFailedURL(photoURL)} />
      ) : (
        display
      )}
    </span>
  );
}
