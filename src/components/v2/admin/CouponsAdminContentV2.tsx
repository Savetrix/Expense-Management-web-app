"use client";

import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { confirmDialog, showToast } from "@/lib/dialogManager";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/Spinner";
import { ErrorState } from "@/components/ui/ErrorState";
import { Modal } from "@/components/v2/ui/Modal";
import { PageHeader } from "@/components/v2/ui/PageHeader";
import { TextInput } from "@/components/v2/ui/TextInput";
import { SelectDropdown } from "@/components/v2/ui/SelectDropdown";
import { useAppDispatch } from "@/store/hooks";
import {
  createCoupon,
  fetchCouponRedemptions,
  fetchCoupons,
  setCouponActive,
  type AdminCoupon,
  type CouponAudience,
  type CouponDuration,
  type CouponRedemptionRow,
  type CouponStatus,
} from "@/store/admin/couponAdminApi";

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const STATUS_META: Record<CouponStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-success/10 text-success" },
  inactive: { label: "Inactive", className: "bg-background-alt text-text-secondary" },
  expired: { label: "Expired", className: "bg-warning/10 text-warning" },
  used_up: { label: "Used up", className: "bg-background-alt text-text-secondary" },
};

const AUDIENCE_OPTIONS: { value: CouponAudience; label: string }[] = [
  { value: "all", label: "Everyone (new and existing customers)" },
  { value: "new", label: "New customers only (never paid for a plan)" },
];

const DURATION_OPTIONS: { value: CouponDuration; label: string }[] = [
  { value: "once", label: "First payment only" },
  { value: "repeating", label: "For a number of months" },
  { value: "forever", label: "Every payment (forever)" },
];

// What the admin is about to create, in plain words.
function summaryOf(form: CouponForm) {
  const pct = Number(form.percentOff) || 0;
  const months = Number(form.durationInMonths) || 0;
  const how =
    form.duration === "once"
      ? "on their first payment"
      : form.duration === "repeating"
        ? `for ${months} month${months === 1 ? "" : "s"}`
        : "on every payment";
  const uses = form.limited ? `Can be used ${Number(form.maxRedemptions) || 0} time(s) in total` : "Can be used any number of times until you deactivate it";
  const until = form.expiresAt ? `, until ${formatDate(form.expiresAt)}` : "";
  const who =
    form.audience === "new"
      ? "New customers (who have never paid for a plan) get"
      : "Any customer (new ones at checkout, paying ones from their next bill) gets";
  return `${who} ${pct}% off their plan ${how}. ${uses}${until}. Extra slots are never discounted.`;
}

interface CouponForm {
  code: string;
  percentOff: string;
  audience: CouponAudience;
  duration: CouponDuration;
  durationInMonths: string;
  limited: boolean;
  maxRedemptions: string;
  expiresAt: string;
}

const EMPTY_FORM: CouponForm = {
  code: "",
  percentOff: "",
  audience: "all",
  duration: "once",
  durationInMonths: "3",
  limited: false,
  maxRedemptions: "1",
  expiresAt: "",
};

