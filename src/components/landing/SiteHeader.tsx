import { getLatestPostSummaries } from "@/lib/blog";
import { faqHref } from "@/lib/faq";

import { HeaderMenus } from "./HeaderMenus";
import { Sprite } from "./Sprite";

// The header used by every public page (/, /faq, /blog). This server half
// resolves what the client half cannot import without shipping the blog to the
// browser: the newest post for Resources → Latest, and the FAQ anchors. It also
// renders the SVG sprite that the header, page and footer draw from.
export function SiteHeader() {
  const [latest] = getLatestPostSummaries(1);
  return (
    <>
      <Sprite />
      <HeaderMenus
        links={{
          latest: latest ? { title: latest.title, href: latest.href } : null,
          faqAutoPost: faqHref("auto-post"),
          faqSoftware: faqHref("software"),
          faqSenders: faqHref("senders"),
        }}
      />
    </>
  );
}
