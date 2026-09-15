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
import { Avatar, PageHeader } from "@/components/v2/ui";
import { EditProfileDialogV2 } from "./EditProfileDialogV2";
import { PreferencesDialogV2 } from "@/components/v2/preferences/PreferencesDialogV2";

// Ported from Scantrix_v2 src/screens/profile/ProfileOptionsScreen.tsx (and
// the v1 web port at src/components/profile/ProfileContent.tsx). Same
// TERMS_URL / PRIVACY_URL S3-hosted PDFs mobile links to.
const TERMS_URL = "https://scantrix-uploads.s3.ap-south-1.amazonaws.com/invoices/6a00877a03676409687bac34_1781529818953.pdf";
const PRIVACY_URL = "https://scantrix-uploads.s3.ap-south-1.amazonaws.com/invoices/6a00877a03676409687bac34_1781529819012.pdf";
const SUPPORT_EMAIL = "support@scantrix.ai";

interface SettingsRowProps {
  href?: string;
  onClick?: () => void;
  icon: ReactNode;
  iconClassName: string;
  label: string;
  external?: boolean;
}

function SettingsRow({ href, onClick, icon, iconClassName, label, external }: SettingsRowProps) {
  const content = (
    <>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${iconClassName}`}>{icon}</span>
      <span className="flex-1 font-semibold text-content-primary">{label}</span>
      <ChevronRight size={18} strokeWidth={2} className="shrink-0 text-content-secondary" />
    </>
  );
  const className =
    "flex items-center gap-[var(--space-sm)] rounded-lg border border-border bg-surface px-[var(--space-md)] py-[var(--space-md)] shadow-sm transition-colors hover:bg-surface-alt";

  if (external && href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {content}
      </a>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={`w-full text-left ${className}`}>
        {content}
      </button>
    );
  }
  return (
    <Link href={href ?? "#"} className={className}>
      {content}
    </Link>
  );
}

interface SectionLabelProps {
  children: ReactNode;
}

function SectionLabel({ children }: SectionLabelProps) {
  return (
    <p className="mb-[var(--space-sm)] mt-[var(--space-lg)] text-caption font-bold uppercase tracking-wide text-content-secondary">
      {children}
    </p>
  );
}

export function ProfileContentV2() {
  const logout = useLogout();
  const user = useAppSelector((state) => state.auth.user);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [editProfileOpen, setEditProfileOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);

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

  // Matches ProfileOptionsScreen.tsx's handleDeleteAccountPress exactly: a
  // real confirmation dialog, but the delete action itself is a "Coming
  // Soon" stub — no backend endpoint exists (flagged separately as a real
  // compliance requirement needing scoped backend work, per TASKS.md's
  // Pre-Marked BLOCKED list).
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
    <div className="w-full max-w-4xl p-[var(--space-lg)] sm:p-[var(--space-lg)]">
      <PageHeader title="Account" subtitle="Manage your profile, integrations, and workspace settings." />

      <button
        type="button"
        onClick={() => setEditProfileOpen(true)}
        className="mt-[var(--space-lg)] flex w-full items-center gap-[var(--space-md)] rounded-lg border border-border bg-surface p-[var(--space-md)] text-left shadow-sm transition-colors hover:bg-surface-alt"
      >
        <Avatar name={name} photoURL={photoURL} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-h3 font-bold text-content-primary">{name}</p>
          <p className="truncate text-body-sm text-content-secondary">{email}</p>
        </div>
        <ChevronRight size={18} strokeWidth={2} className="shrink-0 text-content-secondary" />
      </button>

      <SectionLabel>Settings</SectionLabel>
      <div className="grid grid-cols-1 gap-[var(--space-lg)] sm:grid-cols-2">
        <SettingsRow
          href="/v2/accounting-software"
          icon={<Link2 size={18} strokeWidth={2} className="text-accent" />}
          iconClassName="bg-accent-bg"
          label="Integrations"
        />
        <SettingsRow
          href="/v2/team"
          icon={<Users size={18} strokeWidth={2} className="text-status-info-text" />}
          iconClassName="bg-status-info-bg"
          label="Team Members"
        />
        <SettingsRow
          onClick={() => setPreferencesOpen(true)}
          icon={<SlidersHorizontal size={18} strokeWidth={2} className="text-content-secondary" />}
          iconClassName="bg-surface-alt"
          label="Preferences"
        />
        <SettingsRow
          href="/v2/subscription"
          icon={<Gem size={18} strokeWidth={2} className="text-status-warning-text" />}
          iconClassName="bg-status-warning-bg"
          label="Subscription"
        />
      </div>

      <SectionLabel>Legal</SectionLabel>
      <div className="grid grid-cols-1 gap-[var(--space-lg)] sm:grid-cols-2">
        <SettingsRow
          href={TERMS_URL}
          external
          icon={<FileText size={18} strokeWidth={2} className="text-status-success-text" />}
          iconClassName="bg-status-success-bg"
          label="Terms & Conditions"
        />
        <SettingsRow
          href={PRIVACY_URL}
          external
          icon={<Shield size={18} strokeWidth={2} className="text-status-info-text" />}
          iconClassName="bg-status-info-bg"
          label="Privacy Policy"
        />
      </div>

      <SectionLabel>Support</SectionLabel>
      <div className="flex flex-col gap-[var(--space-lg)]">
        <SettingsRow
          href={`mailto:${SUPPORT_EMAIL}`}
          icon={<Mail size={18} strokeWidth={2} className="text-accent" />}
          iconClassName="bg-accent-bg"
          label="Contact Support"
        />
      </div>

      <SectionLabel>Account Actions</SectionLabel>
      <div className="flex flex-col gap-[var(--space-lg)]">
        <button
          type="button"
          onClick={handleLogout}
          disabled={isLoggingOut}
          className="flex w-full items-center gap-[var(--space-sm)] rounded-lg border border-border bg-surface p-[var(--space-md)] text-left shadow-sm transition-colors hover:bg-surface-alt disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-status-warning-bg text-status-warning-text">
            <LogOut size={18} strokeWidth={2} />
          </span>
          <span className="font-semibold text-content-primary">{isLoggingOut ? "Logging out…" : "Logout"}</span>
        </button>
        <button
          type="button"
          onClick={handleDeleteAccount}
          disabled={isDeleting}
          className="flex w-full items-center gap-[var(--space-sm)] rounded-lg border border-status-danger-border bg-surface p-[var(--space-md)] text-left shadow-sm transition-colors hover:bg-status-danger-bg disabled:cursor-not-allowed disabled:opacity-60"
        >
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-status-danger-bg text-status-danger-text">
            <Trash2 size={18} strokeWidth={2} />
          </span>
          <span className="font-semibold text-status-danger-text">{isDeleting ? "Deleting…" : "Delete Account"}</span>
        </button>
      </div>

      <EditProfileDialogV2 open={editProfileOpen} onClose={() => setEditProfileOpen(false)} />
      <PreferencesDialogV2 open={preferencesOpen} onClose={() => setPreferencesOpen(false)} />
    </div>
  );
}
