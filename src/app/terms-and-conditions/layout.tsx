import "@/components/landing/lp2.css";
import { LP2_FONTS } from "@/components/landing/fonts";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { SiteHeader } from "@/components/landing/SiteHeader";

// Public marketing-style page, outside the (app) route group like "/" and the
// blog: server-rendered, no Providers, no AuthGate. Header and footer are the
// homepage's, each in its own `.lp2 lp2-chrome` wrapper (see blog/layout.tsx).
export default function TermsAndConditionsLayout({ children }: { children: React.ReactNode }) {
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
