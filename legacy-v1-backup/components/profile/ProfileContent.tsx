"use client";

import Link from "next/link";
import {
  ChevronRight,
  FileText,
  Gem,
  Link2,
  LogOut,
  Mail,
  Shield,
  SlidersHorizontal,
  Trash2,
  Users,
} from "lucide-react";
import { ReactNode, useState } from "react";

import { confirmDialog, showToast } from "@/lib/dialogManager";
import { capitalizeWords, normalizePhotoURL } from "@/lib/textFormat";
import { useAppSelector } from "@/store/hooks";
import { useLogout } from "@/store/useLogout";

// Ported from Scantrix_v2 src/screens/profile/ProfileOptionsScreen.tsx.
// TERMS_URL / PRIVACY_URL are the same S3-hosted PDFs mobile links to.
const TERMS_URL = "https://scantrix-uploads.s3.ap-south-1.amazonaws.com/invoices/6a00877a03676409687bac34_1781529818953.pdf";
const PRIVACY_URL = "https://scantrix-uploads.s3.ap-south-1.amazonaws.com/invoices/6a00877a03676409687bac34_1781529819012.pdf";
const SUPPORT_EMAIL = "support@scantrix.ai";

function SettingsRow({ href, icon, iconBg, label }: { href: string; icon: ReactNode; iconBg: string; label: string }) {
  return (
    <Link href={href} className="flex items-center gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-md)] hover:bg-background-alt">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md" style={{ backgroundColor: iconBg }}>
        {icon}
      </span>
      <span className="flex-1 font-semibold text-text-primary">{label}</span>
      <ChevronRight size={18} strokeWidth={2} className="shrink-0 text-text-secondary" />
    </Link>
  );
}

