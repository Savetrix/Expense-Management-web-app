"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Wordmark } from "./primitives";
import { trackSignupClick } from "./pixel";

// Root-relative ("/#how", not "#how") because this nav is shared with the blog:
// a bare fragment would point at a section that doesn't exist on /blog. Link
// handles both cases: on the homepage it scrolls to the section (smoothly, via
// the scroll-behavior LandingPage sets), and from the blog it navigates home
// client-side and then scrolls.
const LINKS = [
  { href: "/#how", label: "How it works" },
  { href: "/#email", label: "Email forwarding" },
  { href: "/#capabilities", label: "Capabilities" },
  { href: "/#difference", label: "Why Scantrix" },
  { href: "/#pricing", label: "Pricing" },
  { href: "/#faq", label: "FAQ" },
  { href: "/blog", label: "Blog" },
];

/** "/blog" is a real route; everything else is a section of the homepage. */
const isRoute = (href: string) => !href.includes("#");

export function LandingNav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll while the mobile sheet is open.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div
        className={`transition-all duration-300 ${
          scrolled
            ? "border-b border-border bg-surface/85 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur-md"
            : "border-b border-transparent bg-transparent"
        }`}
      >
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Link href="/#top" aria-label="Scantrix home" className="shrink-0">
            <Wordmark />
          </Link>

          <div className="mx-6 hidden items-center gap-5 lg:flex xl:gap-8">
            {LINKS.map((link) => {
              const active = isRoute(link.href) && pathname?.startsWith(link.href);
              const className = `text-[14px] font-medium transition-colors hover:text-trust-navy ${
                active ? "text-trust-navy" : "text-text-secondary"
              }`;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={className}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>

          <div className="hidden items-center gap-2 lg:flex">
            <Link
              href="/login"
              className="rounded-lg px-3.5 py-2 text-[14px] font-semibold text-trust-navy transition-colors hover:bg-background-alt"
            >
              Log in
            </Link>
            <Link
              href="/register"
              onClick={trackSignupClick}
              className="rounded-lg bg-[color:var(--lp-navy)] px-4 py-2 text-[14px] font-semibold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              Start free
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            className="flex h-10 w-10 items-center justify-center rounded-lg text-trust-navy hover:bg-background-alt lg:hidden"
          >
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </nav>
      </div>

      {/* Mobile sheet */}
      {open && (
        <div className="border-b border-border bg-surface px-5 pb-6 pt-2 shadow-lg lg:hidden">
          <div className="flex flex-col">
            {LINKS.map((link) => {
              const className = "border-b border-border py-3.5 text-[15px] font-medium text-trust-navy";
              return (
                <Link key={link.href} href={link.href} onClick={() => setOpen(false)} className={className}>
                  {link.label}
                </Link>
              );
            })}
          </div>
          <div className="mt-4 flex flex-col gap-2.5">
            <Link
              href="/register"
              onClick={trackSignupClick}
              className="rounded-lg bg-[color:var(--lp-navy)] py-3 text-center text-[15px] font-semibold text-white"
            >
              Start free — 14 days
            </Link>
            <Link
              href="/login"
              className="rounded-lg border border-border py-3 text-center text-[15px] font-semibold text-trust-navy"
            >
              Log in
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
