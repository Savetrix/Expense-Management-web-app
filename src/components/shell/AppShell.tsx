"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  CreditCard,
  FileText,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Plus,
  Puzzle,
  Store,
  Users,
  X,
} from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";

import { ChatWidget } from "@/components/chatbot/ChatWidget";
import { ExpandTransitionOverlay } from "@/components/shell/ExpandTransitionOverlay";
import { GlobalSearchBar } from "@/components/shell/GlobalSearchBar";
import { NotificationBell } from "@/components/shell/NotificationBell";
import { ThemeToggle } from "@/components/shell/ThemeToggle";
import { getSidebarPinned, setSidebarPinned } from "@/lib/storage";
import { capitalizeWords, normalizePhotoURL } from "@/lib/textFormat";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { useLogout } from "@/store/useLogout";
import { getMyQBConnections, getQuickBooksStatus } from "@/store/quickBooks/quickBooksApi";

interface QBConnection {
  _id: string;
  name: string;
  realmId: string;
  role: string;
  createdAt: string;
  /** Backend derives this from isDeleted — absent on older cached data, treat as active. */
  status?: "active" | "disconnected";
}

// QuickBooks connection management now lives entirely under Integrations
// (see AccountingSoftwaresContent's connected-accounts drill-down) — a
// separate top-level "QuickBooks" link duplicated that same destination.
const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/team", label: "Team", icon: Users },
  { href: "/vendors", label: "Vendors", icon: Store },
  { href: "/gl-tax-codes", label: "GL Account & TaxCode", icon: Landmark },
  { href: "/accounting-software", label: "Integrations", icon: Puzzle },
  { href: "/subscription", label: "Subscription", icon: CreditCard },
] as const;

// Floating label that appears next to a single icon on hover, instead of
// widening the whole rail — keeps every other row untouched while you're
// pointed at one of them. Only used while the sidebar isn't pinned open,
// since a pinned sidebar already shows the label inline.
// Fixed dark nav-bg rather than a token that flips with the theme (e.g.
// trust-navy/content-primary) — this floats over the page content, not the
// sidebar, so it needs to stay legible against either page background.
const TOOLTIP_CLASS =
  "pointer-events-none absolute left-full top-1/2 z-20 ml-[var(--space-sm)] -translate-y-1/2 whitespace-nowrap rounded-md bg-nav-bg px-[var(--space-sm)] py-[var(--space-xs)] text-body-sm font-semibold text-white opacity-0 shadow-sm transition-opacity duration-150 group-hover:opacity-100";

function NavLink({
  item,
  pathname,
  collapsed,
}: {
  item: (typeof NAV_ITEMS)[number];
  pathname: string;
  collapsed: boolean;
}) {
  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-label={item.label}
      className={`group relative flex items-center gap-[var(--space-sm)] rounded-md py-[var(--space-sm)] text-body-sm font-semibold ${
        collapsed ? "justify-center" : "px-[var(--space-md)]"
      } ${active ? "bg-nav-active text-nav-text-active" : "text-nav-text hover:bg-nav-hover hover:text-nav-text-active"}`}
    >
      <Icon size={18} strokeWidth={2} className="shrink-0" />
      {collapsed ? <span className={TOOLTIP_CLASS}>{item.label}</span> : <span className="truncate">{item.label}</span>}
    </Link>
  );
}

// Slot 0 is always the time-of-day English greeting; the rest are other
// languages. One is picked per session (see the mount effect below) instead
// of continuously rotating, so the header doesn't just say the same thing on
// every login/refresh without being distracting while you're working.
const ROTATING_GREETING_WORDS = ["Hola", "Namaste", "Bonjour", "Ciao", "Hallo"];
const GREETING_ROTATION_COUNT = ROTATING_GREETING_WORDS.length + 1;

function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function greetingFor(name: string, rotationIndex: number): string {
  const word = rotationIndex === 0 ? timeOfDayGreeting() : ROTATING_GREETING_WORDS[rotationIndex - 1];
  return `${word}, ${name}`;
}

