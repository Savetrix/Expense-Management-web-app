import Image from "next/image";
import Link from "next/link";

import { faqHref } from "@/lib/faq";
import { PRIVACY_URL, TERMS_URL } from "@/lib/legal";

import { APP_STORE_URL } from "./links";

// The footer used by every public page (/, /faq, /blog). Section links are
// root-relative ("/#how") so they work from /blog too. Help center points at
// the FAQ until a help center exists. The legal documents are the same PDFs
// the app's profile screen opens.
export function SiteFooter() {
  return (
    <footer className="ftr">
      {" "}
      <div className="wrap">
        {" "}
        <div className="ftr-top">
          {" "}
          <Link className="brand" href="/" aria-label="ScanTrix home">
            <Image src="/scantrix-icon.png" alt="" width={30} height={30} />
            <span>ScanTrix</span>
          </Link>
          {" "}
          <nav className="ftr-links" aria-label="Footer">
            {" "}
            <Link href="/#how">Capture</Link>
            <Link href="/#email">Email forwarding</Link>
            <Link href="/register">Claude connector</Link>
            <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">
              Mobile app<span className="sr"> (opens the App Store)</span>
            </a>
            <Link href="/#pricing">Pricing</Link>
            <Link href="/blog">Blog</Link>
            <Link href="/faq">FAQ</Link>
            <Link href="/faq">Help center</Link>
            <Link href={faqHref("security")}>Security</Link>
            <Link href="/login">Log in</Link>
            {" "}
          </nav>
          {" "}
        </div>
        {" "}
        <div className="ftr-bot">
          {" "}
          <span>© {new Date().getFullYear()} ScanTrix</span>
          {" "}
          <span>QuickBooks, Xero, Google Drive and OneDrive are trademarks of their owners.</span>
          {" "}
          <span className="ftr-legal">
            <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer">
              Privacy
            </a>
            <a href={TERMS_URL} target="_blank" rel="noopener noreferrer">
              Terms
            </a>
          </span>
          {" "}
        </div>
        {" "}
      </div>
      {" "}
    </footer>
  );
}
