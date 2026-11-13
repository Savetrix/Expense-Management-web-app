import Image from "next/image";
import Link from "next/link";


import { APP_STORE_URL } from "./links";

// The footer used by every public page (/, /faq, /blog). Section links are
// root-relative ("/#how") so they work from /blog too. Privacy and Terms are
// the site's own pages.
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
            <Link href="/ebooks">E-books</Link>
            <Link href="/faq">FAQ</Link>
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
            <Link href="/privacy-policy">Privacy</Link>
            <Link href="/terms-and-conditions">Terms</Link>
          </span>
          {" "}
        </div>
        {" "}
      </div>
      {" "}
    </footer>
  );
}
