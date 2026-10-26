"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  EMPTY_LEAD,
  LEAD_FIELDS,
  LEAD_LIMITS,
  sanitizeLead,
  validateLead,
  validateLeadField,
  type EbookIntent,
  type LeadDraft,
  type LeadErrors,
  type LeadField,
} from "@/lib/ebookLeads/fields";

// The details form shown before an e-book can be read or downloaded. Modelled on
// CustomPlanEnquiryModal (portal, focus trap, honeypot, shared validation) so
// the two public forms behave alike. Mounted only while open, so every piece of
// state starts fresh each time and a visitor's details never outlive a close.
//
// Rendered into document.body for the same reason as that modal: the landing
// layout wraps sections in elements with `will-change: transform`, which would
// otherwise trap a `fixed` dialog inside a card instead of the viewport.

/** Hidden field name. Must match HONEYPOT_FIELD in /api/ebooks/lead. */
const HONEYPOT_FIELD = "website";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface EbookGateModalProps {
  slug: string;
  title: string;
  intent: EbookIntent;
  onClose: () => void;
  /** Fires once the server has accepted the details and set the access cookie. */
  onUnlocked: (intent: EbookIntent) => void;
}

export function EbookGateModal({ slug, title, intent, onClose, onUnlocked }: EbookGateModalProps) {
  const [draft, setDraft] = useState<LeadDraft>(EMPTY_LEAD);
  const [errors, setErrors] = useState<LeadErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);
  // Closes the gap between a click and React committing `submitting`, so an
  // Enter keypress in the same tick cannot send twice.
  const inFlightRef = useRef(false);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const titleId = useId();
  const descriptionId = useId();

  const close = useCallback(() => {
    // An in-flight submit must not be abandoned: the request would still land
    // while the visitor believes they cancelled.
    if (inFlightRef.current) return;
    onClose();
  }, [onClose]);

  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;

      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const list = Array.from(nodes).filter((node) => node.offsetParent !== null);
      if (list.length === 0) return;

      const first = list[0];
      const last = list[list.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [close]);

  // Into the first field on open: the visitor came here to type.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>("input")?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const setValue = (field: LeadField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    // Clear an error as soon as it is being fixed; re-validating on every
    // keystroke would flag "invalid email" after the first character.
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  };

  const validateOnBlur = (field: LeadField) => {
    const error = validateLeadField(field, sanitizeLead(draft)[field]);
    setErrors((current) => ({ ...current, [field]: error ?? undefined }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlightRef.current || submitting) return;

    const sanitized = sanitizeLead(draft);
    const nextErrors = validateLead(sanitized);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setFormError(null);
      const firstBad = LEAD_FIELDS.find((field) => nextErrors[field]);
      if (firstBad) dialogRef.current?.querySelector<HTMLElement>(`[name="${firstBad}"]`)?.focus();
      return;
    }

    setDraft(sanitized);
    setErrors({});
    setFormError(null);
    inFlightRef.current = true;
    setSubmitting(true);

    try {
      const response = await fetch("/api/ebooks/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...sanitized,
          slug,
          intent,
          // Always sent, always empty from a real browser. See the route.
          [HONEYPOT_FIELD]: honeypotRef.current?.value ?? "",
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; fieldErrors?: LeadErrors }
        | null;

      if (!response.ok) {
        // A recoverable failure leaves what the visitor typed in place.
        if (payload?.fieldErrors) setErrors(payload.fieldErrors);
        setFormError(payload?.error ?? "We couldn't process that. Please try again in a moment.");
        return;
      }

      inFlightRef.current = false;
      onUnlocked(intent);
    } catch {
      setFormError("We couldn't reach Scantrix. Check your connection; your details are still here.");
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  };

  // createPortal needs a real DOM node. This is only mounted from a click or an
  // effect, so `document` is always there, but AGENTS.md records a real SSR
  // prerender crash from unguarded browser access, and the guard costs nothing.
  if (typeof document === "undefined") return null;

  const reading = intent === "read";

  return createPortal(
    <div
      // z-[120] clears DialogHost's confirm backdrop and toast stack.
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-[var(--space-lg)]"
      onMouseDown={(event) => {
        // mousedown, not click: a drag that STARTED inside the dialog (selecting
        // text) and ends on the backdrop must not throw away what was typed.
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-xl bg-white shadow-xl sm:max-h-[88dvh] sm:rounded-xl"
      >
        <div className="flex items-start justify-between gap-[var(--space-md)] border-b border-border p-[var(--space-lg)]">
          <div className="min-w-0">
            <h2 id={titleId} className="text-h3 font-bold text-trust-navy">
              {reading ? "Read this guide" : "Download the PDF"}
            </h2>
            <p id={descriptionId} className="mt-[var(--space-xs)] text-body-sm text-text-secondary">
              {reading
                ? `Tell us who you are and “${title}” opens right here.`
                : `Tell us who you are and the PDF of “${title}” downloads straight away.`}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={submitting}
            aria-label="Close"
            className="-m-2 shrink-0 rounded-md p-2 text-text-secondary hover:bg-background-alt focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:opacity-40"
          >
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col gap-[var(--space-md)] overflow-y-auto p-[var(--space-lg)]">
            {/* Honeypot: hidden from sight, from assistive technology and from the
                tab order, so only an automated client that fills every input it
                finds will put anything in it. */}
            <div aria-hidden="true" className="pointer-events-none absolute h-0 w-0 overflow-hidden opacity-0">
              <label htmlFor={`${titleId}-hp`}>Leave this field empty</label>
              <input
                ref={honeypotRef}
                id={`${titleId}-hp`}
                type="text"
                name={HONEYPOT_FIELD}
                tabIndex={-1}
                autoComplete="off"
                defaultValue=""
              />
            </div>

            <div className="grid gap-[var(--space-md)] sm:grid-cols-2">
              <Input
                label="First name *"
                name="firstName"
                type="text"
                autoComplete="given-name"
                required
                maxLength={LEAD_LIMITS.firstName.max}
                value={draft.firstName}
                error={errors.firstName}
                aria-invalid={errors.firstName ? true : undefined}
                onChange={(event) => setValue("firstName", event.target.value)}
                onBlur={() => validateOnBlur("firstName")}
                disabled={submitting}
              />
              <Input
                label="Last name *"
                name="lastName"
                type="text"
                autoComplete="family-name"
                required
                maxLength={LEAD_LIMITS.lastName.max}
                value={draft.lastName}
                error={errors.lastName}
                aria-invalid={errors.lastName ? true : undefined}
                onChange={(event) => setValue("lastName", event.target.value)}
                onBlur={() => validateOnBlur("lastName")}
                disabled={submitting}
              />
            </div>

            <Input
              label="Email *"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={draft.email}
              error={errors.email}
              aria-invalid={errors.email ? true : undefined}
              onChange={(event) => setValue("email", event.target.value)}
              onBlur={() => validateOnBlur("email")}
              disabled={submitting}
            />

            <Input
              label="Contact number (optional)"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              maxLength={LEAD_LIMITS.phone.max}
              value={draft.phone}
              error={errors.phone}
              aria-invalid={errors.phone ? true : undefined}
              onChange={(event) => setValue("phone", event.target.value)}
              onBlur={() => validateOnBlur("phone")}
              disabled={submitting}
            />

            {formError && (
              <p
                role="alert"
                className="rounded-md border border-error/30 bg-error/5 px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-error"
              >
                {formError}
              </p>
            )}

            <p className="text-caption text-text-secondary">
              By continuing you agree to our{" "}
              <a
                href="/privacy-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-trust-navy underline underline-offset-2"
              >
                Privacy Policy
              </a>
              .
            </p>
          </div>

          <div className="flex flex-col-reverse gap-[var(--space-sm)] border-t border-border p-[var(--space-lg)] sm:flex-row sm:justify-end">
            <Button type="button" variant="outline" size="md" onClick={close} disabled={submitting} className="sm:w-auto">
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md" loading={submitting} className="sm:w-auto">
              {submitting ? "One moment…" : reading ? "Continue to the guide" : "Download PDF"}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
