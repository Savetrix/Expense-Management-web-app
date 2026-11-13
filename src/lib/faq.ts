// Links into the /faq page. Server-only in practice: it pulls in the blog
// module for slugifyHeading, so client components receive the finished hrefs
// as props instead of importing this.

import { slugifyHeading } from "@/lib/blog";
import { FAQ_ITEMS } from "@/lib/seo";

/** Fragment id of one FAQ item on /faq, derived from its question. */
export function faqAnchor(question: string): string {
  return slugifyHeading(question);
}

/** "/faq#<anchor>" for the item with this key. Throws at build time if the key is gone. */
export function faqHref(key: string): string {
  const item = FAQ_ITEMS.find((entry) => entry.key === key);
  if (!item) throw new Error(`No FAQ item with key "${key}" in FAQ_ITEMS (src/lib/seo.ts).`);
  return `/faq#${faqAnchor(item.question)}`;
}
