import type { WorkingPaper } from "./types";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const parts = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return { y, m, d };
};

const lastDayOfMonth = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** "September 2026 close" for a whole calendar month, otherwise a date range. */
export function periodName(start: string, end: string): string {
  const s = parts(start);
  const e = parts(end);
  if (s.y === e.y && s.m === e.m && s.d === 1 && e.d === lastDayOfMonth(e.y, e.m)) {
    return `${MONTHS[s.m - 1]} ${s.y} close`;
  }
  const startLabel = `${s.d} ${SHORT_MONTHS[s.m - 1]}${s.y !== e.y ? ` ${s.y}` : ""}`;
  return `${startLabel} – ${e.d} ${SHORT_MONTHS[e.m - 1]} ${e.y} close`;
}

/** Calendar month before `today`, used as the default period for a new close. */
export function defaultPeriod(today = new Date(), after?: string): { start: string; end: string } {
  let y: number;
  let m: number;
  if (after) {
    const a = parts(after);
    y = a.m === 12 ? a.y + 1 : a.y;
    m = a.m === 12 ? 1 : a.m + 1;
  } else {
    y = today.getFullYear();
    m = today.getMonth(); // previous month, 1-based
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  const mm = String(m).padStart(2, "0");
  return { start: `${y}-${mm}-01`, end: `${y}-${mm}-${String(lastDayOfMonth(y, m)).padStart(2, "0")}` };
}

let seq = 0;
export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

export function createWorkingPaper(periodStart: string, periodEnd: string, createdBy: string): WorkingPaper {
  return {
    id: newId("wp"),
    name: periodName(periodStart, periodEnd),
    periodStart,
    periodEnd,
    createdAt: new Date().toISOString(),
    createdBy,
    touched: {},
  };
}
