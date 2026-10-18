// Product defaults for month-end detection. These are configuration, not
// sample records.

import type { DetectionSettings } from "./types";

export const DEFAULT_SETTINGS: DetectionSettings = {
  threshold: 250,
  proration: "monthly",
  enabled: { prepayments: true, deferred: true, fixedAssets: true, accruals: true },
};

// Tracking categories / classes are not in the app's accounting data yet, so
// "None" is the only choice until the backend provides them (BE).
export const TRACKING_OPTIONS: string[] = ["None"];
