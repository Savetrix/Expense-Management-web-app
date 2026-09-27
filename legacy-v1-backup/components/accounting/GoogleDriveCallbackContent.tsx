"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { useEffect } from "react";

import { Spinner } from "@/components/ui/Spinner";

// Backend's Google Drive OAuth callback (public route on Scantrix_API)
// redirects the browser here after the user grants/denies access — this page
// only exists to read that result and bounce back to /accounting-software;
// it never calls the API itself.
export function GoogleDriveCallbackContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const success = searchParams.get("success") === "true";
  const error = searchParams.get("error");

  useEffect(() => {
    const timer = setTimeout(() => router.replace("/accounting-software"), 1800);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background-soft px-[var(--space-lg)]">
      <div className="w-full max-w-sm rounded-2xl bg-white p-[var(--space-xl)] text-center shadow-sm">
        {success ? (
          <>
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-success/10">
              <CheckCircle2 size={32} strokeWidth={1.75} className="text-success" />
            </span>
            <p className="mt-[var(--space-md)] text-h3 font-bold text-text-primary">Google Drive connected</p>
            <p className="mt-[var(--space-xs)] text-body-sm text-text-secondary">Taking you back…</p>
          </>
        ) : (
          <>
            <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-error/10">
              <XCircle size={32} strokeWidth={1.75} className="text-error" />
            </span>
            <p className="mt-[var(--space-md)] text-h3 font-bold text-text-primary">Couldn&apos;t connect Google Drive</p>
            <p className="mt-[var(--space-xs)] text-body-sm text-text-secondary">
              {error || "Something went wrong. Please try again."}
            </p>
          </>
        )}
        <Spinner size="sm" className="mx-auto mt-[var(--space-lg)] block" />
      </div>
    </div>
  );
}
