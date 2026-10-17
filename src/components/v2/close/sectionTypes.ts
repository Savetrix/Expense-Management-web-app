import type { WorkingPaper } from "./mockData";

/** Props every close section receives from CloseContentV2. */
export interface CloseSectionProps {
  paper: WorkingPaper;
  /** Applies a change to the open working paper and marks the section as started. */
  onUpdate: (change: (wp: WorkingPaper) => WorkingPaper) => void;
  actor: string;
}
