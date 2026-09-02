"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, X } from "lucide-react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  EMPTY_DRAFT,
  ENQUIRY_FIELDS,
  FIELD_LIMITS,
  sanitizeDraft,
  validateDraft,
  validateField,
  type EnquiryDraft,
  type EnquiryField,
  type EnquirySurface,
  type FieldErrors,
} from "@/lib/customPlanEnquiry/fields";

// The Custom Plan enquiry form, shared by BOTH pricing surfaces — the in-app
// /plans page and the public landing page's pricing section. One component
// because the two must not drift: a field added for sales here has to reach
// sales from either entry point.
//
// ── WHY A PORTAL, WHEN DialogHost DOES NOT USE ONE ───────────────────────────
// DialogHost is mounted once at the root (src/app/providers.tsx), so its
// `fixed inset-0` is never nested inside anything. This modal is opened from
// deep inside two different trees, and on the landing page every section is
// wrapped in `<Reveal>` — whose `.lp-reveal` class sets `will-change: transform`
// (src/app/globals.css). An element with `will-change: transform` becomes the
// containing block for its fixed-position descendants, which would pin this
// dialog inside a pricing card instead of the viewport. Rendering into
// document.body sidesteps that, and every other stacking surprise, in both
// surfaces at once.

/** Hidden field name. Must match HONEYPOT_FIELD in the route handler. */
const HONEYPOT_FIELD = "website";

const FIELD_LABELS: Record<EnquiryField, string> = {
  name: "Your name",
  email: "Work email",
  company: "Company name",
  message: "What do you need?",
};

interface CustomPlanEnquiryModalProps {
  onClose: () => void;
  /** Recorded on the enquiry so sales knows which surface it came from. */
  surface: EnquirySurface;
  /** Prefill for a signed-in user. Ignored on the public landing page. */
  defaultName?: string;
  defaultEmail?: string;
  /** Opaque account id, forwarded as a lead for sales. Never an auth claim. */
  userId?: string | null;
}

