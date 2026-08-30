// SERVER-ONLY. Malware and spam verdicts, read from the provider's own scan.
//
// §20 step 9 asked for a malware scan before ingestion, and the original design
// budgeted a separate scanning service for it (MALWARE_SCAN_URL). It turns out
// we get one for nothing: Resend Inbound runs on Amazon SES, and SES scans every
// message it accepts, stamping the result on the headers we already fetch —
// `X-SES-Virus-Verdict` and `X-SES-Spam-Verdict`. Both were present, verbatim,
// on the first real invoice forwarded through this pipeline.
//
// This is not a substitute for a dedicated scanner if invoice volume ever
// justifies one, but it closes the largest gap in the feature at the cost of
// reading two headers, and it runs BEFORE a single byte is downloaded.
//
// ── WHY VIRUS AND SPAM ARE TREATED DIFFERENTLY ───────────────────────────────
// A virus verdict of FAIL is unambiguous: refuse, permanently, and never fetch
// the attachment. A spam verdict is not — an accountant forwarding a supplier
// invoice from a mailing-list-heavy mailbox can easily trip a spam heuristic,
// and silently discarding a real invoice is worse than importing a junk one that
// a human will reject at review anyway. So spam is RECORDED, not enforced,
// unless a deployment explicitly opts in.
import type { FetchedHeaders } from "./authResults";

export type ScanVerdict = "pass" | "fail" | "gray" | "processing" | "unknown";

export interface ScanVerdicts {
  virus: ScanVerdict;
  spam: ScanVerdict;
}

/** Case-insensitive single-header read, tolerating both provider shapes. */
function readHeader(headers: FetchedHeaders, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() !== wanted) continue;
    const first = Array.isArray(value) ? value[0] : value;
    if (typeof first === "string" && first.trim()) return first.trim();
  }
  return null;
}

/**
 * SES verdict values are PASS / FAIL / GRAY / PROCESSING.
 *
 * Anything unrecognised becomes "unknown" rather than being guessed either way:
 * treating an unreadable verdict as a pass would silently disarm the check, and
 * treating it as a failure would reject legitimate mail whenever the provider
 * changed a string.
 */
export function parseVerdict(raw: string | null): ScanVerdict {
  const value = raw?.trim().toLowerCase();
  if (!value) return "unknown";
  if (value === "pass") return "pass";
  if (value === "fail") return "fail";
  if (value === "gray" || value === "grey") return "gray";
  if (value === "processing") return "processing";
  return "unknown";
}

export function readScanVerdicts(headers: FetchedHeaders): ScanVerdicts {
  return {
    virus: parseVerdict(readHeader(headers, "x-ses-virus-verdict")),
    spam: parseVerdict(readHeader(headers, "x-ses-spam-verdict")),
  };
}

export interface ScanPolicy {
  /** Reject a message SES flagged as spam. Off by default — see the header. */
  rejectSpam?: boolean;
  /**
   * Reject when no virus verdict is available at all.
   *
   * Off by default, deliberately: a provider that stops sending the header, or
   * a future non-SES provider, would otherwise reject every invoice. The design
   * doc's own §9 default made exactly this mistake about authentication headers
   * and had to be reversed after it broke the first live test.
   */
  requireVirusVerdict?: boolean;
}

export type ScanDecision =
  | { accept: true }
  | { accept: false; reason: "malware_detected" | "spam"; detail: string };

export function evaluateScan(verdicts: ScanVerdicts, policy: ScanPolicy = {}): ScanDecision {
  if (verdicts.virus === "fail") {
    return { accept: false, reason: "malware_detected", detail: "provider virus scan failed" };
  }
  if (policy.requireVirusVerdict && verdicts.virus !== "pass") {
    return {
      accept: false,
      reason: "malware_detected",
      detail: `no virus verdict (${verdicts.virus})`,
    };
  }
  if (policy.rejectSpam && verdicts.spam === "fail") {
    return { accept: false, reason: "spam", detail: "provider spam scan failed" };
  }
  return { accept: true };
}
