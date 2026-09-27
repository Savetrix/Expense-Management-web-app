"use client";

// NOTE: the ported Vendor type (quickBooksSlice.ts) only carries
// _id/qbVendorId/displayName/normalizedName — mobile's screen-local Vendor
// type additionally assumed address/email/phone fields that don't exist on
// the real ported contract, so this row only ever shows the display name.
// Shared by VendorResolutionContentV2 (page) and VendorResolutionDialogV2.
export function VendorRowV2({
  vendor,
  isSelected,
  onSelect,
}: {
  vendor: { _id: string; displayName: string };
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center justify-between gap-[var(--space-sm)] rounded-md border px-[var(--space-md)] py-[var(--space-sm)] text-left transition-colors ${
        isSelected ? "border-accent bg-accent-bg/40" : "border-border bg-surface hover:bg-surface-alt"
      }`}
    >
      <p className={`min-w-0 flex-1 truncate text-body-sm font-semibold ${isSelected ? "text-accent" : "text-content-primary"}`}>
        {vendor.displayName}
      </p>
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
          isSelected ? "border-accent bg-accent" : "border-border-strong"
        }`}
      >
        {isSelected && <span className="h-2 w-2 rounded-full bg-surface" />}
      </span>
    </button>
  );
}