export function ProfileContent() {
  const logout = useLogout();
  const user = useAppSelector((state) => state.auth.user);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const apiUser = user?.data?.user;
  const name = capitalizeWords(apiUser?.firstName || apiUser?.email?.split("@")[0] || "User");
  const email = apiUser?.email || "No email";
  const photoURL = normalizePhotoURL(apiUser?.icon);

  const handleLogout = async () => {
    const confirmed = await confirmDialog({
      title: "Logout?",
      message: "Are you sure you want to logout?",
      confirmLabel: "Logout",
      tone: "destructive",
    });
    if (!confirmed) return;
    setIsLoggingOut(true);
    try {
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  // Matches ProfileOptionsScreen.tsx's handleDeleteAccountPress exactly:
  // a real confirmation dialog, but the delete action itself is a
  // "Coming Soon" stub — no backend endpoint exists (flagged separately as
  // a real compliance requirement needing scoped backend work, per
  // TASKS.md's Pre-Marked BLOCKED list).
  const handleDeleteAccount = async () => {
    if (isDeleting) return;
    const confirmed = await confirmDialog({
      title: "Delete account permanently?",
      message: "This action cannot be undone. Your account will be deleted permanently.",
      confirmLabel: "Delete account",
      tone: "destructive",
    });
    if (!confirmed) return;
    setIsDeleting(true);
    showToast("Coming Soon: Delete account API will be integrated next.", "info");
    setIsDeleting(false);
  };

  return (
    <div className="mx-auto max-w-2xl p-[var(--space-lg)]">
      <h1 className="text-h2 font-bold text-trust-navy">Account</h1>

      <Link
        href="/profile/edit"
        className="mt-[var(--space-lg)] flex items-center gap-[var(--space-md)] rounded-2xl bg-white p-[var(--space-md)] shadow-sm hover:bg-background-alt"
      >
        <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-2xl font-bold text-primary">
          {photoURL ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photoURL} alt={name} className="h-full w-full object-cover" />
          ) : (
            name.charAt(0).toUpperCase()
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-h3 font-bold text-text-primary">{name}</p>
          <p className="truncate text-body-sm text-text-secondary">{email}</p>
        </div>
        <ChevronRight size={18} strokeWidth={2} className="shrink-0 text-text-secondary" />
      </Link>

      <p className="mb-[var(--space-sm)] mt-[var(--space-lg)] text-caption font-bold uppercase tracking-wide text-text-secondary">
        Settings
      </p>
      <div className="divide-y divide-border overflow-hidden rounded-lg bg-white shadow-sm">
        <SettingsRow
          href="/accounting-software"
          icon={<Link2 size={18} strokeWidth={2} className="text-primary" />}
          iconBg="#EEF4FF"
          label="Integrations"
        />
        <SettingsRow
          href="/team"
          icon={<Users size={18} strokeWidth={2} className="text-trust-navy" />}
          iconBg="#E0F2FE"
          label="Team Members"
        />
        <SettingsRow
          href="/preferences"
          icon={<SlidersHorizontal size={18} strokeWidth={2} className="text-text-secondary" />}
          iconBg="#F1F5F9"
          label="Preferences"
        />
        <SettingsRow
          href="/subscription"
          icon={<Gem size={18} strokeWidth={2} className="text-warning" />}
          iconBg="#FEF3C7"
          label="Subscription"
        />
      </div>

      <p className="mb-[var(--space-sm)] mt-[var(--space-lg)] text-caption font-bold uppercase tracking-wide text-text-secondary">
        Legal
      </p>
      <div className="divide-y divide-border overflow-hidden rounded-lg bg-white shadow-sm">
        <a
          href={TERMS_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-md)] hover:bg-background-alt"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-success/10">
            <FileText size={18} strokeWidth={2} className="text-success" />
          </span>
          <span className="flex-1 font-semibold text-text-primary">Terms &amp; Conditions</span>
          <ChevronRight size={18} strokeWidth={2} className="shrink-0 text-text-secondary" />
        </a>
        <a
          href={PRIVACY_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-md)] hover:bg-background-alt"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#F5F3FF]">
            <Shield size={18} strokeWidth={2} className="text-trust-navy" />
          </span>
          <span className="flex-1 font-semibold text-text-primary">Privacy Policy</span>
          <ChevronRight size={18} strokeWidth={2} className="shrink-0 text-text-secondary" />
        </a>
      </div>

      <p className="mb-[var(--space-sm)] mt-[var(--space-lg)] text-caption font-bold uppercase tracking-wide text-text-secondary">
        Support
      </p>
      <div className="overflow-hidden rounded-lg bg-white shadow-sm">
        <a
          href={`mailto:${SUPPORT_EMAIL}`}
          className="flex items-center gap-[var(--space-sm)] px-[var(--space-md)] py-[var(--space-md)] hover:bg-background-alt"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <Mail size={18} strokeWidth={2} className="text-primary" />
          </span>
          <span className="flex-1 font-semibold text-text-primary">Contact Support</span>
          <ChevronRight size={18} strokeWidth={2} className="shrink-0 text-text-secondary" />
        </a>
      </div>

      <p className="mb-[var(--space-sm)] mt-[var(--space-lg)] text-caption font-bold uppercase tracking-wide text-text-secondary">
        Account Actions
      </p>
      <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-white shadow-sm">
        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="flex w-full items-center gap-[var(--space-sm)] p-[var(--space-md)] text-left disabled:opacity-60"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-warning/10">
            <LogOut size={18} strokeWidth={2} className="text-warning" />
          </span>
          <span className="font-semibold text-text-primary">{isLoggingOut ? "Logging out…" : "Logout"}</span>
        </button>
        <button
          type="button"
          onClick={handleDeleteAccount}
          disabled={isDeleting}
          className="flex w-full items-center gap-[var(--space-sm)] p-[var(--space-md)] text-left disabled:opacity-60"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-error/10 text-error">
            <Trash2 size={18} strokeWidth={2} />
          </span>
          <span className="font-semibold text-error">{isDeleting ? "Deleting…" : "Delete Account"}</span>
        </button>
      </div>
    </div>
  );
}
