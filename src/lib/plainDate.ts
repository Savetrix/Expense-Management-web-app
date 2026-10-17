// A day-only business date ("2026-09-01") passed to `new Date()` is read as
// UTC midnight, which renders as the previous day anywhere west of UTC. Parse
// those as local midnight instead; full timestamps are left to `new Date()`.
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function parsePlainDate(value: string): Date {
  return DAY_ONLY.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
}

/** Formats a day-only date or an ISO timestamp without shifting the day. */
export function formatPlainDate(value: string | null | undefined, options: Intl.DateTimeFormatOptions): string {
  if (!value) return "—";
  const parsed = parsePlainDate(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("en-US", options);
}
