import "./lp2.css";

import { ClosingCta } from "./ClosingCta";
import { ConfidenceFork } from "./ConfidenceFork";
import { LP2_FONTS } from "./fonts";
import { Hero } from "./Hero";
import { HowItWorks } from "./HowItWorks";
import { Integrations } from "./Integrations";
import { Pricing } from "./Pricing";
import { SiteFooter } from "./SiteFooter";
import { SiteHeader } from "./SiteHeader";

// The public homepage, ported from design-handoff/design/Main.dc.html.
// A Server Component tree: every looping animation is in the server HTML so
// they all start at first paint on the one shared 5.5s clock. Only the header
// menus, the Pause control and the "Talk to sales" buttons are client leaves.
// .lp2 scopes lp2.css; .lp2-page is the root the Pause control toggles
// .no-motion / .resumed on.
export function LandingPage() {
  return (
    <div className={`lp2 lp2-page ${LP2_FONTS}`}>
      <SiteHeader />
      <main>
        <Hero />
        <HowItWorks />
        <ConfidenceFork />
        <Integrations />
        <Pricing />
        <ClosingCta />
      </main>
      <SiteFooter />
    </div>
  );
}
