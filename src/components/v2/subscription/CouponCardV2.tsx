"use client";

import { Tag } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { Spinner } from "@/components/ui/Spinner";
import { useAppDispatch } from "@/store/hooks";
import { fetchDiscount, validateCoupon, type CurrentDiscount } from "@/store/subscription/subscriptionApi";
import type { MySubscription } from "@/store/subscription/subscriptionSlice";

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// The coupon on the subscription now, and a field to check a new code. A
// coupon is only used when a plan is bought (Checkout, or an upgrade), so a
// valid code is carried to the plans page (/plans?coupon=…) to pick one.
export function CouponCardV2({ subscription }: { subscription: MySubscription }) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const onStripe = subscription.provider === "stripe";

  const [discount, setDiscount] = useState<CurrentDiscount | null>(null);
  const [code, setCode] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDiscount = useCallback(async () => {
    if (!onStripe) return setDiscount(null);
    const result = await dispatch(fetchDiscount());
    if (fetchDiscount.fulfilled.match(result)) setDiscount(result.payload);
  }, [dispatch, onStripe]);

  useEffect(() => {
    loadDiscount();
  }, [loadDiscount]);

  const handleApply = async () => {
    const typed = code.trim();
    if (!typed || checking) return;
    setChecking(true);
    setError(null);
    try {
      const result = await dispatch(validateCoupon(typed));
      if (!validateCoupon.fulfilled.match(result)) {
        setError(result.payload?.message || "This coupon can't be used.");
        return;
      }
      router.push(`/plans?coupon=${encodeURIComponent(result.payload.coupon.code)}`);
    } finally {
      setChecking(false);
    }
  };

  return (
    <div>
      <h3 className="mb-[var(--space-md)] text-h3 font-bold text-trust-navy">Coupon</h3>
      <div className="flex flex-col gap-[var(--space-md)] rounded-lg border border-border bg-surface p-[var(--space-md)]">
        {discount && (
          <div className="flex items-start gap-[var(--space-sm)] rounded-lg border border-success/30 bg-success/5 px-[var(--space-md)] py-[var(--space-sm)] text-body-sm">
            <Tag size={16} strokeWidth={2.25} className="mt-0.5 shrink-0 text-success" />
            <p className="text-text-secondary">
              {discount.code && <span className="font-bold text-text-primary">{discount.code}</span>}
              {discount.code && ": "}
              {discount.description}.{" "}
              {discount.endsAt ? <>Ends on {formatDate(discount.endsAt)}.</> : "Applies to every payment."}
            </p>
          </div>
        )}

        <form
          className="flex gap-[var(--space-sm)]"
          onSubmit={(event) => {
            event.preventDefault();
            handleApply();
          }}
        >
          <input
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="Have a coupon code?"
            aria-label="Coupon code"
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-[var(--space-md)] py-[var(--space-sm)] text-body-sm uppercase text-text-primary"
          />
          <button
            type="submit"
            disabled={!code.trim() || checking}
            className="rounded-lg bg-primary px-[var(--space-md)] py-[var(--space-sm)] text-body-sm font-bold text-white disabled:opacity-60"
          >
            {checking ? <Spinner size="sm" /> : "Apply"}
          </button>
        </form>
        {error && <p className="text-caption text-status-danger-text">{error}</p>}
        <p className="text-caption text-text-secondary">
          {onStripe
            ? "A coupon is used when you upgrade your plan. Extra slots aren't discounted."
            : "You'll use it when you pick a plan."}
        </p>
      </div>
    </div>
  );
}
