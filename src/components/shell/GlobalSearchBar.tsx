"use client";

import { usePathname, useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { KeyboardEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { getInvoices } from "@/store/invoice/invoiceApi";
import { fetchQuickBooksAccounts, fetchQuickBooksTaxCodes, fetchQuickBooksVendors } from "@/store/quickBooks/quickBooksApi";
import { SEARCH_CATEGORY_LABELS, searchAll, type SearchResult, type SearchResultCategory } from "@/lib/globalSearch";

const CATEGORY_ORDER: SearchResultCategory[] = ["invoice", "vendor", "glAccount", "taxCode"];
// Just avoids the dropdown flashing open/closed while the user is still
// mid-word — the filtering itself is synchronous in-memory work either way.
const DEBOUNCE_MS = 150;

export function GlobalSearchBar() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const pathname = usePathname();
  const isV2 = pathname.startsWith("/v2");

  const accessToken = useAppSelector((state) => state.auth.user?.data?.accessToken);
  const qbConnectionId = useAppSelector((state) => state.quickBooks.qbConnectionId);
  const invoices = useAppSelector((state) => state.invoice.invoices);
  const vendors = useAppSelector((state) => state.quickBooks.vendors);
  const accounts = useAppSelector((state) => state.quickBooks.accounts);
  const taxCodes = useAppSelector((state) => state.quickBooks.taxCodes);

  const [rawQuery, setRawQuery] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  // Below lg the inline bar has no room (see render below) — it collapses to
  // an icon button that opens this as a full-width overlay instead.
  const [mobileOpen, setMobileOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const handle = setTimeout(() => setQuery(rawQuery), DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [rawQuery]);

  // Most pages only load the one or two lists they render (see
  // VendorsContent/GLTaxCodeContent/InvoiceListContent), but the search bar
  // needs all four regardless of which page it's mounted on — so it fetches
  // them itself, gated the same way every other QB-scoped fetch in this app
  // is: on accessToken + qbConnectionId being present.
  useEffect(() => {
    if (!accessToken || !qbConnectionId) return;
    dispatch(getInvoices());
    dispatch(fetchQuickBooksVendors({ accessToken }));
    dispatch(fetchQuickBooksAccounts({ accessToken }));
    dispatch(fetchQuickBooksTaxCodes({ accessToken }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, qbConnectionId]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // The mobile overlay is a separate fixed-position layer (not a native
  // :focus target until it mounts), so it needs to grab focus itself.
  useEffect(() => {
    if (mobileOpen) mobileInputRef.current?.focus();
  }, [mobileOpen]);

  // Same background-scroll-lock reasoning as AppShell's mobile nav drawer.
  useEffect(() => {
    if (!mobileOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileOpen]);

  const groups = useMemo(() => {
    const results = searchAll(query, { invoices, vendors, accounts, taxCodes });
    return CATEGORY_ORDER.map((category) => ({
      category,
      label: SEARCH_CATEGORY_LABELS[category],
      items: results.filter((result) => result.category === category),
    })).filter((group) => group.items.length > 0);
  }, [query, invoices, vendors, accounts, taxCodes]);

  const flatResults = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  useEffect(() => {
    setActiveIndex(flatResults.length > 0 ? 0 : -1);
  }, [flatResults.length, query]);

  const closeMobile = () => {
    setMobileOpen(false);
    setRawQuery("");
    setQuery("");
  };

  const handleSelect = (result: SearchResult) => {
    setOpen(false);
    setMobileOpen(false);
    setRawQuery("");
    setQuery("");
    // searchAll's hrefs are all v1 paths (see src/lib/globalSearch.ts) — stay
    // inside v2 when the search bar is invoked from a v2 screen instead of
    // bouncing back to the legacy route.
    router.push(isV2 ? `/v2${result.href}` : result.href);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      setOpen(false);
      closeMobile();
      return;
    }
    if (flatResults.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((i) => (i + 1) % flatResults.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((i) => (i - 1 + flatResults.length) % flatResults.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const active = flatResults[activeIndex];
      if (active) handleSelect(active);
    }
  };

  const hasQuery = query.trim().length > 0;

  let resultsList: ReactNode;
  if (flatResults.length === 0) {
    resultsList = (
      <p className="px-[var(--space-sm)] py-[var(--space-md)] text-center text-body-sm text-text-secondary">
        No matches for &ldquo;{query}&rdquo;
      </p>
    );
  } else {
    resultsList = groups.map((group) => (
      <div key={group.category} className="mb-[var(--space-xs)] last:mb-0">
        <p className="px-[var(--space-sm)] py-[var(--space-xs)] text-caption font-bold uppercase tracking-wide text-text-secondary">
          {group.label}
        </p>
        {group.items.map((item) => {
          const flatIndex = flatResults.indexOf(item);
          const active = flatIndex === activeIndex;
          return (
            <button
              key={`${item.category}-${item.id}`}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleSelect(item)}
              onMouseEnter={() => setActiveIndex(flatIndex)}
              className={`flex w-full flex-col items-start gap-0.5 rounded-md px-[var(--space-sm)] py-[var(--space-sm)] text-left ${
                active ? "bg-primary-50" : "hover:bg-background-alt"
              }`}
            >
              <span className="w-full truncate text-body-sm font-semibold text-text-primary">{item.title}</span>
              {item.subtitle && (
                <span className="w-full truncate text-caption text-text-secondary">{item.subtitle}</span>
              )}
            </button>
          );
        })}
      </div>
    ));
  }

  return (
    <>
      {/* lg and up: inline bar with its own absolutely-positioned dropdown */}
      <div ref={containerRef} className="relative hidden w-64 shrink-0 lg:block">
        <label className="flex items-center gap-[var(--space-sm)] rounded-pill bg-background-alt px-[var(--space-md)] py-[var(--space-sm)]">
          <Search size={16} strokeWidth={2.25} className="shrink-0 text-text-secondary" />
          <input
            type="text"
            value={rawQuery}
            onChange={(event) => {
              setRawQuery(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder="Search invoices, vendors…"
            role="combobox"
            aria-expanded={open && hasQuery}
            aria-autocomplete="list"
            aria-controls="global-search-results-desktop"
            className="w-full bg-transparent text-body-sm text-text-primary outline-none placeholder:text-text-secondary"
          />
        </label>

        {open && hasQuery && (
          <div
            id="global-search-results-desktop"
            className="absolute left-0 top-full z-20 mt-[var(--space-xs)] max-h-96 w-96 overflow-y-auto rounded-lg border border-border bg-white p-[var(--space-xs)] shadow-md"
          >
            {resultsList}
          </div>
        )}
      </div>

      {/* Below lg: an icon that opens a full-width overlay instead of trying
          to squeeze a 256px input + 384px dropdown into a phone header. */}
      <button
        type="button"
        aria-label="Search"
        onClick={() => setMobileOpen(true)}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-border text-text-secondary hover:bg-background-alt lg:hidden"
      >
        <Search size={18} strokeWidth={2} />
      </button>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={closeMobile} />
          <div
            className="relative mx-[var(--space-md)] mt-[var(--space-md)] flex max-h-[80dvh] flex-col overflow-hidden rounded-lg bg-white shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <label className="flex shrink-0 items-center gap-[var(--space-sm)] border-b border-border px-[var(--space-md)] py-[var(--space-sm)]">
              <Search size={16} strokeWidth={2.25} className="shrink-0 text-text-secondary" />
              <input
                ref={mobileInputRef}
                type="text"
                value={rawQuery}
                onChange={(event) => setRawQuery(event.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Search invoices, vendors…"
                role="combobox"
                aria-expanded={hasQuery}
                aria-autocomplete="list"
                aria-controls="global-search-results-mobile"
                className="w-full bg-transparent text-body-sm text-text-primary outline-none placeholder:text-text-secondary"
              />
              <button
                type="button"
                aria-label="Close search"
                onClick={closeMobile}
                className="shrink-0 text-text-secondary hover:text-text-primary"
              >
                <X size={18} strokeWidth={2} />
              </button>
            </label>
            {hasQuery && (
              <div id="global-search-results-mobile" className="overflow-y-auto p-[var(--space-xs)]">
                {resultsList}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
