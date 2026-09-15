export interface TabItem {
  value: string;
  label: string;
  count?: number;
}

interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
}

// Pill-container segmented control used for GL Account's account-type
// filter, Vendors' Active/Inactive tabs, and Subscription's Monthly/Yearly
// billing toggle — same visual pattern, different labels, in the Stitch
// export.
export function Tabs({ items, value, onChange }: TabsProps) {
  return (
    <div role="tablist" className="inline-flex items-center gap-[var(--space-xs)] rounded-md bg-surface-alt p-[var(--space-xs)]">
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={`rounded-sm px-[var(--space-md)] py-[var(--space-xs)] text-body-sm font-semibold transition-colors ${
              active ? "bg-surface text-content-primary shadow-sm" : "text-content-secondary hover:text-content-primary"
            }`}
          >
            {item.label}
            {typeof item.count === "number" && <span className="ml-[var(--space-xs)] text-content-muted">({item.count})</span>}
          </button>
        );
      })}
    </div>
  );
}