// Admin › Coupons (inside AdminShellV2, which only renders for superadmins):
// create discount codes, see how often each was used and by whom, and
// deactivate them. A coupon is used when a plan is bought — at Checkout or
// with an upgrade; the backend (Scantrix_API coupon.service.js) keeps our
// rows and Stripe in step.
export function CouponsAdminContentV2() {
  const dispatch = useAppDispatch();

  const [coupons, setCoupons] = useState<AdminCoupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CouponForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [usesOf, setUsesOf] = useState<AdminCoupon | null>(null);
  const [uses, setUses] = useState<CouponRedemptionRow[] | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await dispatch(fetchCoupons());
    if (fetchCoupons.fulfilled.match(result)) setCoupons(result.payload);
    else setError(result.payload?.message ?? "Could not load coupons");
    setLoading(false);
  }, [dispatch]);

  useEffect(() => {
    load();
  }, [load]);

  const update = (patch: Partial<CouponForm>) => setForm((f) => ({ ...f, ...patch }));

  const handleCreate = async () => {
    const percentOff = Number(form.percentOff);
    if (!/^[A-Za-z0-9-]{3,30}$/.test(form.code.trim())) return setFormError("Code must be 3–30 letters, digits or dashes.");
    if (!(percentOff >= 1 && percentOff <= 100)) return setFormError("Discount must be between 1% and 100%.");
    if (form.duration === "repeating" && !(Number(form.durationInMonths) >= 1)) return setFormError("Enter how many months.");
    if (form.limited && !(Number(form.maxRedemptions) >= 1)) return setFormError("Enter how many times it can be used.");
    setFormError(null);

    setCreating(true);
    try {
      const result = await dispatch(
        createCoupon({
          code: form.code.trim(),
          percentOff,
          audience: form.audience,
          duration: form.duration,
          ...(form.duration === "repeating" && { durationInMonths: Number(form.durationInMonths) }),
          maxRedemptions: form.limited ? Number(form.maxRedemptions) : null,
          // End of the chosen day, local time.
          expiresAt: form.expiresAt ? new Date(`${form.expiresAt}T23:59:59`).toISOString() : null,
        }),
      );
      if (createCoupon.fulfilled.match(result)) {
        showToast(`Coupon ${result.payload.code} created.`, "success");
        setCoupons((list) => [result.payload, ...list]);
        setCreateOpen(false);
        setForm(EMPTY_FORM);
      } else {
        setFormError(result.payload?.message ?? "Could not create the coupon.");
      }
    } finally {
      setCreating(false);
    }
  };

  const handleToggle = async (coupon: AdminCoupon) => {
    const active = !coupon.active;
    if (!active) {
      const confirmed = await confirmDialog({
        title: `Deactivate ${coupon.code}?`,
        message: "Nobody can use this code any more. Customers who already used it keep their discount.",
        confirmLabel: "Deactivate",
        tone: "destructive",
      });
      if (!confirmed) return;
    }
    setTogglingId(coupon._id);
    try {
      const result = await dispatch(setCouponActive({ couponId: coupon._id, active }));
      if (setCouponActive.fulfilled.match(result)) {
        setCoupons((list) => list.map((c) => (c._id === coupon._id ? result.payload : c)));
        showToast(`${coupon.code} ${active ? "activated" : "deactivated"}.`, "success");
      } else {
        showToast(result.payload?.message ?? "Could not update the coupon.", "error");
      }
    } finally {
      setTogglingId(null);
    }
  };

  const openUses = async (coupon: AdminCoupon) => {
    setUsesOf(coupon);
    setUses(null);
    const result = await dispatch(fetchCouponRedemptions(coupon._id));
    if (fetchCouponRedemptions.fulfilled.match(result)) setUses(result.payload.redemptions);
    else {
      showToast(result.payload?.message ?? "Could not load who used this coupon.", "error");
      setUsesOf(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Coupons"
        subtitle="Discount codes used when a plan is bought, at checkout or with an upgrade. They apply to the plan only, never to extra slots."
        action={
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus size={16} strokeWidth={2.25} className="mr-1 inline" />
            Create coupon
          </Button>
        }
      />

      <div className="mt-[var(--space-lg)]">
        {loading ? (
          <div className="flex justify-center py-[var(--space-xl)]">
            <Spinner size="md" />
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={load} />
        ) : coupons.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-[var(--space-lg)] text-center text-body-sm text-text-secondary">
            No coupons yet. Create one to give new subscribers a discount.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[720px] text-left text-body-sm">
              <thead className="border-b border-border text-caption uppercase tracking-wide text-text-secondary">
                <tr>
                  <th className="px-[var(--space-md)] py-[var(--space-sm)]">Code</th>
                  <th className="px-[var(--space-md)] py-[var(--space-sm)]">Discount</th>
                  <th className="px-[var(--space-md)] py-[var(--space-sm)]">Used</th>
                  <th className="px-[var(--space-md)] py-[var(--space-sm)]">Expires</th>
                  <th className="px-[var(--space-md)] py-[var(--space-sm)]">Status</th>
                  <th className="px-[var(--space-md)] py-[var(--space-sm)] text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {coupons.map((coupon) => {
                  const status = STATUS_META[coupon.status];
                  return (
                    <tr key={coupon._id} className="border-b border-border last:border-0">
                      <td className="px-[var(--space-md)] py-[var(--space-sm)] font-mono font-bold text-text-primary">{coupon.code}</td>
                      <td className="px-[var(--space-md)] py-[var(--space-sm)] text-text-primary">
                        {coupon.description}
                        <span className="block text-caption text-text-secondary">
                          {coupon.audience === "new" ? "New customers only" : "Everyone"}
                        </span>
                      </td>
                      <td className="px-[var(--space-md)] py-[var(--space-sm)] text-text-primary">
                        {coupon.timesRedeemed} / {coupon.maxRedemptions ?? "∞"}
                      </td>
                      <td className="px-[var(--space-md)] py-[var(--space-sm)] text-text-secondary">{formatDate(coupon.expiresAt)}</td>
                      <td className="px-[var(--space-md)] py-[var(--space-sm)]">
                        <span className={`rounded-full px-[var(--space-sm)] py-[var(--space-xs)] text-caption font-bold ${status.className}`}>
                          {status.label}
                        </span>
                      </td>
                      <td className="px-[var(--space-md)] py-[var(--space-sm)]">
                        <div className="flex justify-end gap-[var(--space-sm)]">
                          <button
                            type="button"
                            onClick={() => openUses(coupon)}
                            className="rounded-lg border border-border px-[var(--space-sm)] py-[var(--space-xs)] font-semibold text-text-primary hover:bg-surface-alt"
                          >
                            Who used it
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggle(coupon)}
                            disabled={togglingId === coupon._id}
                            className={`rounded-lg px-[var(--space-sm)] py-[var(--space-xs)] font-semibold disabled:opacity-60 ${
                              coupon.active ? "border border-red-600/40 text-red-600" : "border border-primary text-primary"
                            }`}
                          >
                            {togglingId === coupon._id ? <Spinner size="sm" /> : coupon.active ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={createOpen}
        onClose={() => !creating && setCreateOpen(false)}
        title="Create a coupon"
        footer={
          <>
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              disabled={creating}
              className="rounded-lg px-[var(--space-md)] py-[var(--space-sm)] text-body-sm font-semibold text-content-secondary hover:bg-surface-alt"
            >
              Cancel
            </button>
            <Button size="sm" onClick={handleCreate} loading={creating}>
              Create coupon
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-[var(--space-md)]">
          <TextInput
            label="Code"
            placeholder="SAVE5"
            value={form.code}
            onChange={(event) => update({ code: event.target.value.toUpperCase() })}
            autoFocus
          />
          <TextInput
            label="Discount (% off)"
            type="number"
            min={1}
            max={100}
            step="any"
            placeholder="5"
            value={form.percentOff}
            onChange={(event) => update({ percentOff: event.target.value })}
          />
          <SelectDropdown
            label="Who can use it"
            value={form.audience}
            onChange={(event) => update({ audience: event.target.value as CouponAudience })}
          >
            {AUDIENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectDropdown>
          <SelectDropdown
            label="How long the customer keeps the discount"
            value={form.duration}
            onChange={(event) => update({ duration: event.target.value as CouponDuration })}
          >
            {DURATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </SelectDropdown>
          {form.duration === "repeating" && (
            <TextInput
              label="Number of months"
              type="number"
              min={1}
              max={36}
              value={form.durationInMonths}
              onChange={(event) => update({ durationInMonths: event.target.value })}
            />
          )}

          <fieldset className="flex flex-col gap-[var(--space-xs)]">
            <legend className="mb-[var(--space-xs)] text-body-sm font-semibold text-text-primary">How many times can it be used?</legend>
            <label className="flex items-center gap-[var(--space-sm)] text-body-sm text-text-primary">
              <input type="radio" checked={!form.limited} onChange={() => update({ limited: false })} />
              Unlimited, until I deactivate it
            </label>
            <label className="flex items-center gap-[var(--space-sm)] text-body-sm text-text-primary">
              <input type="radio" checked={form.limited} onChange={() => update({ limited: true })} />
              Limited to
              <input
                type="number"
                min={1}
                value={form.maxRedemptions}
                onChange={(event) => update({ maxRedemptions: event.target.value, limited: true })}
                aria-label="Number of uses"
                className="w-20 rounded-md border border-border bg-surface px-[var(--space-sm)] py-1 text-body-sm text-text-primary"
              />
              use(s) in total
            </label>
          </fieldset>

          <TextInput
            label="Expires on (optional)"
            type="date"
            value={form.expiresAt}
            min={new Date().toISOString().slice(0, 10)}
            onChange={(event) => update({ expiresAt: event.target.value })}
          />

          <p className="rounded-lg bg-background-soft px-[var(--space-md)] py-[var(--space-sm)] text-body-sm text-text-secondary">
            {summaryOf(form)} Each customer can use a coupon once.
          </p>
          {formError && <p className="text-body-sm text-status-danger-text">{formError}</p>}
        </div>
      </Modal>

      <Modal
        open={usesOf !== null}
        onClose={() => setUsesOf(null)}
        title={usesOf ? `Who used ${usesOf.code}` : ""}
        widthClassName="max-w-2xl"
      >
        {uses === null ? (
          <div className="flex justify-center py-[var(--space-lg)]">
            <Spinner size="md" />
          </div>
        ) : uses.length === 0 ? (
          <p className="text-body-sm text-text-secondary">Nobody has used this coupon yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {uses.map((row) => (
              <li key={row._id} className="flex flex-wrap items-center justify-between gap-[var(--space-sm)] py-[var(--space-sm)]">
                <div className="min-w-0">
                  <p className="font-semibold text-text-primary">{row.user?.name || "Deleted user"}</p>
                  <p className="text-caption text-text-secondary">{row.user?.email ?? "—"}</p>
                </div>
                <div className="text-right text-body-sm">
                  <p className="text-text-primary">
                    <span className="capitalize">{row.plan ?? "—"}</span>
                    {row.billingInterval ? ` · ${row.billingInterval}` : ""} · −${row.amountOff.toFixed(2)}
                  </p>
                  <p className="text-caption text-text-secondary">{formatDate(row.redeemedAt)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
