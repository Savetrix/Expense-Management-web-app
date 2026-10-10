"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { trackSignupClick } from "@/components/landing/pixel";

// The blog is server-rendered, and a server component cannot attach an onClick.
// This is the one client piece it needs: a sign-up link that reports the same
// Meta Pixel "Lead" event as every CTA on the homepage, so blog-driven sign-ups
// are counted rather than silently missing from the numbers.
export function SignupLink({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Link href="/register" onClick={trackSignupClick} className={className}>
      {children}
    </Link>
  );
}
