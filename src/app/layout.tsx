import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { SITE_NAME, SITE_URL } from "@/lib/seo";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

// Geist Mono moved to src/app/(app)/layout.tsx — it is only rendered inside the
// signed-in product, and declaring it here made every marketing visitor
// preload a font file the page never uses.

export const metadata: Metadata = {
  // Required before any metadata field may use a relative path. Without it the
  // canonical and og:url below would have to be absolute strings, and a build
  // error is raised for relative ones.
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Scantrix — Invoice & Expense Management",
    // Page titles supply their own " — Scantrix" today, so no template suffix
    // is applied here; adding one would double the brand on every route.
    template: "%s",
  },
  description:
    "AI-assisted invoice scanning, QuickBooks sync, and team management for accountants and small businesses.",
  applicationName: SITE_NAME,
  // No default canonical here on purpose. A canonical inherited by every route
  // would have pointed each noindex app page at "/", which reads as "this page
  // is really the homepage" — contradictory, and wrong. Indexable pages declare
  // their own; see src/app/page.tsx.
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    locale: "en_US",
    url: SITE_URL,
  },
  twitter: { card: "summary_large_image" },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
};

export const viewport: Viewport = {
  // --color-primary, the teal in public/scantrix-icon.png and the landing
  // page's --lp-teal token (src/app/globals.css).
  themeColor: "#1fb6aa",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Meta Pixel — base code, fires PageView on every route */}
        <Script id="meta-pixel" strategy="afterInteractive">
          {`
            !function(f,b,e,v,n,t,s)
            {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
            n.callMethod.apply(n,arguments):n.queue.push(arguments)};
            if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
            n.queue=[];t=b.createElement(e);t.async=!0;
            t.src=v;s=b.getElementsByTagName(e)[0];
            s.parentNode.insertBefore(t,s)}(window, document,'script',
            'https://connect.facebook.net/en_US/fbevents.js');
            fbq('init', '1368149188846081');
            fbq('track', 'PageView');
          `}
        </Script>
        <noscript>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            height="1"
            width="1"
            style={{ display: "none" }}
            src="https://www.facebook.com/tr?id=1368149188846081&ev=PageView&noscript=1"
            alt=""
          />
        </noscript>
      </head>
      {/* suppressHydrationWarning here only ignores attribute-level mismatches
          on this one tag (e.g. browser extensions like Grammarly injecting
          data-gr-ext-installed/data-new-gr-c-s-check-loaded before React
          hydrates) — it does not suppress hydration mismatches anywhere else
          in the tree. See https://react.dev/link/hydration-mismatch. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {/* Providers > AuthGate used to wrap this slot. They now live in
            src/app/(app)/layout.tsx (and are re-applied by ./not-found.tsx),
            so the marketing route at "/" renders to real HTML on the server
            instead of an empty shell. */}
        {children}
      </body>
    </html>
  );
}
