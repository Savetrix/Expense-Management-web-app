// Auto-post stays locked for a company until it has enough of its own coding
// in Scantrix: at least AUTOPOST_UNLOCK_DAYS (default 15) since the first item
// a person coded — a posted bill or a bank line. Saurabh, 11 Nov call: a new
// company shouldn't post on its own before Scantrix has seen how it codes.
//
// Only the web app's switch is locked; the Scantrix API still accepts the
// setting from any client (see the note in usePreferencesSettings / the PR).

export const DEFAULT_AUTOPOST_UNLOCK_DAYS = 15;
const DAY = 86_400_000;

/** The configured number of days (server side: AUTOPOST_UNLOCK_DAYS). */
export function autoPostUnlockDays(raw: string | undefined = typeof process !== "undefined" ? process.env.AUTOPOST_UNLOCK_DAYS : undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 365 ? n : DEFAULT_AUTOPOST_UNLOCK_DAYS;
}

export interface AutoPostLock {
  locked: boolean;
  /** Whole days since the first coded item; 0 when there is none. */
  days: number;
  requiredDays: number;
  /** The hover note: why the switch can't be turned on yet. Null when unlocked. */
  note: string | null;
}

/** `firstCodedAt`: the earliest item a person coded in Scantrix (ISO), or null for none yet. */
export function autoPostLock(firstCodedAt: string | null, requiredDays: number, now = Date.now()): AutoPostLock {
  const first = firstCodedAt ? Date.parse(firstCodedAt) : NaN;
  const days = Number.isFinite(first) ? Math.max(0, Math.floor((now - first) / DAY)) : 0;
  const locked = requiredDays > 0 && (!Number.isFinite(first) || days < requiredDays);
  if (!locked) return { locked: false, days, requiredDays, note: null };
  const left = requiredDays - days;
  return {
    locked,
    days,
    requiredDays,
    note: !Number.isFinite(first)
      ? `Auto-post unlocks after ${requiredDays} days of coding in Scantrix, so it learns how this company codes first. Nothing has been coded yet.`
      : `Auto-post unlocks after ${requiredDays} days of coding in Scantrix, so it learns how this company codes first. ${left} day${left === 1 ? "" : "s"} to go.`,
  };
}

/** The earliest of several ISO dates, ignoring empty ones. */
export function earliest(...dates: (string | null | undefined)[]): string | null {
  const valid = dates.filter((d): d is string => Boolean(d) && Number.isFinite(Date.parse(d as string)));
  return valid.length ? valid.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b)) : null;
}
