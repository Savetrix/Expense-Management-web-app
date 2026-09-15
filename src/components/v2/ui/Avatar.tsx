interface AvatarProps {
  name: string;
  photoURL?: string | null;
  size?: "sm" | "md" | "lg";
  /** "square" for table-row chips (GL/vendor code style), "circle" for people. */
  shape?: "circle" | "square";
  /** Pre-computed initials (e.g. a 2-letter vendor code via vendorInitials()) —
   *  overrides the default single-first-letter derivation from `name`. */
  initials?: string;
  /** Overrides the default bg-accent-bg/text-accent-text-on-bg tone, e.g. for
   *  a status-driven chip color (see InvoiceListContentV2's avatar tone). */
  toneClassName?: string;
}

const sizeClasses: Record<NonNullable<AvatarProps["size"]>, string> = {
  sm: "h-6 w-6 text-caption",
  md: "h-7 w-7 text-caption",
  lg: "h-9 w-9 text-body-sm",
};

// Centralizes the initials-chip markup that was previously duplicated ad hoc
// in AppShell and DashboardContentV2 — every v2 table/list row that needs a
// person or entity avatar should use this instead of re-deriving initials
// styling per screen.
export function Avatar({
  name,
  photoURL,
  size = "md",
  shape = "circle",
  initials,
  toneClassName = "bg-accent-bg text-accent-text-on-bg",
}: AvatarProps) {
  const display = initials || name.trim().charAt(0).toUpperCase() || "?";
  return (
    <span
      className={`flex shrink-0 items-center justify-center overflow-hidden font-bold ${toneClassName} ${
        sizeClasses[size]
      } ${shape === "circle" ? "rounded-full" : "rounded-md"}`}
    >
      {photoURL ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={photoURL} alt={name} className="h-full w-full object-cover" />
      ) : (
        display
      )}
    </span>
  );
}
