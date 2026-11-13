"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, type FocusEvent, type KeyboardEvent } from "react";

import { CapturePreview, ClaudePreview, EmailPreview, MobilePreview } from "./HeaderPreviews";
import { APP_STORE_URL } from "./links";
import { trackSignupClick } from "./pixel";

// The site header: Product and Resources dropdowns, the mobile sheet and the
// click-away scrim. One client component because all four share one piece of
// state: one scrim serves both a pinned menu and the sheet, opening one menu
// closes the other, and Escape is handled once for the whole header.
// Behaviour follows the design's DCLogic and design-handoff/SPEC.md §4:
// - hover opens a menu and leaving closes it; a click pins it open and a second
//   click closes it;
// - Escape closes it and returns focus to its button; focus leaving closes it;
//   the scrim (only while pinned) closes it on a click outside;
// - the burger toggles the sheet below 1060px; Escape, a link or the scrim
//   closes it.
// Nav anchors are root-relative ("/#how") so they work from /blog too.

export interface HeaderLinks {
  /** Newest blog post, read at build time by SiteHeader. */
  latest: { title: string; href: string } | null;
  faqAutoPost: string;
  faqSoftware: string;
  faqSenders: string;
}

type Menu = "product" | "resources";
type Preview = "capture" | "email" | "claude" | "mobile";

interface MenuState {
  open: Menu | null;
  pinned: boolean;
  pv: Preview;
  mobile: boolean;
}

function PbtnArrows({ size }: { size: number }) {
  return (
    <span className="pbtn-c" aria-hidden="true">
      <svg className="a1" width={size} height={size}>
        <use href="#ic-arrow" />
      </svg>
      <svg className="a2" width={size} height={size}>
        <use href="#ic-arrow" />
      </svg>
    </span>
  );
}

function Arrow({ size, id = "ic-arrow" }: { size: number; id?: string }) {
  return (
    <svg width={size} height={size} aria-hidden="true">
      <use href={`#${id}`} />
    </svg>
  );
}