// Genuinely new information architecture, not a port of an existing mobile
// pattern — MainTabNavigator is a single-screen stack despite its name, so
// mobile has no real persistent nav to draw from here. See ASSUMPTIONS.md.
export function AppShell({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const pathname = usePathname();
  const logout = useLogout();

  const user = useAppSelector((state) => state.auth.user);
  const accessToken: string | undefined = user?.data?.accessToken;
  const qbConnectionId = useAppSelector((state) => state.quickBooks.qbConnectionId);

  const [connections, setConnections] = useState<QBConnection[]>([]);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const collapsed = !pinned;
  const switcherRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const [greetingIndex, setGreetingIndex] = useState(0);
  const [greetingFading, setGreetingFading] = useState(false);

  // Picked once when AppShell mounts (a refresh, or a fresh login since
  // logging out unmounts AppShell entirely) rather than on a timer. Deferred
  // to an effect instead of useState's initializer so the client's first
  // paint still matches the server-rendered time-of-day greeting exactly —
  // same hydration-mismatch guard as the sidebar-pinned state above.
  useEffect(() => {
    const randomIndex = Math.floor(Math.random() * GREETING_ROTATION_COUNT);
    if (randomIndex === 0) return;
    setGreetingFading(true);
    const timeout = setTimeout(() => {
      setGreetingIndex(randomIndex);
      setGreetingFading(false);
    }, 200);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    if (!accessToken) return;
    (async () => {
      const result = await dispatch(getMyQBConnections({ accessToken }));
      if (getMyQBConnections.fulfilled.match(result)) {
        setConnections(result.payload?.data?.connections ?? []);
      }
    })();
  }, [accessToken, dispatch]);

  // Read the persisted preference after mount rather than in useState's
  // initializer — the initial client render must match the server's
  // (always-collapsed) markup exactly, or React throws a hydration
  // mismatch. Same typeof-window-guarded pattern as every other
  // localStorage call in this codebase (src/lib/storage.ts).
  useEffect(() => {
    setPinned(getSidebarPinned());
  }, []);

  // AppShell is the persistent layout and never remounts between route
  // navigations, so without this the switcher dropdown stays open
  // (rendered on top of whatever page you navigate to) until manually
  // toggled shut again.
  useEffect(() => {
    setSwitcherOpen(false);
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!switcherOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(event.target as Node)) {
        setSwitcherOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [switcherOpen]);

  // Escape closes the mobile drawer, same as the switcher dropdown above.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileNavOpen]);

  // Prevent the page underneath from scrolling while the full-screen mobile
  // drawer is open — otherwise touch-scrolling the drawer can drag the
  // background content with it on some mobile browsers.
  useEffect(() => {
    if (!mobileNavOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileNavOpen]);

  const togglePinned = () => {
    setPinned((prev) => {
      const next = !prev;
      setSidebarPinned(next);
      return next;
    });
  };

  // The top-bar switcher is company-selection UI, not connection management —
  // a disconnected QuickBooks company has nothing to switch to, so it's
  // filtered out here. Disconnected accounts surface only in the dedicated
  // "Disconnected accounts" panel on the Integrations page.
  const connectedAccounts = connections.filter((c) => c.status !== "disconnected");
  // With exactly one connected company there's nothing to choose, so show it
  // directly. With 2+, only show a match for an id the user actually
  // selected — leave the switcher reading "Select company" otherwise,
  // instead of silently defaulting to the first one in the list.
  const activeConnection =
    connectedAccounts.length === 1 ? connectedAccounts[0] : connectedAccounts.find((c) => c._id === qbConnectionId);
  // 2+ companies connected but none picked yet — draw the eye to the
  // switcher instead of leaving it looking like any other idle control.
  const needsEntitySelection = connectedAccounts.length > 1 && !activeConnection;

  const handleSwitch = async (connection: QBConnection) => {
    setSwitcherOpen(false);
    if (!accessToken || connection._id === qbConnectionId) return;
    await dispatch(getQuickBooksStatus({ accessToken, qbConnectionId: connection._id }));
  };

  const name = capitalizeWords(user?.data?.user?.firstName || user?.data?.user?.email?.split("@")[0] || "Account");
  const photoURL = normalizePhotoURL(user?.data?.user?.icon);

  return (
    <div className="flex h-dvh bg-page">
      <aside
        className={`hidden h-dvh shrink-0 flex-col border-r border-nav-hover bg-nav-bg transition-[width] duration-200 ease-in-out lg:flex ${
          collapsed ? "w-16" : "w-64"
        }`}
      >
        <div className={`flex h-16 shrink-0 items-center ${collapsed ? "justify-center" : "px-[var(--space-lg)]"}`}>
          <Link
            href="/dashboard"
            aria-label="Go to dashboard"
            className="group relative flex min-w-0 items-center gap-[var(--space-sm)]"
          >
            <Image src="/scantrix-icon.png" alt="" width={32} height={32} className="h-8 w-8 shrink-0 rounded-md" />
            {collapsed ? (
              <span className={TOOLTIP_CLASS}>Scantrix</span>
            ) : (
              <span className="truncate text-h3 font-bold text-white">Scantrix</span>
            )}
          </Link>
        </div>

        {/* Create — kept OUTSIDE the scrollable nav below on purpose: its
            hover flyout pops out via position:absolute + left-full, and
            CSS's overflow spec forces overflow-x to clip too as soon as
            overflow-y is non-visible — so nesting it inside the nav's
            overflow-y-auto container hid the flyout completely whenever the
            sidebar was pinned open (it only ever worked collapsed, where
            that class isn't applied). Not tied to any one route, so it isn't
            part of NAV_ITEMS' active-link rendering. Jumps straight into
            create mode via a ?create=true param VendorsContent/
            GLTaxCodeContent watch for. */}
        <div className={`shrink-0 pb-[var(--space-xs)] ${collapsed ? "px-[var(--space-xs)]" : "px-[var(--space-sm)]"}`}>
          <div className="group relative">
            <div
              className={`flex items-center gap-[var(--space-sm)] rounded-md py-[var(--space-sm)] text-body-sm font-semibold text-nav-text group-hover:bg-nav-hover group-hover:text-nav-text-active ${
                collapsed ? "justify-center" : "px-[var(--space-md)]"
              }`}
            >
              <Plus size={18} strokeWidth={2} className="shrink-0" />
              {collapsed ? <span className={TOOLTIP_CLASS}>Create</span> : <span className="truncate">Create</span>}
            </div>
            <div className="invisible absolute left-full top-0 z-20 ml-[var(--space-sm)] w-48 overflow-hidden rounded-md border border-border bg-surface opacity-0 shadow-md transition-opacity duration-150 group-hover:visible group-hover:opacity-100">
              <Link
                href="/vendors?create=true"
                className="block px-[var(--space-md)] py-[var(--space-sm)] text-body-sm font-semibold text-content-primary hover:bg-surface-alt"
              >
                Vendor
              </Link>
              <Link
                href="/gl-tax-codes?create=true"
                className="block px-[var(--space-md)] py-[var(--space-sm)] text-body-sm font-semibold text-content-primary hover:bg-surface-alt"
              >
                GL Account
              </Link>
            </div>
          </div>
        </div>

        <nav className={`flex flex-1 flex-col gap-[var(--space-xs)] ${collapsed ? "px-[var(--space-xs)]" : "px-[var(--space-sm)] overflow-y-auto"}`}>
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} collapsed={collapsed} />
          ))}

          {/* Manual pin toggle, right after Subscription — the rest of the
              sidebar already expands per-row on hover, but some users want
              it pinned open (or closed) instead of relying on that. */}
          <button
            type="button"
            onClick={togglePinned}
            aria-label={collapsed ? "Pin sidebar open" : "Collapse sidebar"}
            className={`group relative flex items-center gap-[var(--space-sm)] rounded-md py-[var(--space-sm)] text-body-sm font-semibold text-nav-text hover:bg-nav-hover hover:text-nav-text-active ${
              collapsed ? "justify-center" : "px-[var(--space-md)]"
            }`}
          >
            {collapsed ? (
              <ChevronsRight size={18} strokeWidth={2} className="shrink-0" />
            ) : (
              <ChevronsLeft size={18} strokeWidth={2} className="shrink-0" />
            )}
            {collapsed ? (
              <span className={TOOLTIP_CLASS}>Pin sidebar open</span>
            ) : (
              <span className="truncate">Collapse sidebar</span>
            )}
          </button>
        </nav>

        <div className={`shrink-0 border-t border-nav-hover ${collapsed ? "p-[var(--space-xs)]" : "p-[var(--space-md)]"}`}>
          <Link
            href="/profile"
            aria-label={name}
            className={`group relative mb-[var(--space-xs)] flex items-center gap-[var(--space-sm)] truncate rounded-md py-[var(--space-xs)] text-body-sm font-semibold ${
              collapsed ? "justify-center" : "px-[var(--space-sm)]"
            } ${pathname === "/profile" ? "bg-nav-active text-nav-text-active" : "text-nav-text hover:bg-nav-hover hover:text-nav-text-active"}`}
          >
            <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-nav-text-active/90 text-caption font-bold text-nav-bg">
              {photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={photoURL} alt={name} className="h-full w-full object-cover" />
              ) : (
                name.charAt(0).toUpperCase()
              )}
            </span>
            {collapsed ? <span className={TOOLTIP_CLASS}>{name}</span> : name}
          </Link>
          {/* Same dark sidebar fill as everywhere else in this rail, so
              logout keeps the nav-text treatment rather than a status-danger
              token — those are calibrated against light surfaces, not this
              dark nav-bg fill. */}
          <button
            type="button"
            onClick={logout}
            aria-label="Logout"
            className={`flex w-full items-center gap-[var(--space-sm)] rounded-md py-[var(--space-xs)] text-left text-body-sm font-semibold text-nav-text hover:bg-nav-hover hover:text-nav-text-active ${
              collapsed ? "group relative justify-center" : "px-[var(--space-sm)]"
            }`}
          >
            <LogOut size={16} strokeWidth={2} className="shrink-0" />
            {collapsed ? <span className={TOOLTIP_CLASS}>Logout</span> : "Logout"}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="grid h-16 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-[var(--space-sm)] border-b border-border bg-surface px-[var(--space-md)] lg:gap-[var(--space-md)] lg:px-[var(--space-lg)]">
          <div className="flex min-w-0 items-center gap-[var(--space-sm)]">
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              aria-label="Open menu"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-content-secondary hover:bg-surface-alt lg:hidden"
            >
              <Menu size={20} strokeWidth={2} />
            </button>
            {connectedAccounts.length > 0 && (
              <div ref={switcherRef} className="relative min-w-0">
                <button
                  type="button"
                  onClick={() => setSwitcherOpen((v) => !v)}
                  aria-expanded={switcherOpen}
                  className={`flex min-w-0 items-center gap-[var(--space-sm)] rounded-md border px-[var(--space-sm)] py-[var(--space-xs)] text-left text-body-sm ${
                    needsEntitySelection
                      ? "animate-pulse border-accent bg-accent-bg ring-2 ring-accent-soft"
                      : "border-border bg-page"
                  }`}
                >
                  <span className="min-w-0 truncate font-semibold text-content-primary">
                    {activeConnection?.name ?? "Select your company"}
                  </span>
                  <ChevronDown
                    size={16}
                    className={`shrink-0 transition-transform ${needsEntitySelection ? "text-accent" : "text-content-secondary"} ${switcherOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {switcherOpen && (
                  <div className="absolute left-0 top-full z-10 mt-[var(--space-xs)] w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-surface p-[var(--space-xs)] shadow-md">
                    {/* Caret is part of this panel, not separately positioned
                        against the trigger button — so it's welded to
                        wherever the dropdown itself ends up (its width is
                        capped by max-w-[calc(100vw-2rem)] on narrow screens),
                        instead of drifting out of sync with it. */}
                    <span className="absolute -top-1.5 left-4 h-3 w-3 rotate-45 border-l border-t border-border bg-surface" />
                    {connectedAccounts.map((connection) => {
                      const isActive = connection._id === qbConnectionId;
                      return (
                        <button
                          key={connection._id}
                          type="button"
                          onClick={() => handleSwitch(connection)}
                          className={`flex w-full items-center gap-[var(--space-sm)] rounded-md px-[var(--space-sm)] py-[var(--space-sm)] text-left text-body-sm ${
                            isActive ? "bg-accent-bg font-bold text-accent-text-on-bg" : "text-content-primary hover:bg-surface-alt"
                          }`}
                        >
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-bg text-caption font-bold text-accent-text-on-bg">
                            {connection.name.charAt(0).toUpperCase()}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{connection.name}</span>
                          {isActive && <Check size={16} strokeWidth={2.5} className="shrink-0 text-accent" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <h2
            className={`hidden truncate text-center text-h3 font-bold text-content-primary transition-opacity duration-200 sm:block ${
              greetingFading ? "opacity-0" : "opacity-100"
            }`}
          >
            {greetingFor(name, greetingIndex)}
          </h2>

          <div className="flex shrink-0 items-center justify-end gap-[var(--space-xs)] lg:gap-[var(--space-sm)]">
            <GlobalSearchBar />

            <ChatWidget companyName={activeConnection?.name} />

            <ThemeToggle />

            <NotificationBell />
          </div>
        </header>

        <main ref={mainRef} className="min-w-0 flex-1 overflow-y-auto">{children}</main>
        <ExpandTransitionOverlay targetRef={mainRef} />
      </div>

      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileNavOpen(false)} />
          <div
            className="relative flex h-full w-72 max-w-[85vw] flex-col bg-nav-bg shadow-xl"
            onClick={() => setMobileNavOpen(false)}
          >
            <div className="flex h-16 shrink-0 items-center justify-between px-[var(--space-lg)]">
              <Link href="/dashboard" aria-label="Go to dashboard" className="flex min-w-0 items-center gap-[var(--space-sm)]">
                <Image src="/scantrix-icon.png" alt="" width={32} height={32} className="h-8 w-8 shrink-0 rounded-md" />
                <span className="truncate text-h3 font-bold text-white">Scantrix</span>
              </Link>
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                aria-label="Close menu"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-nav-text hover:bg-nav-hover hover:text-nav-text-active"
              >
                <X size={20} strokeWidth={2} />
              </button>
            </div>

            {/* Create's hover flyout (see the desktop <aside> below) has no
                touch equivalent — the two destinations are always-visible
                links here instead. */}
            <div className="shrink-0 px-[var(--space-sm)] pb-[var(--space-xs)]">
              <p className="px-[var(--space-md)] pb-[var(--space-xs)] text-caption font-bold uppercase tracking-wide text-nav-muted">
                Create
              </p>
              <Link
                href="/vendors?create=true"
                className="flex items-center gap-[var(--space-sm)] rounded-md px-[var(--space-md)] py-[var(--space-sm)] text-body-sm font-semibold text-nav-text hover:bg-nav-hover hover:text-nav-text-active"
              >
                <Plus size={16} strokeWidth={2} className="shrink-0" />
                Vendor
              </Link>
              <Link
                href="/gl-tax-codes?create=true"
                className="flex items-center gap-[var(--space-sm)] rounded-md px-[var(--space-md)] py-[var(--space-sm)] text-body-sm font-semibold text-nav-text hover:bg-nav-hover hover:text-nav-text-active"
              >
                <Plus size={16} strokeWidth={2} className="shrink-0" />
                GL Account
              </Link>
            </div>

            <nav className="flex flex-1 flex-col gap-[var(--space-xs)] overflow-y-auto px-[var(--space-sm)]">
              {NAV_ITEMS.map((item) => (
                <NavLink key={item.href} item={item} pathname={pathname} collapsed={false} />
              ))}
            </nav>

            <div className="shrink-0 border-t border-nav-hover p-[var(--space-md)]">
              <Link
                href="/profile"
                aria-label={name}
                className={`mb-[var(--space-xs)] flex items-center gap-[var(--space-sm)] truncate rounded-md px-[var(--space-sm)] py-[var(--space-xs)] text-body-sm font-semibold ${
                  pathname === "/profile" ? "bg-nav-active text-nav-text-active" : "text-nav-text hover:bg-nav-hover hover:text-nav-text-active"
                }`}
              >
                <span className="flex h-6 w-6 shrink-0 items-center justify-center overflow-hidden rounded-full bg-nav-text-active/90 text-caption font-bold text-nav-bg">
                  {photoURL ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={photoURL} alt={name} className="h-full w-full object-cover" />
                  ) : (
                    name.charAt(0).toUpperCase()
                  )}
                </span>
                {name}
              </Link>
              <button
                type="button"
                onClick={logout}
                aria-label="Logout"
                className="flex w-full items-center gap-[var(--space-sm)] rounded-md px-[var(--space-sm)] py-[var(--space-xs)] text-left text-body-sm font-semibold text-nav-text hover:bg-nav-hover hover:text-nav-text-active"
              >
                <LogOut size={16} strokeWidth={2} className="shrink-0" />
                Logout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
