"use client";

import { useRouter } from "next/navigation";
import { Repeat, SlidersHorizontal } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { PageHeader, Tabs } from "@/components/v2/ui";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { fetchMonthEndSettings, fetchPrepayment, fetchPrepayments } from "@/store/monthEnd/monthEndApi";
import type { MonthEndSettingsDto, PrepaymentDto } from "@/store/monthEnd/monthEndApi";
import { useActiveProvider } from "@/store/quickBooks/useActiveProvider";
import { showToast } from "@/lib/dialogManager";

import { ERROR_NOTE_CLASS } from "./shared";
import { MonthEndSettingsModal } from "./MonthEndSettingsModal";
import { PrepaymentScheduleModal } from "./PrepaymentScheduleModal";
import { PrepaymentsTab } from "./PrepaymentsTab";

// Month-End Adjustments (layout from the ScanTrix-X-Breifcase branch). Only
// Prepayments for now — deferred income joins as a second tab in Phase 2.
// Owners, admins and accountants only (the API refuses contributors).
const POSTING_ROLES = new Set(["owner", "admin", "accountant"]);

export function MonthEndContentV2({ openPrepaymentId = null }: { openPrepaymentId?: string | null }) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const provider = useActiveProvider();
  const connections = useAppSelector((state) => state.quickBooks.connections);
  const qbConnectionId = useAppSelector((state) => state.quickBooks.qbConnectionId);
  const active = connections.length === 1 ? connections[0] : connections.find((c) => c._id === qbConnectionId);
  const activeId = active?._id ?? "";
  const canPost = POSTING_ROLES.has(active?.role ?? "");

  const [list, setList] = useState<{ forId: string; items: PrepaymentDto[]; error: string }>({ forId: "", items: [], error: "" });
  const [settings, setSettings] = useState<MonthEndSettingsDto | null>(null);
  const [settingsError, setSettingsError] = useState("");
  // The company on screen now: a reply for one we've since left is dropped.
  const currentIdRef = useRef(activeId);
  currentIdRef.current = activeId;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selected, setSelected] = useState<PrepaymentDto | null>(null);

  const load = useCallback(async () => {
    if (!activeId) return;
    const result = await dispatch(fetchPrepayments());
    if (currentIdRef.current !== activeId) return;
    if (fetchPrepayments.fulfilled.match(result)) setList({ forId: activeId, items: result.payload, error: "" });
    else setList({ forId: activeId, items: [], error: result.payload?.message ?? "Couldn't load prepayments." });
  }, [activeId, dispatch]);

  const loadSettings = useCallback(async () => {
    if (!activeId) return;
    setSettingsError("");
    const r = await dispatch(fetchMonthEndSettings());
    if (currentIdRef.current !== activeId) return;
    if (fetchMonthEndSettings.fulfilled.match(r)) setSettings(r.payload);
    else setSettingsError(r.payload?.message ?? "Couldn't load the prepayment settings.");
  }, [activeId, dispatch]);

  useEffect(() => {
    void load();
    setSelected(null);
    setSettings(null);
    void loadSettings();
  }, [load, loadSettings]);

  // Opened from an invoice (?prepayment=<id>): show that schedule once. The URL
  // is cleaned only once it opened (a refresh then doesn't reopen it); a read
  // that failed for any other reason than "not here" can be tried again.
  const [deepLink, setDeepLink] = useState<{ id: string; error: string } | null>(openPrepaymentId ? { id: openPrepaymentId, error: "" } : null);
  const openDeepLink = useCallback(async () => {
    if (!deepLink || !activeId) return;
    setDeepLink({ ...deepLink, error: "" });
    const r = await dispatch(fetchPrepayment(deepLink.id));
    if (fetchPrepayment.fulfilled.match(r)) {
      setSelected(r.payload);
      setDeepLink(null);
      router.replace("/month-end");
    } else if (r.payload?.statusCode === 404) {
      setDeepLink(null);
      router.replace("/month-end");
      showToast("That prepayment isn't in this company — pick its company in the header.", "warning");
    } else {
      setDeepLink({ id: deepLink.id, error: r.payload?.message ?? "Couldn't open that prepayment." });
    }
  }, [deepLink, activeId, dispatch, router]);
  useEffect(() => {
    if (deepLink && !deepLink.error) void openDeepLink();
    // Once per company (and on Try again, via the button).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // Only for the company it belongs to (a late poll reply must not drop one
  // company's schedule into another's list).
  const onChange = useCallback(
    (next: PrepaymentDto) =>
      setList((l) =>
        l.forId !== currentIdRef.current
          ? l
          : { ...l, items: l.items.some((p) => p._id === next._id) ? l.items.map((p) => (p._id === next._id ? next : p)) : [next, ...l.items] },
      ),
    [],
  );

  // A schedule still posting or removing journals in the background (its
  // modal closed, or opened elsewhere): keep the list following it.
  const anyRunning = list.forId === activeId && list.items.some((p) => p.posting);
  useEffect(() => {
    if (!anyRunning || selected) return;
    const timer = setTimeout(() => void load(), 3000);
    return () => clearTimeout(timer);
  }, [anyRunning, selected, list, load]);

  if (!activeId) {
    return (
      <div className="w-full p-[var(--space-md)] sm:p-[var(--space-lg)]">
        <PageHeader title="Month-End Adjustments" subtitle="Prepayments released month by month." />
        <EmptyState icon={<Repeat size={28} strokeWidth={1.75} />} title="Pick a company" description="Choose a company in the header to see its prepayments." />
      </div>
    );
  }

  const items = list.forId === activeId ? list.items : [];
  return (
    <div className="w-full p-[var(--space-md)] sm:p-[var(--space-lg)]">
      <PageHeader
        title="Month-End Adjustments"
        subtitle={`Invoices that pay for more than a month go to the prepaid account; publish a schedule to post every monthly release to ${provider.name} at once.`}
        action={
          <Button variant="outline" size="sm" onClick={() => setSettingsOpen(true)} disabled={!settings} className="shrink-0">
            <SlidersHorizontal size={16} strokeWidth={2.25} />
            Settings
          </Button>
        }
      />

      <div className="mt-[var(--space-lg)] max-w-full overflow-x-auto">
        <Tabs
          items={[{ value: "prepayments", label: "Prepayments", count: items.filter((p) => p.displayStatus === "review").length, countSuffix: "to review" }]}
          value="prepayments"
          onChange={() => {}}
        />
      </div>

      <div className="mt-[var(--space-md)] flex flex-col gap-[var(--space-md)]">
        {list.forId === activeId && list.error && (
          <p className={`${ERROR_NOTE_CLASS} flex flex-wrap items-center gap-[var(--space-sm)]`}>
            {list.error}
            <button
              type="button"
              onClick={() => {
                void load();
                if (!settings) void loadSettings();
              }}
              className="font-bold underline"
            >
              Try again
            </button>
          </p>
        )}
        {settingsError && (
          <p className={`${ERROR_NOTE_CLASS} flex flex-wrap items-center gap-[var(--space-sm)]`}>
            {settingsError}
            <button type="button" onClick={() => void loadSettings()} className="font-bold underline">
              Try again
            </button>
          </p>
        )}
        {deepLink?.error && (
          <p className={`${ERROR_NOTE_CLASS} flex flex-wrap items-center gap-[var(--space-sm)]`}>
            Couldn&apos;t open that prepayment: {deepLink.error}
            <button type="button" onClick={() => void openDeepLink()} className="font-bold underline">
              Try again
            </button>
          </p>
        )}
        {settings && !settings.prepaymentDetection && (
          <p className="rounded-md border border-border bg-surface-alt p-[var(--space-sm)] text-caption text-content-secondary">
            Prepayment detection is off — invoices are only treated as prepayments when you mark them on the invoice.
          </p>
        )}
        <PrepaymentsTab prepayments={items} loading={list.forId !== activeId} failed={list.forId === activeId && !!list.error} onOpen={setSelected} />
      </div>

      {selected && (
        <PrepaymentScheduleModal
          key={selected._id}
          prepayment={selected}
          canPost={canPost}
          onClose={() => {
            setSelected(null);
            // A job may still be running (or have finished) since the modal last
            // looked — the list catches up rather than showing an old status.
            void load();
          }}
          onChange={onChange}
        />
      )}
      {settingsOpen && settings && (
        <MonthEndSettingsModal settings={settings} canEdit={canPost} onClose={() => setSettingsOpen(false)} onSaved={setSettings} />
      )}
    </div>
  );
}
