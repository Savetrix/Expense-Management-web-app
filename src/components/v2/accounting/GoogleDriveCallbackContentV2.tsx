"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, XCircle } from "lucide-react";
import { useEffect } from "react";

import { Spinner } from "@/components/ui/Spinner";

// Backend's Google Drive OAuth callback (public route on Scantrix_API)
// redirects the browser here after the user grants/denies access — this page
// only exists to read that result and bounce back to /v2/accounting-software;
// it never calls the API itself.
//
// v2 redesign of src/components/accounting/GoogleDriveCallbackContent.tsx.
// Same query params, same 1.8s bounce, only the destination is the v2 route.
export function GoogleDriveCallbackContentV2() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const success = searchParams.get("success") === "true";
  const error = searchParams.get("error");

  useEffect(() => {
    const timer = setTimeout(() => router.replace("/v2/accounting-software"), 1800);
    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center p-[var(--space-md)] sm:p-[var(--space-lg)]">
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-[var(--space-lg)] text-center shadow-sm">
        {success ? (
          <>
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-status-success-border bg-status-success-bg">
              <CheckCircle2 size={28} strokeWidth={1.75} className="text-status-success-text" />
            </span>
            <p className="mt-[var(--space-md)] text-h3 font-bold text-content-primary">Google Drive connected</p>
            <p className="mt-[var(--space-xs)] text-caption text-content-secondary">Taking you back…</p>
          </>
        ) : (
          <>
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-status-danger-border bg-status-danger-bg">
              <XCircle size={28} strokeWidth={1.75} className="text-status-danger-text" />
            </span>
            <p className="mt-[var(--space-md)] text-h3 font-bold text-content-primary">
              Couldn&apos;t connect Google Drive
            </p>
            <p className="mt-[var(--space-xs)] text-caption text-content-secondary">
              {error || "Something went wrong. Please try again."}
            </p>
          </>
        )}
        <Spinner size="sm" className="mx-auto mt-[var(--space-lg)] block" />
      </div>
    </div>
  );
}