export function HeaderMenus({ links }: { links: HeaderLinks }) {
  const [st, setSt] = useState<MenuState>({ open: null, pinned: false, pv: "capture", mobile: false });

  const close = () => setSt((s) => ({ ...s, open: null, pinned: false }));
  const closeAll = () => setSt((s) => ({ ...s, open: null, pinned: false, mobile: false }));
  const closeMobile = () => setSt((s) => ({ ...s, mobile: false }));
  const enter = (m: Menu) => () => setSt((s) => (s.open !== m ? { ...s, open: m, pinned: false } : s));
  const leave = (m: Menu) => () => setSt((s) => (s.open === m && !s.pinned ? { ...s, open: null, pinned: false } : s));
  const click = (m: Menu) => () =>
    setSt((s) => (s.open === m && s.pinned ? { ...s, open: null, pinned: false } : { ...s, open: m, pinned: true }));
  const preview = (k: Preview) => () => setSt((s) => (s.pv !== k ? { ...s, pv: k } : s));

  const menuKeys = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape") return;
    const button = e.currentTarget.querySelector("button");
    close();
    button?.focus();
  };
  const menuBlur = (e: FocusEvent<HTMLDivElement>) => {
    const next = e.relatedTarget as Node | null;
    if (!next || e.currentTarget.contains(next)) return;
    setSt((s) => (s.open ? { ...s, open: null, pinned: false } : s));
  };
  const sheetKeys = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || !st.mobile) return;
    const burger = e.currentTarget.querySelector<HTMLElement>(".burger");
    closeMobile();
    burger?.focus();
  };
  const hdrBlur = (e: FocusEvent<HTMLElement>) => {
    const next = e.relatedTarget as Node | null;
    if (st.mobile && next && !e.currentTarget.contains(next)) closeMobile();
  };

  const productOpen = st.open === "product";
  const productBtn = productOpen ? "is-open" : "";
  const resourcesBtn = st.open === "resources" ? "is-open" : "";
  const on = (k: Preview) => (st.pv === k ? "is-on" : "");
  const scrimOn = (st.open !== null && st.pinned) || st.mobile;

  return (
    <>
      <header className={`hdr ${st.mobile ? "m-open" : ""}`} onKeyDown={sheetKeys} onBlur={hdrBlur}>
        {" "}
        <div className="wrap hdr-in">
          {" "}
          <Link className="brand" href="/" aria-label="ScanTrix home">
            <Image src="/scantrix-icon.png" alt="" width={30} height={30} loading="eager" />
            <span>ScanTrix</span>
          </Link>
          {" "}
          <nav className="nav" aria-label="Main">
            {" "}
            <div
              className="ni"
              onMouseEnter={enter("product")}
              onMouseLeave={leave("product")}
              onKeyDown={menuKeys}
              onBlur={menuBlur}
            >
              {" "}
              <button
                type="button"
                className={`nl ${productBtn}`}
                aria-expanded={productOpen}
                aria-controls="m-product"
                onClick={click("product")}
              >
                <span className="nl-t">Product</span>
                <svg className="chev" width={12} height={12} aria-hidden="true">
                  <use href="#ic-chev" />
                </svg>
              </button>
              {" "}
              <div className={`mp ${productBtn}`} id="m-product">
                {" "}
                <div className="panel panel-product">
                  {" "}
                  <div className="pp-list">
                    {" "}
                    <Link
                      className={`pp-item st st1 ${on("capture")}`}
                      href="/#how"
                      onMouseEnter={preview("capture")}
                      onFocus={preview("capture")}
                      onClick={closeAll}
                    >
                      {" "}
                      <span className="pp-ico" aria-hidden="true">
                        <svg
                          width={20}
                          height={20}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.9"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                          <path d="M14 3v5h5" />
                          <path d="M3 13h18" />
                        </svg>
                      </span>
                      {" "}
                      <span className="pp-tx">
                        <span className="pp-t">Capture</span>
                        <span className="pp-d">Invoices in, bills posted</span>
                      </span>
                      {" "}
                      <span className="pp-go" aria-hidden="true">
                        <svg width={16} height={16}>
                          <use href="#ic-arrow" />
                        </svg>
                      </span>
                      {" "}
                    </Link>
                    {" "}
                    <Link
                      className={`pp-item st st2 ${on("email")}`}
                      href="/#email"
                      onMouseEnter={preview("email")}
                      onFocus={preview("email")}
                      onClick={closeAll}
                    >
                      {" "}
                      <span className="pp-ico" aria-hidden="true">
                        <svg width={20} height={20}>
                          <use href="#ic-mail" />
                        </svg>
                      </span>
                      {" "}
                      <span className="pp-tx">
                        <span className="pp-t">Email forwarding</span>
                        <span className="pp-d">Forward invoices to your company’s address</span>
                      </span>
                      {" "}
                      <span className="pp-go" aria-hidden="true">
                        <svg width={16} height={16}>
                          <use href="#ic-arrow" />
                        </svg>
                      </span>
                      {" "}
                    </Link>
                    {" "}
                    {/* No connector page or waitlist exists yet; sign-up is the
                        agreed interim destination. */}
                    <Link
                      className={`pp-item st st3 ${on("claude")}`}
                      href="/register"
                      onMouseEnter={preview("claude")}
                      onFocus={preview("claude")}
                      onClick={closeAll}
                    >
                      {" "}
                      <span className="pp-ico" aria-hidden="true">
                        <svg width={18} height={18}>
                          <use href="#lg-claude" />
                        </svg>
                      </span>
                      {" "}
                      <span className="pp-tx">
                        <span className="pp-t">
                          Claude connector <span className="tag">Early access</span>
                        </span>
                        <span className="pp-d">Your invoices and vendors, inside Claude</span>
                      </span>
                      {" "}
                      <span className="pp-go" aria-hidden="true">
                        <svg width={16} height={16}>
                          <use href="#ic-arrow" />
                        </svg>
                      </span>
                      {" "}
                    </Link>
                    {" "}
                    <a
                      className={`pp-item st st4 ${on("mobile")}`}
                      href={APP_STORE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      onMouseEnter={preview("mobile")}
                      onFocus={preview("mobile")}
                      onClick={closeAll}
                    >
                      {" "}
                      <span className="pp-ico" aria-hidden="true">
                        <svg width={20} height={20}>
                          <use href="#ic-phone" />
                        </svg>
                      </span>
                      {" "}
                      <span className="pp-tx">
                        <span className="pp-t">Mobile app</span>
                        <span className="pp-d">Snap paper invoices on iOS and Android</span>
                      </span>
                      <span className="sr"> (opens the App Store)</span>
                      {" "}
                      <span className="pp-go" aria-hidden="true">
                        <svg width={16} height={16}>
                          <use href="#ic-ext" />
                        </svg>
                      </span>
                      {" "}
                    </a>
                    {" "}
                  </div>
                  {" "}
                  <div className="pp-stage st st2" aria-hidden="true">
                    {" "}
                    {productOpen && st.pv === "capture" && <CapturePreview />}
                    {" "}
                    {productOpen && st.pv === "email" && <EmailPreview />}
                    {" "}
                    {productOpen && st.pv === "claude" && <ClaudePreview />}
                    {" "}
                    {productOpen && st.pv === "mobile" && <MobilePreview />}
                    {" "}
                  </div>
                  {" "}
                  <div className="pp-foot st st5">
                    {" "}
                    <span>Connected to</span>
                    {" "}
                    <span className="pp-logos">
                      {" "}
                      <span>
                        <svg width={16} height={16} aria-hidden="true">
                          <use href="#lg-qb" />
                        </svg>
                        QuickBooks
                      </span>
                      {" "}
                      <span>
                        <svg width={16} height={16} aria-hidden="true">
                          <use href="#lg-xero" />
                        </svg>
                        Xero
                      </span>
                      {" "}
                      <span>
                        <Image src="/brand/google-drive.png" alt="" width={15} height={15} />
                        Google Drive
                      </span>
                      {" "}
                      <span>
                        <svg width={18} height={18} aria-hidden="true">
                          <use href="#lg-od" />
                        </svg>
                        OneDrive
                      </span>
                      {" "}
                    </span>
                    {" "}
                  </div>
                  {" "}
                </div>
                {" "}
              </div>
              {" "}
            </div>
            {" "}
            <Link className="nl" href="/#how">
              <span className="nl-t">How it works</span>
            </Link>
            {" "}
            <Link className="nl" href="/#integrations">
              <span className="nl-t">Integrations</span>
            </Link>
            {" "}
            <Link className="nl" href="/#pricing">
              <span className="nl-t">Pricing</span>
            </Link>
            {" "}
            <div
              className="ni ni-r"
              onMouseEnter={enter("resources")}
              onMouseLeave={leave("resources")}
              onKeyDown={menuKeys}
              onBlur={menuBlur}
            >
              {" "}
              <button
                type="button"
                className={`nl ${resourcesBtn}`}
                aria-expanded={st.open === "resources"}
                aria-controls="m-resources"
                onClick={click("resources")}
              >
                <span className="nl-t">Resources</span>
                <svg className="chev" width={12} height={12} aria-hidden="true">
                  <use href="#ic-chev" />
                </svg>
              </button>
              {" "}
              <div className={`mp mp-r ${resourcesBtn}`} id="m-resources">
                {" "}
                <div className="panel panel-res">
                  {" "}
                  <div className="pr-cols">
                    {" "}
                    <div className="st st1">
                      {" "}
                      <p className="pr-h">Read</p>
                      {" "}
                      <Link className="pr-a" href="/blog" onClick={closeAll}>
                        <span className="pr-a-t">
                          Blog <Arrow size={14} />
                        </span>
                        <span className="pr-a-d">Guides on bills, AP and month-end</span>
                      </Link>
                      {" "}
                      <Link className="pr-a" href="/ebooks" onClick={closeAll}>
                        <span className="pr-a-t">
                          E-books <Arrow size={14} />
                        </span>
                        <span className="pr-a-d">In-depth guides to download</span>
                      </Link>
                      {" "}
                    </div>
                    {" "}
                    <div className="st st2">
                      {" "}
                      <p className="pr-h">Questions</p>
                      {" "}
                      <Link className="pr-q" href={links.faqAutoPost} onClick={closeAll}>
                        Does it post bills automatically?
                        <Arrow size={14} />
                      </Link>
                      {" "}
                      <Link className="pr-q" href={links.faqSoftware} onClick={closeAll}>
                        Which accounting software does it work with?
                        <Arrow size={14} />
                      </Link>
                      {" "}
                      <Link className="pr-q" href={links.faqSenders} onClick={closeAll}>
                        Who can send invoices to my ScanTrix address?
                        <Arrow size={14} />
                      </Link>
                      {" "}
                      <Link className="pr-more" href="/faq" onClick={closeAll}>
                        All FAQs <Arrow size={14} />
                      </Link>
                      {" "}
                    </div>
                    {" "}
                  </div>
                  {" "}
                  {links.latest && (
                    <Link className="pr-latest st st3" href={links.latest.href} onClick={closeAll}>
                      <span className="pr-latest-k">Latest</span>
                      <span className="pr-latest-t">{links.latest.title}</span>
                      <Arrow size={16} />
                    </Link>
                  )}
                  {" "}
                </div>
                {" "}
              </div>
              {" "}
            </div>
            {" "}
          </nav>
          {" "}
          <div className="acts">
            {" "}
            <Link className="login" href="/login">
              Log in
            </Link>
            {" "}
            <Link className="pbtn pbtn-sm" href="/register" onClick={trackSignupClick}>
              <span>Start free</span>
              <PbtnArrows size={15} />
            </Link>
            {" "}
            <button
              type="button"
              className={`burger ${st.mobile ? "is-open" : ""}`}
              aria-expanded={st.mobile}
              aria-controls="m-sheet"
              aria-label={st.mobile ? "Close menu" : "Open menu"}
              onClick={() => setSt((s) => ({ ...s, mobile: !s.mobile }))}
            >
              <span className="burger-l" aria-hidden="true" />
            </button>
            {" "}
          </div>
          {" "}
        </div>
        {" "}
        {st.mobile && (
          <div className="msheet" id="m-sheet">
            {" "}
            <p className="ms-k st">Product</p>
            {" "}
            <div className="ms-sub st">
              <Link href="/#how" onClick={closeMobile}>
                Capture
              </Link>
              <Link href="/#email" onClick={closeMobile}>
                Email forwarding
              </Link>
              <Link href="/register" onClick={closeMobile}>
                Claude connector
              </Link>
              <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" onClick={closeMobile}>
                Mobile app<span className="sr"> (opens the App Store)</span>
              </a>
            </div>
            {" "}
            <Link className="ms-l st st2" href="/#how" onClick={closeMobile}>
              How it works <Arrow size={20} />
            </Link>
            {" "}
            <Link className="ms-l st st3" href="/#integrations" onClick={closeMobile}>
              Integrations <Arrow size={20} />
            </Link>
            {" "}
            <Link className="ms-l st st4" href="/#pricing" onClick={closeMobile}>
              Pricing <Arrow size={20} />
            </Link>
            {" "}
            <p className="ms-k st st4">Resources</p>
            {" "}
            <div className="ms-sub st st5">
              <Link href="/blog" onClick={closeMobile}>
                Blog
              </Link>
              <Link href="/ebooks" onClick={closeMobile}>
                E-books
              </Link>
              <Link href="/faq" onClick={closeMobile}>
                FAQ
              </Link>
            </div>
            {" "}
            <div className="ms-cta st st5">
              {" "}
              <Link
                className="pbtn"
                href="/register"
                onClick={() => {
                  trackSignupClick();
                  closeMobile();
                }}
              >
                <span>Start free trial</span>
                <PbtnArrows size={16} />
              </Link>
              {" "}
              <Link className="gbtn" href="/login" onClick={closeMobile}>
                Log in
              </Link>
              {" "}
            </div>
            {" "}
          </div>
        )}
        {" "}
      </header>
      {" "}
      {scrimOn && (
        <button
          type="button"
          className={`scrim ${st.mobile ? "scrim-m" : ""}`}
          tabIndex={-1}
          aria-hidden="true"
          onClick={closeAll}
        />
      )}
    </>
  );
}
