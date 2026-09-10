import type { Metadata } from "next";
import Link from "next/link";
import { FileQuestion } from "lucide-react";

import { Providers } from "./providers";
import { AuthGate } from "@/components/auth/AuthGate";

export const metadata: Metadata = {
  title: "Page not found — Scantrix",
  robots: { index: false, follow: false },
};

// Next.js renders this for every unmatched route, in place of its own
// unstyled default 404. It wraps itself in Providers > AuthGate because the
// signed-in product moved into the (app) route group and the root layout no
// longer supplies that pair — an unmatched URL still resolves against the root
// layout, so re-applying it here is what keeps AuthGate's existing
// redirect-to-/login behavior for an unauthenticated visitor on any non-public
// path exactly as it was (DESIGN_ASSUMPTIONS.md D4.2). Authenticated users
// still get this page inside the normal AppShell.
export default function NotFound() {
  return (
    <Providers>
      <AuthGate>
        <div className="flex min-h-[70vh] flex-col items-center justify-center px-[var(--space-lg)] text-center">
          <span className="mb-[var(--space-md)] flex h-16 w-16 items-center justify-center rounded-full bg-background-alt text-text-secondary">
            <FileQuestion size={32} strokeWidth={1.75} />
          </span>
          <h1 className="text-h2 font-bold text-trust-navy">Page not found</h1>
          <p className="mt-[var(--space-xs)] max-w-sm text-body-sm text-text-secondary">
            The page you&apos;re looking for doesn&apos;t exist or may have moved.
          </p>
          <Link
            href="/dashboard"
            className="mt-[var(--space-lg)] rounded-md bg-primary px-[var(--space-lg)] py-[var(--space-sm)] font-bold text-text-primary hover:opacity-90"
          >
            Back to Dashboard
          </Link>
        </div>
      </AuthGate>
    </Providers>
  );
}
