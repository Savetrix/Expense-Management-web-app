import { assetSchedule, currentPeriod, periodOf, releasedThrough, round2 } from "./schedule";
import type { FixedAsset } from "./types";

/** Depreciation to date and net book value as at `period`. */
export function assetPosition(asset: FixedAsset, period: string): { depreciated: number; nbv: number } {
  const opening = asset.accumulatedToDate || 0;
  if (asset.status === "completed") {
    const depreciated = asset.disposal ? disposalFigures(asset, asset.disposal.date, asset.disposal.proceeds).accumulated : asset.cost;
    return { depreciated, nbv: 0 };
  }
  if (asset.status !== "active") return { depreciated: opening, nbv: round2(asset.cost - opening) };
  const depreciated = round2(opening + releasedThrough(assetSchedule(asset), period));
  return { depreciated, nbv: round2(asset.cost - depreciated) };
}

export interface DisposalFigures {
  accumulated: number;
  nbv: number;
  gainLoss: number;
  /** Depreciation already posted for periods after the disposal date. */
  toReverse: number;
  reversePeriods: number;
}

export function disposalFigures(asset: FixedAsset, disposalDate: string, proceeds: number): DisposalFigures {
  const schedule = assetSchedule(asset);
  const disposalPeriod = periodOf(disposalDate);
  const accumulated = round2((asset.accumulatedToDate || 0) + releasedThrough(schedule, disposalPeriod));
  const nbv = round2(asset.cost - accumulated);
  const now = currentPeriod();
  const later = schedule.filter((r) => r.period > disposalPeriod && r.period <= now);
  return {
    accumulated,
    nbv,
    gainLoss: round2(proceeds - nbv),
    toReverse: round2(later.reduce((s, r) => s + r.amount, 0)),
    reversePeriods: later.length,
  };
}

export interface JournalLine {
  account: string;
  description: string;
  debit: number;
  credit: number;
}

export function disposalJournal(asset: FixedAsset, figures: DisposalFigures, proceeds: number, proceedsAccount: string, gainLossAccount: string): JournalLine[] {
  const lines: JournalLine[] = [];
  if (figures.accumulated > 0) lines.push({ account: asset.accumAccount, description: "Clear accumulated depreciation", debit: figures.accumulated, credit: 0 });
  if (proceeds > 0) lines.push({ account: proceedsAccount, description: "Sale proceeds", debit: proceeds, credit: 0 });
  lines.push({ account: asset.assetAccount, description: "Remove asset at cost", debit: 0, credit: asset.cost });
  if (figures.gainLoss > 0) lines.push({ account: gainLossAccount, description: "Gain on disposal", debit: 0, credit: figures.gainLoss });
  if (figures.gainLoss < 0) lines.push({ account: gainLossAccount, description: "Loss on disposal", debit: -figures.gainLoss, credit: 0 });
  return lines;
}
