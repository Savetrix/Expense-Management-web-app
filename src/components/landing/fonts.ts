import { DM_Mono, Instrument_Sans } from "next/font/google";

// The landing page's two typefaces, self-hosted by next/font. They are exposed
// only as CSS variables (lp2.css reads them) and applied only on the landing
// root and the header/footer wrappers, so the app and the blog prose keep Geist.

// Variable font: one file covers the design's 400–700.
const sans = Instrument_Sans({
  subsets: ["latin"],
  variable: "--lp2-font-sans",
  display: "swap",
});

const mono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--lp2-font-mono",
  display: "swap",
});

export const LP2_FONTS = `${sans.variable} ${mono.variable}`;
