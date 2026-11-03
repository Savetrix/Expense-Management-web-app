// Display-only text formatting helpers. Never write the result back to
// stored/persisted data — call these at render time only.

// Capitalizes the first letter of each word, leaving every other character
// untouched (so existing internal capitals like "McDonald" or "O'Brien"
// survive, and nothing is force-lowercased).
export function capitalizeWords(value: string): string {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

// A person's avatar letters: first letter of the first name + first letter of
// the last name ("Nikhil Sharma" → "NS"). No last name → just the first
// name's letter; no name at all → the fallback's (e.g. the email's) first one.
export function personInitials(firstName?: string | null, lastName?: string | null, fallback?: string | null): string {
  const initials = `${firstName?.trim().charAt(0) ?? ""}${lastName?.trim().charAt(0) ?? ""}`.toUpperCase();
  return initials || fallback?.trim().charAt(0).toUpperCase() || "?";
}

// The API's `icon` field (and Firebase's photoURL fallback) can come back as
// the literal strings "null"/"undefined" rather than an actual null/absent
// value — treat those the same as empty so callers don't try to render them
// as an <img src>.
export function normalizePhotoURL(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return "";
  return trimmed;
}
