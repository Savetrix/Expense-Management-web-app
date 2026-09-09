"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  AtSign,
  Building2,
  Check,
  Copy,
  CopyCheck,
  Eye,
  FolderSync,
  Keyboard,
  ListChecks,
  MailCheck,
  MessageSquare,
  Plug,
  Receipt,
  ScanLine,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { ReactNode, useEffect, useState } from "react";

import { BrandIcon } from "@/components/icons/BrandIcon";
import { CustomPlanEnquiryModal } from "@/components/subscription/CustomPlanEnquiryModal";
import { LandingNav } from "./LandingNav";
import {
  DashboardPreview,
  ExtractionDemo,
  MatchVisual,
  PostVisual,
  ScanVisual,
} from "./mockups";
import { LoadIn, Reveal, SectionLabel, Wordmark } from "./primitives";
import { trackSignupClick } from "./pixel";

function PrimaryCta({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      onClick={trackSignupClick}
      className={`group inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-trust-navy px-6 text-[15px] font-semibold text-white shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--lp-teal)] focus-visible:ring-offset-2 ${className}`}
    >
      {children}
      <ArrowRight size={17} strokeWidth={2.25} className="transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

function GhostCta({ href, children, className = "" }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-white px-6 text-[15px] font-semibold text-trust-navy transition-all hover:border-[color:var(--lp-teal)] hover:bg-[color:var(--lp-teal-050)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--lp-teal)] focus-visible:ring-offset-2 ${className}`}
    >
      {children}
    </a>
  );
}

// --- Hero -----------------------------------------------------------------

function Hero() {
  return (
    <section className="relative overflow-hidden pt-28 pb-16 sm:pt-32 sm:pb-20">
      <div className="lp-dotgrid pointer-events-none absolute inset-0 opacity-70" aria-hidden />
      <div
        className="lp-glow pointer-events-none absolute -right-24 -top-24 h-[520px] w-[520px] rounded-full"
        aria-hidden
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-white" aria-hidden />

      <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-5 sm:px-8 lg:grid-cols-[1fr_1.06fr] lg:gap-10">
        <div className="max-w-xl">
          <LoadIn>
            <span className="inline-flex items-center gap-2 rounded-pill border border-border bg-white px-3 py-1.5 text-[12.5px] font-semibold text-trust-navy shadow-sm">
              <BrandIcon name="quickbooks" size={14} />
              Built for QuickBooks Online
            </span>
          </LoadIn>

          <LoadIn delay={80}>
            <h1 className="mt-5 text-[clamp(2.4rem,6vw,4rem)] font-bold leading-[1.04] tracking-[-0.03em] text-trust-navy">
              Your invoices, posted to QuickBooks —{" "}
              <span className="relative whitespace-nowrap text-[color:var(--lp-teal-700)]">
                automatically
                <svg className="absolute -bottom-1 left-0 h-2.5 w-full" viewBox="0 0 200 10" preserveAspectRatio="none" aria-hidden>
                  <path d="M2 7 C 50 2, 150 2, 198 6" stroke="var(--lp-teal)" strokeWidth="3" fill="none" strokeLinecap="round" />
                </svg>
              </span>
              .
            </h1>
          </LoadIn>

          <LoadIn delay={160}>
            <p className="mt-6 text-[17px] leading-relaxed text-text-secondary">
              Forward it, drop it in, or let the assistant handle it. Scantrix reads every
              invoice — vendor, amounts, dates — matches it to the right vendor in
              QuickBooks, and posts the bill. You only review the ones that actually need
              a human.
            </p>
          </LoadIn>

          <LoadIn delay={240}>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <PrimaryCta href="/register">Start free — 14 days</PrimaryCta>
              <GhostCta href="#how">See how it works</GhostCta>
            </div>
          </LoadIn>

          <LoadIn delay={320}>
            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] font-medium text-text-secondary">
              <span className="inline-flex items-center gap-1.5">
                <Check size={15} className="text-[color:var(--lp-auto)]" strokeWidth={2.5} /> No credit card
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check size={15} className="text-[color:var(--lp-auto)]" strokeWidth={2.5} /> 14-day free trial
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Check size={15} className="text-[color:var(--lp-auto)]" strokeWidth={2.5} /> Built for accountants
              </span>
            </div>
          </LoadIn>
        </div>

        <LoadIn delay={220} className="relative">
          <div
            className="lp-glow pointer-events-none absolute -inset-6 -z-10 rounded-full opacity-70"
            aria-hidden
          />
          <div className="lp-float">
            <ExtractionDemo />
          </div>
        </LoadIn>
      </div>
    </section>
  );
}

// --- Integration strip -----------------------------------------------------

function IntegrationStrip() {
  return (
    <section className="border-y border-border bg-[color:var(--lp-alt)]">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-5 px-5 py-8 sm:flex-row sm:justify-between sm:px-8">
        <p className="text-[13.5px] font-medium text-text-secondary">
          Connects to the tools your books already run on
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-3">
          <span className="inline-flex items-center gap-2 text-[14px] font-semibold text-trust-navy">
            <BrandIcon name="quickbooks" size={18} /> QuickBooks
            <span className="rounded-pill bg-[#E8F7F1] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[color:var(--lp-auto)]">Live</span>
          </span>
          <span className="inline-flex items-center gap-2 text-[14px] font-semibold text-trust-navy">
            <BrandIcon name="google-drive" size={17} /> Google Drive
            <span className="rounded-pill bg-[#E8F7F1] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[color:var(--lp-auto)]">Live</span>
          </span>
          <span className="inline-flex items-center gap-2 text-[14px] font-semibold text-text-secondary opacity-70">
            <BrandIcon name="zoho" size={17} /> Zoho Books
            <span className="rounded-pill bg-background-alt px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-text-secondary">Soon</span>
          </span>
          <span className="inline-flex items-center gap-2 text-[14px] font-semibold text-text-secondary opacity-70">
            <BrandIcon name="sage" size={17} /> Sage Intacct
            <span className="rounded-pill bg-background-alt px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-text-secondary">Soon</span>
          </span>
        </div>
      </div>
    </section>
  );
}

// --- Problem ---------------------------------------------------------------

const PROBLEMS = [
  {
    icon: Keyboard,
    title: "Retyping every invoice",
    body: "Vendor, amount, date, invoice number — keyed into QuickBooks by hand, one bill at a time.",
  },
  {
    icon: Search,
    title: "Matching vendors manually",
    body: "Hunting for the right vendor in your books, and creating duplicates when the name doesn't quite line up.",
  },
  {
    icon: AlertTriangle,
    title: "Month-end pileups and slips",
    body: "Invoices stack up, a wrong total sneaks through, and reconciliation eats the last days of the month.",
  },
];

function Problem() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <Reveal>
          <SectionLabel>The problem</SectionLabel>
          <h2 className="mt-4 text-[clamp(1.8rem,3.6vw,2.6rem)] font-bold leading-[1.1] tracking-[-0.02em] text-trust-navy">
            Accounts payable still runs on manual data entry.
          </h2>
          <p className="mt-5 text-[16px] leading-relaxed text-text-secondary">
            Every bill that lands in an inbox becomes a small chore: read it, type it,
            find the vendor, post it, hope the numbers are right. It scales badly, and
            it&apos;s where the errors hide.
          </p>
        </Reveal>

        <div className="flex flex-col gap-4">
          {PROBLEMS.map((p, i) => {
            const Icon = p.icon;
            return (
              <Reveal key={p.title} delay={i * 90}>
                <div className="flex gap-4 rounded-2xl border border-border bg-white p-5 shadow-sm">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-background-alt text-text-secondary">
                    <Icon size={20} strokeWidth={2} />
                  </span>
                  <div>
                    <h3 className="text-[15.5px] font-bold text-text-primary">{p.title}</h3>
                    <p className="mt-1 text-[14px] leading-relaxed text-text-secondary">{p.body}</p>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// --- How it works ----------------------------------------------------------

const STEPS = [
  {
    n: "01",
    title: "Send it in",
    body: "Forward the email, drop in a PDF, or snap a photo. Scantrix queues it and starts reading immediately.",
    visual: <ScanVisual />,
  },
  {
    n: "02",
    title: "Extract & match",
    body: "It pulls the vendor, invoice number, dates and totals — then matches the vendor to your QuickBooks list.",
    visual: <MatchVisual />,
  },
  {
    n: "03",
    title: "Post to QuickBooks",
    body: "Confident invoices post as bills automatically. Anything unsure waits in your review queue.",
    visual: <PostVisual />,
  },
];

function HowItWorks() {
  return (
    <section id="how" className="scroll-mt-20 border-y border-border bg-[color:var(--lp-soft)]">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <SectionLabel className="justify-center">How it works</SectionLabel>
          <h2 className="mt-4 text-[clamp(1.9rem,3.8vw,2.7rem)] font-bold leading-[1.1] tracking-[-0.02em] text-trust-navy">
            From invoice to posted bill in three steps.
          </h2>
        </Reveal>

        <div className="relative mt-14 grid gap-6 md:grid-cols-3">
          <div className="pointer-events-none absolute left-0 right-0 top-9 hidden h-px bg-gradient-to-r from-transparent via-border to-transparent md:block" aria-hidden />
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 110} className="relative flex flex-col">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-white text-[13px] font-bold text-[color:var(--lp-teal-700)] shadow-sm">
                  {s.n}
                </span>
                <h3 className="text-[18px] font-bold text-trust-navy">{s.title}</h3>
              </div>
              <p className="mt-3 text-[14.5px] leading-relaxed text-text-secondary">{s.body}</p>
              <div className="mt-5">{s.visual}</div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

// --- Email forwarding ------------------------------------------------------

const FORWARD_GUARDS = [
  {
    icon: <Users size={17} strokeWidth={2} />,
    title: "Only people you name",
    body: "You list who may send. Mail from anyone else is discarded — no invoice, no trace, no reply that confirms the address exists.",
  },
  {
    icon: <ShieldCheck size={17} strokeWidth={2} />,
    title: "Spoofing checked, every time",
    body: "Sender addresses can be forged, so each message is verified against the anti-spoofing records its own domain publishes.",
  },
  {
    icon: <MailCheck size={17} strokeWidth={2} />,
    title: "Attachments treated as hostile",
    body: "A file's name proves nothing. Contents are inspected and virus-scanned before anything reaches your books.",
  },
];

function EmailForwarding() {
  return (
    <section id="email" className="scroll-mt-20 relative overflow-hidden border-b border-border bg-white">
      <div
        className="lp-glow pointer-events-none absolute -left-32 top-10 h-[420px] w-[420px] rounded-full opacity-60"
        aria-hidden
      />
      <div className="relative mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <SectionLabel className="justify-center">New — Email forwarding</SectionLabel>
          <h2 className="mt-4 text-[clamp(1.9rem,3.8vw,2.7rem)] font-bold leading-[1.1] tracking-[-0.02em] text-trust-navy">
            Stop downloading attachments to upload them again.
          </h2>
          <p className="mt-5 text-[16.5px] leading-relaxed text-text-secondary">
            Every QuickBooks company gets its own address. Forward the invoice to it and
            you&apos;re done — no download, no re-upload, nothing to file. It lands in the
            same review queue as anything else.
          </p>
        </Reveal>

        {/* The address is the product here, so it gets to be the hero object. */}
        <Reveal delay={90} className="mt-12">
          <div className="mx-auto max-w-2xl rounded-2xl border border-border bg-[color:var(--lp-soft)] p-5 shadow-sm sm:p-6">
            <p className="text-[12px] font-semibold uppercase tracking-wider text-text-secondary">
              Forward invoices to
            </p>
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-border bg-white px-4 py-3.5 shadow-sm">
              <AtSign size={17} strokeWidth={2.2} className="shrink-0 text-[color:var(--lp-teal-600)]" />
              <code className="min-w-0 flex-1 break-all text-[14.5px] font-semibold text-trust-navy">
                <span className="text-[color:var(--lp-teal-700)]">acme-corp</span>@invoice.scantrix.ai
              </code>
              <CopyCheck size={16} strokeWidth={2} className="hidden shrink-0 text-[color:var(--lp-auto)] sm:block" aria-hidden />
            </div>
            <p className="mt-3.5 text-[13.5px] leading-relaxed text-text-secondary">
              Pick your own name for it — <span className="font-semibold text-text-primary">acme-corp</span>,{" "}
              <span className="font-semibold text-text-primary">acme.payables</span>, whatever your team
              will remember. Give it to a supplier once and their invoices file themselves from then on.
            </p>
          </div>
        </Reveal>

        {/* One address per company is the real answer to multi-entity books. */}
        <Reveal delay={160} className="mt-12">
          <div className="grid gap-5 lg:grid-cols-[1.05fr_1fr]">
            <div className="rounded-2xl border border-border bg-white p-6 shadow-sm">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[color:var(--lp-teal-050)] text-[color:var(--lp-teal-600)]">
                <Building2 size={20} strokeWidth={2} />
              </span>
              <h3 className="mt-4 text-[16.5px] font-bold text-trust-navy">
                One address per company — so nothing lands in the wrong books
              </h3>
              <p className="mt-2.5 text-[14px] leading-relaxed text-text-secondary">
                Handling five clients means five addresses. The address decides which company
                an invoice belongs to, so nobody picks from a dropdown at the moment of
                forwarding — and nobody picks wrong.
              </p>
              <div className="mt-5 flex flex-col gap-2">
                {[
                  { name: "Acme Corp", handle: "acme-corp" },
                  { name: "Devyani International", handle: "devyani" },
                  { name: "Funky Finger Inc", handle: "funkyfinger" },
                ].map((c) => (
                  <div
                    key={c.handle}
                    className="flex items-center justify-between gap-3 rounded-lg border border-border bg-[color:var(--lp-soft)] px-3 py-2.5"
                  >
                    <span className="truncate text-[13px] font-semibold text-text-primary">{c.name}</span>
                    <code className="shrink-0 text-[12px] font-medium text-[color:var(--lp-teal-700)]">
                      {c.handle}@…
                    </code>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-col gap-4">
              {FORWARD_GUARDS.map((g) => (
                <div key={g.title} className="rounded-2xl border border-border bg-white p-5 shadow-sm">
                  <div className="flex items-start gap-3.5">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[color:var(--lp-teal-050)] text-[color:var(--lp-teal-600)]">
                      {g.icon}
                    </span>
                    <div>
                      <h3 className="text-[14.5px] font-bold text-trust-navy">{g.title}</h3>
                      <p className="mt-1.5 text-[13.5px] leading-relaxed text-text-secondary">{g.body}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Reveal>

        {/* The honest limits, stated as choices. Reads as confidence, not caveat. */}
        <Reveal delay={230} className="mt-8">
          <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-[color:var(--lp-soft)] p-5 sm:p-6">
            <p className="text-[13.5px] leading-relaxed text-text-secondary">
              <span className="font-bold text-trust-navy">Forwarding never posts on its own.</span>{" "}
              An emailed invoice follows exactly the same reading, vendor matching, duplicate
              checks and review rules as one you upload by hand — arriving by email is never a
              reason to skip a step. PDFs and images, attached or dragged into the message.
              Links in the body are deliberately never opened.
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// --- Capabilities (bento) --------------------------------------------------

function CapabilityTile({
  icon,
  title,
  body,
  className = "",
  children,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={`group flex flex-col rounded-2xl border border-border bg-white p-6 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[color:var(--lp-teal)]/40 hover:shadow-md ${className}`}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-[color:var(--lp-teal-050)] text-[color:var(--lp-teal-600)]">
        {icon}
      </span>
      <h3 className="mt-4 text-[16.5px] font-bold text-trust-navy">{title}</h3>
      <p className="mt-2 text-[14px] leading-relaxed text-text-secondary">{body}</p>
      {children}
    </div>
  );
}

function Capabilities() {
  return (
    <section id="capabilities" className="scroll-mt-20 mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
      <Reveal className="max-w-2xl">
        <SectionLabel>Capabilities</SectionLabel>
        <h2 className="mt-4 text-[clamp(1.9rem,3.8vw,2.7rem)] font-bold leading-[1.1] tracking-[-0.02em] text-trust-navy">
          Everything your AP workflow needs — nothing it doesn&apos;t.
        </h2>
        <p className="mt-5 text-[16px] leading-relaxed text-text-secondary">
          Built around what accountants actually do all day: read bills, keep vendors
          straight, catch the ones you&apos;ve already paid, and get clean data into the
          books.
        </p>
      </Reveal>

      <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <Reveal className="md:col-span-2">
          <CapabilityTile
            icon={<ScanLine size={20} strokeWidth={2} />}
            title="Reads every field, not just the total"
            body="Vendor, invoice number, dates, line items, totals and currency — captured and confirmed, ready to post."
            className="h-full"
          >
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {["Vendor", "Invoice #", "Date", "Total", "Currency", "Line items"].map((f) => (
                <span key={f} className="flex items-center gap-1.5 rounded-lg border border-border bg-[color:var(--lp-soft)] px-2.5 py-2 text-[12px] font-medium text-text-primary">
                  <Check size={13} strokeWidth={3} className="shrink-0 text-[color:var(--lp-auto)]" /> {f}
                </span>
              ))}
            </div>
          </CapabilityTile>
        </Reveal>

        <Reveal delay={70}>
          <CapabilityTile
            icon={<BrandIcon name="quickbooks" size={20} />}
            title="Posts straight to QuickBooks"
            body="Confident bills post automatically as QuickBooks bills — no copy-paste, no re-keying."
            className="h-full"
          />
        </Reveal>

        <Reveal delay={70}>
          <CapabilityTile
            icon={<Search size={20} strokeWidth={2} />}
            title="Resolves vendors for you"
            body="Matches each invoice to the right vendor in your books, so you stop creating duplicates."
            className="h-full"
          />
        </Reveal>

        <Reveal delay={140}>
          <CapabilityTile
            icon={<Building2 size={20} strokeWidth={2} />}
            title="Handles multiple companies"
            body="Connect several QuickBooks companies and switch between them — built for multi-entity books."
            className="h-full"
          />
        </Reveal>

        <Reveal delay={140}>
          <CapabilityTile
            icon={<ListChecks size={20} strokeWidth={2} />}
            title="A review queue for exceptions"
            body="Anything low-confidence or failed waits in one place, with the reason, for a quick human check."
            className="h-full"
          />
        </Reveal>

        <Reveal delay={175}>
          <CapabilityTile
            icon={<Copy size={20} strokeWidth={2} />}
            title="Catches the invoice you already paid"
            body="Same vendor, same invoice number, second time around — flagged before it posts, not after the payment run."
            className="h-full"
          />
        </Reveal>

        <Reveal delay={175}>
          <CapabilityTile
            icon={<Receipt size={20} strokeWidth={2} />}
            title="Your accounts and tax codes, in sync"
            body="Pull your chart of accounts and tax codes from QuickBooks, refresh them on demand, and create what's missing without leaving Scantrix."
            className="h-full"
          />
        </Reveal>

        <Reveal delay={210}>
          <CapabilityTile
            icon={<Users size={20} strokeWidth={2} />}
            title="Tidies up your vendor list"
            body="Spots the near-duplicates that accumulate over years — the ones a human eye skims past — and suggests the merge."
            className="h-full"
          />
        </Reveal>

        <Reveal delay={210}>
          <CapabilityTile
            icon={<FolderSync size={20} strokeWidth={2} />}
            title="Connects to Google Drive"
            body="Point Scantrix at Drive and pull invoices from where your team already files them."
            className="h-full"
          />
        </Reveal>

        <Reveal delay={245} className="md:col-span-2 lg:col-span-3">
          <div className="flex flex-col items-start gap-5 rounded-2xl border border-border bg-white p-6 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[color:var(--lp-teal-050)] text-[color:var(--lp-teal-600)]">
                <UserPlus size={20} strokeWidth={2} />
              </span>
              <div>
                <h3 className="text-[16.5px] font-bold text-trust-navy">Bring your whole team</h3>
                <p className="mt-2 max-w-xl text-[14px] leading-relaxed text-text-secondary">
                  Invite unlimited teammates to scan, review and post together — everyone
                  working from the same books, on every plan.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center -space-x-2.5" aria-hidden>
              {["S", "A", "R", "M"].map((initial, i) => (
                <span
                  key={initial}
                  className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white text-[12px] font-bold text-white shadow-sm"
                  style={{ background: i % 2 === 0 ? "var(--lp-navy)" : "var(--lp-teal-600)" }}
                >
                  {initial}
                </span>
              ))}
              <span className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-background-alt text-[12px] font-bold text-text-secondary shadow-sm">
                +
              </span>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// --- Assistant -------------------------------------------------------------

/** Real prompts, each mapping to a tool the assistant actually has. */
const ASSISTANT_ASKS = [
  "What did we spend with Northwind last quarter?",
  "Show me everything still waiting for review.",
  "Create a vendor for Payroll Harmony Services.",
  "Post invoice 1988 to QuickBooks.",
  "Which vendors are duplicates?",
];

function Assistant() {
  return (
    <section id="assistant" className="scroll-mt-20 border-b border-border bg-[color:var(--lp-soft)]">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-[1fr_1.02fr] lg:gap-14">
          <Reveal>
            <SectionLabel>Assistant</SectionLabel>
            <h2 className="mt-4 text-[clamp(1.9rem,3.8vw,2.7rem)] font-bold leading-[1.1] tracking-[-0.02em] text-trust-navy">
              Ask for it instead of clicking for it.
            </h2>
            <p className="mt-5 text-[16px] leading-relaxed text-text-secondary">
              A built-in assistant that doesn&apos;t just answer questions — it does the work.
              Summarise spend, fix a vendor, post a bill, sync your chart of accounts. It
              works on your books, with your permissions, and asks before anything that
              changes them.
            </p>

            <div className="mt-7 flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--lp-teal-050)] text-[color:var(--lp-teal-600)]">
                  <Check size={13} strokeWidth={3} />
                </span>
                <p className="text-[14.5px] leading-relaxed text-text-secondary">
                  <span className="font-semibold text-text-primary">It confirms before it writes.</span>{" "}
                  Anything that touches QuickBooks is shown to you first.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--lp-teal-050)] text-[color:var(--lp-teal-600)]">
                  <Check size={13} strokeWidth={3} />
                </span>
                <p className="text-[14.5px] leading-relaxed text-text-secondary">
                  <span className="font-semibold text-text-primary">Your conversations are yours.</span>{" "}
                  Saved per user, per company — never pooled across the team.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--lp-teal-050)] text-[color:var(--lp-teal-600)]">
                  <Check size={13} strokeWidth={3} />
                </span>
                <p className="text-[14.5px] leading-relaxed text-text-secondary">
                  <span className="font-semibold text-text-primary">Scoped to what you can see.</span>{" "}
                  It can never reach a company you don&apos;t have access to.
                </p>
              </div>
            </div>
          </Reveal>

          <Reveal delay={110}>
            <div className="rounded-2xl border border-border bg-white p-5 shadow-sm sm:p-6">
              <div className="flex items-center gap-2.5 border-b border-border pb-4">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--lp-teal-050)] text-[color:var(--lp-teal-600)]">
                  <MessageSquare size={16} strokeWidth={2} />
                </span>
                <span className="text-[13.5px] font-bold text-trust-navy">Ask Scantrix</span>
              </div>
              <div className="mt-4 flex flex-col gap-2.5">
                {ASSISTANT_ASKS.map((q, i) => (
                  <div
                    key={q}
                    className="rounded-xl border border-border bg-[color:var(--lp-soft)] px-3.5 py-3 text-[13.5px] leading-snug text-text-primary"
                    style={{ opacity: 1 - i * 0.13 }}
                  >
                    {q}
                  </div>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-border px-3.5 py-3">
                <Sparkles size={15} strokeWidth={2} className="shrink-0 text-[color:var(--lp-teal-600)]" />
                <span className="text-[13px] text-text-secondary">…or just describe what you need.</span>
              </div>
            </div>
          </Reveal>
        </div>

      </div>
    </section>
  );
}

// --- Claude connector ------------------------------------------------------

/** Grouped the way a user thinks about them, not the way they are named. */
const CONNECTOR_GROUPS = [
  { label: "Invoices", body: "Upload, read, correct, post to QuickBooks, reject" },
  { label: "Vendors", body: "Create, update, deactivate, reactivate, list" },
  { label: "Companies", body: "Connect QuickBooks, switch the active company, check status" },
  { label: "Team & plan", body: "Invite teammates, manage members, review your subscription" },
];

function ClaudeConnector() {
  return (
    <section id="claude" className="scroll-mt-20 relative overflow-hidden border-b border-border bg-[color:var(--lp-navy-950)]">
      <div
        className="pointer-events-none absolute -right-32 -top-32 h-[520px] w-[520px] rounded-full opacity-[0.18]"
        style={{ background: "radial-gradient(circle, var(--lp-teal) 0%, transparent 65%)" }}
        aria-hidden
      />
      <div className="relative mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
        <div className="grid items-center gap-12 lg:grid-cols-[1.04fr_1fr] lg:gap-14">
          <Reveal>
            <span className="inline-flex items-center gap-2 rounded-pill border border-white/15 bg-white/5 px-3 py-1.5 text-[12.5px] font-semibold text-white/90">
              <Plug size={14} strokeWidth={2.2} />
              Early access
            </span>

            <h2 className="mt-5 text-[clamp(1.9rem,3.8vw,2.7rem)] font-bold leading-[1.1] tracking-[-0.02em] text-white">
              Run your books from Claude.
            </h2>

            <p className="mt-5 text-[16.5px] leading-relaxed text-white/70">
              Scantrix is built as a one-click connector for Claude. Add it once, sign in
              through your browser, and Claude can work directly on your invoices, vendors
              and QuickBooks companies — no config files, no API keys, no exporting
              spreadsheets back and forth.
            </p>

            <div className="mt-8 flex flex-col gap-3">
              {[
                "Add custom connector, paste the URL, sign in. Done.",
                "33 tools — the whole product, not a read-only slice.",
                "Your own permissions apply; it sees only your companies.",
                "Anything that writes to QuickBooks asks you first.",
              ].map((line) => (
                <div key={line} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[color:var(--lp-teal)]/15 text-[color:var(--lp-teal)]">
                    <Check size={13} strokeWidth={3} />
                  </span>
                  <p className="text-[14.5px] leading-relaxed text-white/75">{line}</p>
                </div>
              ))}
            </div>

            <p className="mt-7 text-[13px] leading-relaxed text-white/45">
              Built on the Model Context Protocol with full OAuth 2.1, so your Scantrix
              password never reaches the assistant.
            </p>
          </Reveal>

          <Reveal delay={110}>
            <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-5 shadow-lg sm:p-6">
              <p className="text-[12px] font-semibold uppercase tracking-wider text-white/45">
                What Claude can do
              </p>
              <div className="mt-4 flex flex-col gap-2.5">
                {CONNECTOR_GROUPS.map((g) => (
                  <div key={g.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3.5">
                    <p className="text-[13.5px] font-bold text-white">{g.label}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-white/60">{g.body}</p>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-xl border border-dashed border-white/15 px-4 py-3">
                <p className="text-[13px] leading-relaxed text-white/55">
                  <span className="font-semibold text-white/80">&ldquo;Upload this invoice to Acme
                  and post it once you&apos;ve checked the vendor.&rdquo;</span>
                </p>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

// --- Dashboard showcase ----------------------------------------------------

const SHOWCASE_POINTS = [
  { color: "var(--lp-auto)", label: "Auto-posted", body: "Bills Scantrix was confident about, already in QuickBooks." },
  { color: "var(--lp-manual)", label: "Manually posted", body: "Ones you reviewed and pushed through yourself." },
  { color: "var(--lp-failed)", label: "Failed", body: "Held back with a clear reason — never posted silently." },
];

function DashboardShowcase() {
  return (
    <section className="relative overflow-hidden border-y border-border bg-[color:var(--lp-alt)]">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[1fr_1.1fr] lg:gap-16">
        <Reveal>
          <SectionLabel>One clear view</SectionLabel>
          <h2 className="mt-4 text-[clamp(1.8rem,3.6vw,2.6rem)] font-bold leading-[1.1] tracking-[-0.02em] text-trust-navy">
            See exactly where every invoice stands.
          </h2>
          <p className="mt-5 text-[16px] leading-relaxed text-text-secondary">
            The dashboard opens on what matters: what needs review, what posted on its
            own, and what didn&apos;t — colour-coded, counted, and one click from the detail.
          </p>
          <div className="mt-7 flex flex-col gap-4">
            {SHOWCASE_POINTS.map((p) => (
              <div key={p.label} className="flex items-start gap-3">
                <span className="mt-1.5 h-3 w-3 shrink-0 rounded-sm" style={{ background: p.color }} aria-hidden />
                <p className="text-[14.5px] leading-relaxed text-text-secondary">
                  <span className="font-bold text-text-primary">{p.label}.</span> {p.body}
                </p>
              </div>
            ))}
          </div>
        </Reveal>

        <Reveal delay={140} className="relative">
          <div className="lp-glow pointer-events-none absolute -inset-8 -z-10 rounded-full opacity-60" aria-hidden />
          <DashboardPreview />
        </Reveal>
      </div>
    </section>
  );
}

// --- Differentiation -------------------------------------------------------

const MANUAL_WAY = [
  "Read and retype every invoice into QuickBooks",
  "Search for the vendor and risk duplicates",
  "Catch wrong totals only if you notice them",
  "No single place to see what's outstanding",
];

const SCANTRIX_WAY = [
  "Invoices are read and posted as QuickBooks bills",
  "Vendors matched to your books automatically",
  "Low-confidence bills held for review, with reasons",
  "One dashboard for auto-posted, manual and failed",
];

function Differentiation() {
  return (
    <section id="difference" className="scroll-mt-20 mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
      <Reveal className="mx-auto max-w-2xl text-center">
        <SectionLabel className="justify-center">Why Scantrix</SectionLabel>
        <h2 className="mt-4 text-[clamp(1.9rem,3.8vw,2.7rem)] font-bold leading-[1.1] tracking-[-0.02em] text-trust-navy">
          More than OCR. It finishes the job.
        </h2>
        <p className="mt-5 text-[16px] leading-relaxed text-text-secondary">
          Plain scanning gives you text. Scantrix gives you a posted bill in the right
          company, against the right vendor.
        </p>
      </Reveal>

      <div className="mt-12 grid gap-5 lg:grid-cols-2">
        <Reveal className="h-full">
          <div className="flex h-full flex-col rounded-2xl border border-border bg-[color:var(--lp-soft)] p-7">
            <span className="text-[13px] font-bold uppercase tracking-[0.14em] text-text-secondary">By hand · plain OCR</span>
            <ul className="mt-5 flex flex-col gap-3.5">
              {MANUAL_WAY.map((item) => (
                <li key={item} className="flex items-start gap-3 text-[14.5px] text-text-secondary">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-background-alt">
                    <X size={12} strokeWidth={2.75} className="text-text-secondary" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>

        <Reveal delay={110} className="h-full">
          <div
            className="relative flex h-full flex-col overflow-hidden rounded-2xl border border-[color:var(--lp-teal)]/30 p-7 shadow-md"
            style={{ background: "linear-gradient(160deg, #ffffff 0%, var(--lp-teal-050) 100%)" }}
          >
            <div className="lp-glow pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-60" aria-hidden />
            <span className="inline-flex items-center gap-2 text-[13px] font-bold uppercase tracking-[0.14em] text-[color:var(--lp-teal-700)]">
              With Scantrix
            </span>
            <ul className="mt-5 flex flex-col gap-3.5">
              {SCANTRIX_WAY.map((item) => (
                <li key={item} className="flex items-start gap-3 text-[14.5px] font-medium text-text-primary">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color:var(--lp-auto)]">
                    <Check size={12} strokeWidth={3} className="text-white" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// --- Pricing ---------------------------------------------------------------

// `href: null` marks the card whose CTA opens the enquiry modal instead of
// navigating. Every other plan still links to /register exactly as before —
// the three self-serve plans are untouched by the Custom addition.
const PLANS: {
  name: string;
  tagline: string;
  price: string;
  suffix: string;
  features: string[];
  highlight: boolean;
  cta: string;
  href: string | null;
}[] = [
  {
    name: "Trial",
    tagline: "Try Scantrix free for 14 days",
    price: "$0",
    suffix: "for 14 days",
    features: ["Unlimited scans", "Unlimited team members", "1 QuickBooks company"],
    highlight: false,
    cta: "Start free trial",
    href: "/register",
  },
  {
    name: "Standard",
    tagline: "For growing teams",
    price: "Monthly / yearly",
    suffix: "",
    features: ["Unlimited scans", "Unlimited team members", "1 QuickBooks company"],
    highlight: false,
    cta: "Start free trial",
    href: "/register",
  },
  {
    name: "Enterprise",
    tagline: "For multi-entity businesses",
    price: "Monthly / yearly",
    suffix: "",
    features: ["Unlimited scans", "Unlimited team members", "3 QuickBooks companies"],
    highlight: true,
    cta: "Start free trial",
    href: "/register",
  },
  {
    name: "Custom",
    tagline: "For businesses that outgrow the plans above",
    price: "Let's talk",
    suffix: "",
    features: [
      "Invoice volumes sized to your throughput",
      "Multiple companies and entities",
      "Large teams with roles that fit",
      "Custom integrations and workflows",
      "Guided onboarding and priority support",
    ],
    highlight: false,
    cta: "Talk to Sales",
    href: null,
  },
];

function Pricing() {
  const [enquiryOpen, setEnquiryOpen] = useState(false);

  return (
    <section id="pricing" className="scroll-mt-20 border-y border-border bg-[color:var(--lp-soft)]">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
        <Reveal className="mx-auto max-w-2xl text-center">
          <SectionLabel className="justify-center">Pricing</SectionLabel>
          <h2 className="mt-4 text-[clamp(1.9rem,3.8vw,2.7rem)] font-bold leading-[1.1] tracking-[-0.02em] text-trust-navy">
            Start free. Scale when you&apos;re ready.
          </h2>
          <p className="mt-5 text-[16px] leading-relaxed text-text-secondary">
            Every plan begins with a 14-day free trial — no credit card. Plans differ
            mainly by how many QuickBooks companies you connect — and if none of them
            fit, we&apos;ll build one that does.
          </p>
        </Reveal>

        {/*
          Four cards, so the breakpoints move: one column on phones, a 2x2 grid
          from sm through lg, and a single row only at xl. Going four-across at
          `lg` would leave each card about 177px of content inside max-w-6xl,
          which wraps every feature line. Card padding drops 28px -> 24px for
          the same reason.
        */}
        <div className="mt-12 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((plan, i) => {
            const isCustom = plan.href === null;
            // Shared by the <Link> and the <button> so the two CTAs are
            // pixel-identical — only the element differs.
            const ctaClass = `mt-7 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl text-[14.5px] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--lp-teal)] focus-visible:ring-offset-2 ${
              plan.highlight || isCustom
                ? "bg-trust-navy text-white shadow-sm hover:-translate-y-0.5 hover:shadow-md"
                : "border border-border bg-white text-trust-navy hover:border-[color:var(--lp-teal)] hover:bg-[color:var(--lp-teal-050)]"
            }`;

            return (
              <Reveal key={plan.name} delay={i * 90} className="h-full">
                <div
                  className={`relative flex h-full flex-col rounded-2xl border bg-white p-6 ${
                    plan.highlight
                      ? "border-[color:var(--lp-teal)] shadow-lg"
                      : isCustom
                        ? "border-dashed border-[color:var(--lp-teal)]/60 shadow-sm"
                        : "border-border shadow-sm"
                  }`}
                >
                  {plan.highlight && (
                    <span className="absolute -top-3 right-6 rounded-pill bg-[color:var(--lp-teal)] px-3 py-1 text-[10.5px] font-bold uppercase tracking-wide text-trust-navy">
                      Most popular
                    </span>
                  )}
                  <h3 className="flex items-center gap-2 text-[19px] font-bold text-trust-navy">
                    {isCustom && (
                      <Sparkles size={17} strokeWidth={2.25} className="shrink-0 text-[color:var(--lp-teal-700)]" />
                    )}
                    {plan.name}
                  </h3>
                  <p className="mt-1 text-[13px] text-text-secondary">{plan.tagline}</p>
                  <div className="mt-5 flex items-end gap-1.5">
                    {/*
                      Steps down at xl only. That is the breakpoint where four
                      cards share max-w-6xl (~225px of content each), and
                      "Monthly / yearly" wraps to two lines at 26px — which
                      pushed those two cards' dividers out of line with Trial's
                      and Custom's. Cards are WIDER at lg (2-up) than at xl, so
                      shrinking the type as the grid widens is the right way
                      round.
                    */}
                    <span className="text-[26px] font-bold leading-none text-text-primary xl:text-[22px]">
                      {plan.price}
                    </span>
                    {plan.suffix && <span className="mb-0.5 text-[13px] text-text-secondary">{plan.suffix}</span>}
                  </div>
                  <div className="my-5 h-px bg-border" />
                  <ul className="flex flex-1 flex-col gap-3">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-[14px] text-text-primary">
                        <Check
                          size={16}
                          strokeWidth={2.75}
                          className="mt-[3px] shrink-0 text-[color:var(--lp-auto)]"
                        />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                  {isCustom ? (
                    <button type="button" onClick={() => setEnquiryOpen(true)} className={ctaClass}>
                      {plan.cta}
                      <ArrowRight size={16} strokeWidth={2.25} />
                    </button>
                  ) : (
                    <Link href={plan.href as string} onClick={trackSignupClick} className={ctaClass}>
                      {plan.cta}
                    </Link>
                  )}
                </div>
              </Reveal>
            );
          })}
        </div>
        <Reveal className="mt-7 text-center">
          <p className="text-[12.5px] text-text-secondary">
            Current plan pricing is shown in the app when you start your trial.
          </p>
        </Reveal>
      </div>

      {/*
        Mounted OUTSIDE the <Reveal>-wrapped grid. `.lp-reveal` sets
        `will-change: transform`, which would make it the containing block for
        a fixed-position child — the modal portals to document.body anyway, but
        keeping the trigger's sibling out here makes that independence explicit.
      */}
      {enquiryOpen && (
        <CustomPlanEnquiryModal onClose={() => setEnquiryOpen(false)} surface="landing" />
      )}
    </section>
  );
}

// --- About -------------------------------------------------------------

const VALUES = [
  {
    icon: Target,
    title: "Accuracy first",
    body: "We'd rather hold a bill back for a quick review than post something wrong to your books.",
  },
  {
    icon: Users,
    title: "Built for accountants",
    body: "Every workflow decision starts from how AP actually works day to day — not a generic OCR demo.",
  },
  {
    icon: Eye,
    title: "Nothing disappears quietly",
    body: "If an invoice doesn't post, you get a clear reason and a place to fix it — never a silent failure.",
  },
];

function About() {
  return (
    <section id="about" className="scroll-mt-20 mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
      <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:gap-16">
        <Reveal>
          <SectionLabel>About us</SectionLabel>
          <h2 className="mt-4 text-[clamp(1.8rem,3.6vw,2.6rem)] font-bold leading-[1.1] tracking-[-0.02em] text-trust-navy">
            Built to get invoices out of your inbox and into your books.
          </h2>
          <p className="mt-5 text-[16px] leading-relaxed text-text-secondary">
            Scantrix was founded in 2025 on a simple observation: accounts payable teams
            were still typing invoices into QuickBooks by hand, one bill at a time. We
            built Scantrix to close that gap — reading invoices, matching vendors, and
            posting bills automatically, so people spend their time on judgment calls
            instead of data entry.
          </p>
          <span className="mt-6 inline-flex items-center gap-2 rounded-pill border border-border bg-white px-3 py-1.5 text-[12.5px] font-semibold text-trust-navy shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--lp-teal)]" aria-hidden />
            Founded in 2025
          </span>
        </Reveal>

        <div className="flex flex-col gap-4">
          {VALUES.map((v, i) => {
            const Icon = v.icon;
            return (
              <Reveal key={v.title} delay={i * 90}>
                <div className="flex gap-4 rounded-2xl border border-border bg-white p-5 shadow-sm">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[color:var(--lp-teal-050)] text-[color:var(--lp-teal-600)]">
                    <Icon size={20} strokeWidth={2} />
                  </span>
                  <div>
                    <h3 className="text-[15.5px] font-bold text-text-primary">{v.title}</h3>
                    <p className="mt-1 text-[14px] leading-relaxed text-text-secondary">{v.body}</p>
                  </div>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}

// --- Final CTA -------------------------------------------------------------

function FinalCta() {
  return (
    <section className="relative overflow-hidden" style={{ background: "linear-gradient(165deg, var(--lp-navy) 0%, var(--lp-navy-950) 100%)" }}>
      <div className="lp-dotgrid-light pointer-events-none absolute inset-0 opacity-60" aria-hidden />
      <div className="lp-glow pointer-events-none absolute left-1/2 top-0 h-72 w-72 -translate-x-1/2 rounded-full opacity-50" aria-hidden />
      <div className="relative mx-auto max-w-3xl px-5 py-24 text-center sm:px-8 sm:py-28">
        <Reveal>
          <span className="inline-flex items-center gap-2 rounded-pill border border-white/15 bg-white/5 px-3 py-1.5 text-[12.5px] font-semibold text-white/80">
            <ShieldCheck size={14} className="text-[color:var(--lp-teal)]" /> 14-day free trial · No credit card
          </span>
          <h2 className="mt-6 text-[clamp(2rem,4.6vw,3.2rem)] font-bold leading-[1.06] tracking-[-0.02em] text-white">
            Stop typing invoices into QuickBooks.
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[16.5px] leading-relaxed text-white/70">
            Let Scantrix read them, match the vendors, and post the bills — while you
            handle the handful that need a second look.
          </p>
          <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              href="/register"
              onClick={trackSignupClick}
              className="group inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-white px-7 text-[15px] font-semibold text-trust-navy shadow-lg transition-all hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--lp-teal)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--lp-navy)]"
            >
              Start free — 14 days
              <ArrowRight size={17} strokeWidth={2.25} className="transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/login"
              className="inline-flex h-12 items-center justify-center rounded-xl border border-white/20 px-7 text-[15px] font-semibold text-white transition-colors hover:bg-white/10"
            >
              Log in
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

// --- Footer ----------------------------------------------------------------

function Footer() {
  return (
    <footer className="border-t border-border bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <div className="max-w-xs">
          <Wordmark />
          <p className="mt-3 text-[13px] leading-relaxed text-text-secondary">
            AI-assisted invoice scanning, QuickBooks sync and team management for
            accountants and small businesses.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-[13.5px] font-medium text-text-secondary">
          <a href="#how" className="transition-colors hover:text-trust-navy">How it works</a>
          <a href="#capabilities" className="transition-colors hover:text-trust-navy">Capabilities</a>
          <a href="#pricing" className="transition-colors hover:text-trust-navy">Pricing</a>
          <a href="#about" className="transition-colors hover:text-trust-navy">About</a>
          <Link href="/login" className="transition-colors hover:text-trust-navy">Log in</Link>
          <Link href="/register" onClick={trackSignupClick} className="font-semibold text-trust-navy">Start free</Link>
        </div>
      </div>
      <div className="border-t border-border">
        <div className="mx-auto max-w-6xl px-5 py-5 text-[12.5px] text-text-secondary sm:px-8">
          © {new Date().getFullYear()} Scantrix. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

// --- Page ------------------------------------------------------------------

export function LandingPage() {
  // Smooth-scroll for the in-page anchor nav, scoped to the landing route only
  // (reset on unmount so the rest of the app keeps default scroll behavior),
  // and never applied when the visitor prefers reduced motion.
  useEffect(() => {
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;
    const root = document.documentElement;
    const previous = root.style.scrollBehavior;
    root.style.scrollBehavior = "smooth";
    return () => {
      root.style.scrollBehavior = previous;
    };
  }, []);

  return (
    <div id="top" className="lp-root min-h-screen">
      <LandingNav />
      <main>
        <Hero />
        <IntegrationStrip />
        <Problem />
        <HowItWorks />
        <EmailForwarding />
        <Capabilities />
        <Assistant />
        <ClaudeConnector />
        <DashboardShowcase />
        <Differentiation />
        <Pricing />
        <About />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
