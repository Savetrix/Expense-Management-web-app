"use client";

import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { restoreUser } from "@/store/auth/authSlice";
import { getUser } from "@/lib/storage";
import { AppShell } from "@/components/shell/AppShell";
import { Spinner } from "@/components/ui/Spinner";

// Routes reachable regardless of auth state. /invite/accept and
// /register/verify-otp both have their own internal auth-aware logic
// (see their page components) — they are not simply "logged-out only".
const PUBLIC_ROUTES = ["/login", "/register", "/register/verify-otp", "/invite/accept", "/forgot-password"];

const AUTH_ONLY_REDIRECT_ROUTES = ["/login", "/register"];

// Full-screen/transitional routes that never show the persistent app shell
// (C12), even once authenticated — same list as PUBLIC_ROUTES (all
// transient auth screens) plus /paywall, which is deliberately a full-bleed
// block screen matching mobile's modal-like presentation, and
// /invoices/preview, which is the same: a full-bleed document viewer with
// its own close button, not a page meant to sit next to the sidebar.
const NO_SHELL_ROUTES = [...PUBLIC_ROUTES, "/paywall", "/google-drive", "/invoices/preview"];

function matchesRoute(pathname: string, routes: string[]): boolean {
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function isPublicRoute(pathname: string): boolean {
  return matchesRoute(pathname, PUBLIC_ROUTES);
}

function isNoShellRoute(pathname: string): boolean {
  return matchesRoute(pathname, NO_SHELL_ROUTES);
}

function FullScreenLoader() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-[var(--space-md)] bg-background-soft">
      <Spinner size="lg" />
      <p className="text-body-sm font-medium text-text-secondary">Loading…</p>
    </div>
  );
}

// Ported from Scantrix_v2 App.tsx's AppContent restoreSession() effect +
// SplashScreen's redirect logic, combined: on the web there is no native
// splash screen, so this component's initial loading state does that job
// (see STATUS.md row 1).
export function AuthGate({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const pathname = usePathname();
  const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);
  const [restoring, setRestoring] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const savedUser = await getUser();
      if (!cancelled && savedUser) {
        dispatch(restoreUser(savedUser));
      }
      if (!cancelled) setRestoring(false);
    })();
    return () => {
      cancelled = true;
    };
    // Only ever needs to run once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "/" is the public marketing landing page. Unlike /login and /register,
  // it stays viewable even for authenticated visitors (e.g. to preview it
  // without logging out first) instead of forcing a redirect — it never
  // shows the authenticated app shell either way. Matched exactly (not via
  // matchesRoute) so it never widens any prefix check to the whole app.
  const isRoot = pathname === "/";

  useEffect(() => {
    if (restoring) return;
    if (!isAuthenticated && !isRoot && !isPublicRoute(pathname)) {
      router.replace("/login");
    } else if (isAuthenticated && AUTH_ONLY_REDIRECT_ROUTES.includes(pathname)) {
      router.replace("/dashboard");
    }
  }, [restoring, isAuthenticated, isRoot, pathname, router]);

  if (restoring) return <FullScreenLoader />;

  // Avoid flashing protected/auth-only content for the tick before the
  // redirect effect above actually navigates away. The landing page ("/")
  // is exempt — it renders its own content immediately regardless of auth
  // state (see isRoot below).
  if (!isAuthenticated && !isRoot && !isPublicRoute(pathname)) return <FullScreenLoader />;
  if (isAuthenticated && AUTH_ONLY_REDIRECT_ROUTES.includes(pathname)) {
    return <FullScreenLoader />;
  }

  if (isRoot) return <>{children}</>;

  if (isAuthenticated && !isNoShellRoute(pathname)) {
    return <AppShell>{children}</AppShell>;
  }

  return <>{children}</>;
}
