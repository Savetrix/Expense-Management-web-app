"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TicketPercent, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { ErrorState } from "@/components/ui/ErrorState";
import { useAppSelector } from "@/store/hooks";

// One entry per admin feature — a new one is a tab here plus a route under
// src/app/(app)/admin/.
const ADMIN_TABS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/admin/coupons", label: "Coupons", icon: TicketPercent },
];

// The admin area: Scantrix's own admins only (User.isSuperAdmin, sent with
// the signed-in user). Checked once here for every tab — and again by every
// /superadmin API, which is what actually protects the data.
export function AdminShellV2({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const user = useAppSelector((state) => state.auth.user);
  const isSuperAdmin = Boolean(user?.data?.user?.isSuperAdmin);

  if (!isSuperAdmin) {
    return (
      <div className="mx-auto max-w-3xl p-[var(--space-lg)]">
        <ErrorState message="This page is only for Scantrix admins." />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-[var(--space-lg)]">
      <h1 className="text-h2 font-bold text-trust-navy">Admin</h1>
      <nav className="mt-[var(--space-md)] flex gap-[var(--space-xs)] border-b border-border" aria-label="Admin sections">
        {ADMIN_TABS.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={`-mb-px flex items-center gap-[var(--space-xs)] border-b-2 px-[var(--space-md)] py-[var(--space-sm)] text-body-sm font-semibold ${
                active ? "border-primary text-primary" : "border-transparent text-text-secondary hover:text-text-primary"
              }`}
            >
              <Icon size={16} strokeWidth={2.25} />
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-[var(--space-lg)]">{children}</div>
    </div>
  );
}
