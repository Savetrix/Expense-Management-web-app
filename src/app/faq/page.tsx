import type { Metadata } from "next";

import "@/components/landing/lp2.css";
import { LP2_FONTS } from "@/components/landing/fonts";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { faqAnchor } from "@/lib/faq";
import { SUPPORT_EMAIL } from "@/lib/legal";
import { FAQ_ITEMS, faqPageJsonLd, jsonLdScriptProps } from "@/lib/seo";

// Every FAQ answer, on one server-rendered page. The header's Resources menu,
// the footer and the mobile sheet link here and to individual answers
// (/faq#<anchor>, see src/lib/faq.ts). The FAQPage structured data is emitted
// here because Google requires the answers to be visible on the same page.
export const metadata: Metadata = {
  title: "FAQ · ScanTrix",
  description:
    "How ScanTrix posts supplier invoices to QuickBooks or Xero, who can send to your forwarding address, how forwarded files are checked, the free trial and team access.",
  alternates: { canonical: "/faq" },
};

export default function FaqPage() {
  return (
    <div className={`lp2 lp2-page ${LP2_FONTS}`}>
      <script {...jsonLdScriptProps(faqPageJsonLd)} />
      <SiteHeader />
      <main>
        <section className="sec faq">
          <div className="wrap">
            <div className="sec-top">
              <p className="eyebrow">FAQ</p>
              <h1 className="h2">
                Questions, answered<i className="pd">.</i>
              </h1>
            </div>
            <div className="faq-list">
              {FAQ_ITEMS.map((item) => (
                <article key={item.key} id={faqAnchor(item.question)} className="faq-item">
                  <h2 className="faq-q">{item.question}</h2>
                  <p className="faq-a">{item.answer}</p>
                </article>
              ))}
            </div>
            <p className="faq-support">
              Still have a question? Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
            </p>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