type Status = "idle" | "submitting" | "success";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function CustomPlanEnquiryModal({
  onClose,
  surface,
  defaultName,
  defaultEmail,
  userId,
}: CustomPlanEnquiryModalProps) {
  // Mounted only while open (the parent renders it conditionally), so every
  // piece of state below starts fresh on each opening. That is why there is no
  // reset effect: a stale success panel, or the previous visitor's details,
  // cannot survive a close because the component itself does not.
  const [draft, setDraft] = useState<EnquiryDraft>(() => ({
    ...EMPTY_DRAFT,
    name: defaultName ?? "",
    email: defaultEmail ?? "",
  }));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");

  const dialogRef = useRef<HTMLDivElement>(null);
  const honeypotRef = useRef<HTMLInputElement>(null);
  // Guards against a second submit slipping through between the click and
  // React committing `status`. A disabled button alone does not cover an Enter
  // keypress landing in the same tick.
  const inFlightRef = useRef(false);
  // Whatever had focus before we opened, so it can be handed back on close.
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const titleId = useId();
  const descriptionId = useId();
  const statusId = useId();

  const close = useCallback(() => {
    // An in-flight submit must not be abandoned half-way — the request would
    // still land and send the email while the user believes they cancelled.
    if (inFlightRef.current) return;
    onClose();
  }, [onClose]);

  // Escape to dismiss, and a focus trap so Tab cannot wander into the page
  // behind the dialog. Both are on the document rather than the dialog so they
  // work even if focus has escaped somehow.
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

    // Stop the page behind from scrolling under the dialog on touch devices.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus?.();
    };
  }, [close]);

  // Move focus into the dialog once it is on screen. The first field, not the
  // close button: the user came here to type.
  useEffect(() => {
    if (status === "success") return;
    const timer = window.setTimeout(() => {
      dialogRef.current?.querySelector<HTMLElement>("input, textarea")?.focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [status]);

  const setValue = (field: EnquiryField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    // Clear an error as soon as the user starts fixing it. Re-validating on
    // every keystroke instead would flag "invalid email" after the first
    // character, which reads as the form arguing with you as you type.
    setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current));
  };

  const validateOnBlur = (field: EnquiryField) => {
    // Blur validates against the SANITIZED value, which is what the server will
    // see — otherwise trailing whitespace could pass here and fail there.
    const sanitized = sanitizeDraft(draft)[field];
    const error = validateField(field, sanitized);
    setErrors((current) => ({ ...current, [field]: error ?? undefined }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (inFlightRef.current || status === "submitting") return;

    const sanitized = sanitizeDraft(draft);
    const nextErrors = validateDraft(sanitized);
    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setFormError(null);
      // Send focus to the first problem so a keyboard or screen-reader user is
      // taken to it rather than left to hunt for the red text.
      const firstBad = ENQUIRY_FIELDS.find((field) => nextErrors[field]);
      if (firstBad) {
        dialogRef.current?.querySelector<HTMLElement>(`[name="${firstBad}"]`)?.focus();
      }
      return;
    }

    // Show the user the cleaned values they are actually sending.
    setDraft(sanitized);
    setErrors({});
    setFormError(null);
    inFlightRef.current = true;
    setStatus("submitting");

    try {
      const response = await fetch("/api/custom-plan-enquiry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...sanitized,
          surface,
          userId: userId ?? undefined,
          // Always sent, always empty from a real browser. See the route.
          [HONEYPOT_FIELD]: honeypotRef.current?.value ?? "",
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; fieldErrors?: FieldErrors }
        | null;

      if (!response.ok) {
        // A recoverable failure leaves `draft` exactly as the user typed it —
        // nothing is cleared — so retrying costs one click, not a retype.
        if (payload?.fieldErrors) setErrors(payload.fieldErrors);
        setFormError(
          payload?.error ?? "We couldn't send your enquiry. Please try again in a moment.",
        );
        return;
      }

      setStatus("success");
    } catch {
      // Offline, DNS, connection reset. Same rule: keep what they typed.
      setFormError(
        "We couldn't reach Scantrix. Check your connection — your details are still here.",
      );
    } finally {
      inFlightRef.current = false;
      // Only leave the submitting state if we did not succeed; the success
      // panel replaces the form entirely.
      setStatus((current) => (current === "success" ? current : "idle"));
    }
  };

  // createPortal needs a real DOM node, which does not exist during a server
  // render. The parent only mounts this component from a click handler, so in
  // practice `document` is always here — but AGENTS.md records a real SSR
  // prerender crash from exactly this class of unguarded browser access, and
  // the guard costs nothing.
  if (typeof document === "undefined") return null;

  const submitting = status === "submitting";

  return createPortal(
    <div
      // z-[120] clears DialogHost's confirm backdrop (z-[100]) and its toast
      // stack (z-[110]), so an error toast raised elsewhere cannot paint over
      // this dialog — the exact bug DialogHost documents having had.
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-[var(--space-lg)]"
      onMouseDown={(event) => {
        // mousedown, not click: a click handler fires when a drag that STARTED
        // inside the dialog (selecting the message text) ends on the backdrop,
        // which would throw away everything the user had typed.
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        // Bottom sheet on phones, centred card from sm up — the pattern the app
        // already uses for full-bleed transient surfaces.
        className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-xl bg-white shadow-xl sm:max-h-[88dvh] sm:rounded-xl"
      >
        <div className="flex items-start justify-between gap-[var(--space-md)] border-b border-border p-[var(--space-lg)]">
          <div className="min-w-0">
            <h2 id={titleId} className="text-h3 font-bold text-trust-navy">
              {status === "success" ? "Enquiry sent" : "Talk to our team"}
            </h2>
            <p id={descriptionId} className="mt-[var(--space-xs)] text-body-sm text-text-secondary">
              {status === "success"
                ? "Thanks — we've got your details."
                : "Tell us how you work and we'll put together a plan and a price that fit."}
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

        {status === "success" ? (
          <div className="flex flex-col items-center gap-[var(--space-md)] p-[var(--space-lg)] text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
              <CheckCircle2 size={24} strokeWidth={2} className="text-success" />
            </span>
            <p role="status" className="text-body-sm text-text-primary">
              Your enquiry is with the Scantrix team. We usually reply within one business day — keep
              an eye on <strong className="font-semibold">{draft.email}</strong>.
            </p>
            <Button type="button" variant="primary" size="md" onClick={close} className="w-full">
              Done
            </Button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-[var(--space-md)] overflow-y-auto p-[var(--space-lg)]">
              {/*
                Honeypot. Hidden from sight, from assistive technology and from
                the tab order — so only an automated client that fills every
                input it can find will put anything in it. `position:absolute`
                with `opacity:0` rather than `display:none`, because some bots
                skip fields that are display:none.
              */}
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

              <Input
                label={`${FIELD_LABELS.name} *`}
                name="name"
                type="text"
                autoComplete="name"
                required
                maxLength={FIELD_LIMITS.name.max}
                value={draft.name}
                error={errors.name}
                aria-invalid={errors.name ? true : undefined}
                onChange={(event) => setValue("name", event.target.value)}
                onBlur={() => validateOnBlur("name")}
                disabled={submitting}
              />

              <Input
                label={`${FIELD_LABELS.email} *`}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                maxLength={FIELD_LIMITS.email.max}
                value={draft.email}
                error={errors.email}
                aria-invalid={errors.email ? true : undefined}
                onChange={(event) => setValue("email", event.target.value)}
                onBlur={() => validateOnBlur("email")}
                disabled={submitting}
              />

              <Input
                label={`${FIELD_LABELS.company} (optional)`}
                name="company"
                type="text"
                autoComplete="organization"
                maxLength={FIELD_LIMITS.company.max}
                value={draft.company}
                error={errors.company}
                aria-invalid={errors.company ? true : undefined}
                onChange={(event) => setValue("company", event.target.value)}
                onBlur={() => validateOnBlur("company")}
                disabled={submitting}
              />

              {/*
                Hand-rolled rather than reaching for ui/Input: that component
                renders an <input>, and widening it to cover textareas would
                change a primitive every auth form depends on. The classes below
                mirror it exactly so the two read as one control family.
              */}
              <div className="flex flex-col gap-[var(--space-xs)]">
                <label htmlFor={`${statusId}-message`} className="text-body-sm font-semibold text-trust-navy">
                  {FIELD_LABELS.message} *
                </label>
                <textarea
                  id={`${statusId}-message`}
                  name="message"
                  rows={5}
                  required
                  maxLength={FIELD_LIMITS.message.max}
                  value={draft.message}
                  aria-invalid={errors.message ? true : undefined}
                  aria-describedby={errors.message ? `${statusId}-message-error` : `${statusId}-message-hint`}
                  placeholder="How many invoices a month, how many companies or entities, the team size, and anything you need us to integrate with."
                  onChange={(event) => setValue("message", event.target.value)}
                  onBlur={() => validateOnBlur("message")}
                  disabled={submitting}
                  className={`min-h-[120px] resize-y rounded-md border bg-white px-[var(--space-md)] py-[var(--space-sm)] text-body text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60 ${
                    errors.message ? "border-error" : "border-border"
                  }`}
                />
                {errors.message ? (
                  <p id={`${statusId}-message-error`} className="text-caption font-medium text-error">
                    {errors.message}
                  </p>
                ) : (
                  <p id={`${statusId}-message-hint`} className="text-caption text-text-secondary">
                    {draft.message.length} / {FIELD_LIMITS.message.max}
                  </p>
                )}
              </div>

              {/*
                Form-level failures (network, provider, rate limit) land here,
                announced rather than merely shown — the submit button is at the
                bottom and the message would otherwise scroll out of view.
              */}
              {formError && (
                <p
                  role="alert"
                  className="rounded-md border border-error/30 bg-error/5 px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-error"
                >
                  {formError}
                </p>
              )}
            </div>

            <div className="flex flex-col-reverse gap-[var(--space-sm)] border-t border-border p-[var(--space-lg)] sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                size="md"
                onClick={close}
                disabled={submitting}
                className="sm:w-auto"
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" size="md" loading={submitting} className="sm:w-auto">
                {submitting ? "Sending…" : "Send enquiry"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
