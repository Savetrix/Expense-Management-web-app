import "@/components/landing/lp2.css";
import { LP2_FONTS } from "@/components/landing/fonts";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { SiteHeader } from "@/components/landing/SiteHeader";

// Same shell as /blog: marketing, not product, so it sits outside the (app)
// route group and renders to plain server HTML. `lp-root` scopes the design
// tokens to this subtree; header and footer are the homepage's, each in its own
// `.lp2 lp2-chrome` wrapper (see blog/layout.tsx).
export default function EbooksLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="lp-root lp-blog flex min-h-screen flex-col">
      <div className={`lp2 lp2-chrome ${LP2_FONTS}`}>
        <SiteHeader />
      </div>
      <main className="flex-1">{children}</main>
      <div className={`lp2 lp2-chrome ${LP2_FONTS}`}>
        <SiteFooter />
      </div>
    </div>
  );
}
