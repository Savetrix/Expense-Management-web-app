import Image from "next/image";

import { siClaude, siGoogledrive, siQuickbooks, siSage, siXero, siZoho } from "simple-icons";

// Licensed brand marks (CC0-1.0, simple-icons — built specifically for
// representing third-party brands/integrations, see DESIGN_ASSUMPTIONS.md
// D1.1). Each brand's own official mark color is used here deliberately,
// same as any "Connect to X" button showing X's real logo — this is not a
// repurposing of this app's locked --color-* tokens.
const BRANDS = {
  quickbooks: siQuickbooks,
  "google-drive": siGoogledrive,
  zoho: siZoho,
  sage: siSage,
  xero: siXero,
  claude: siClaude,
} as const;

// Brands with no simple-icons entry at all, rendered from the vendor's own
// published mark instead. public/brand/onedrive.svg is Microsoft's official
// OneDrive product icon from its Fluent UI brand-icons CDN
// (res-1.cdn.office.net/files/fabric-cdn-prod_20240129.001/assets/brand-icons/product/svg/onedrive_48x1.svg)
// — same "use the vendor's own logo file" approach as google-drive.png
// below. With no single-tone path to fall back to, `monochrome` has no
// effect on these.
const IMAGE_ONLY_BRANDS = {
  onedrive: { src: "/brand/onedrive.svg", title: "OneDrive" },
} as const;

type ImageOnlyBrandName = keyof typeof IMAGE_ONLY_BRANDS;
export type BrandName = keyof typeof BRANDS | ImageOnlyBrandName;

const isImageOnlyBrand = (name: BrandName): name is ImageOnlyBrandName => name in IMAGE_ONLY_BRANDS;

// simple-icons only ships a single-tone mark for Google Drive (Google's own
// monochrome guidance), not the recognizable green/yellow/blue triangle.
// public/brand/google-drive.png is Google's own official full-color logo PNG
// (gstatic CDN, https://developers.google.com/drive/web/branding — no
// pre-approval needed), used here instead of hand-tracing the multi-color
// mark ourselves. Raster can't take `currentColor`, so the `monochrome` path
// below still falls back to the simple-icons single-tone SVG.
const RASTER_BRANDS: Partial<Record<keyof typeof BRANDS, string>> = {
  "google-drive": "/brand/google-drive.png",
};

// Tally (Tally Solutions / TallyPrime) and FreshBooks both have no entry in
// simple-icons or any other legitimately-licensed brand-mark source found
// during D1.1 research (and re-checked when FreshBooks was added) — never
// scrape or hand-approximate a trademarked logo, so neither has a case here.
// Callers render them as a plain generic icon instead (see
// AccountingSoftwaresContent.tsx).
export function BrandIcon({
  name,
  size = 24,
  className,
  monochrome = false,
}: {
  name: BrandName;
  size?: number;
  className?: string;
  /** Renders with fill="currentColor" instead of the brand's own hex, so it
   * follows a surrounding text color (active/hover states, dark rails) the
   * way every other icon in a nav row already does. Reserve this for
   * chrome like a dark sidebar rail — anywhere the mark represents the
   * brand itself (a "Connect to X" button, a status card) should keep the
   * real brand color; see the note above on why that's deliberate. */
  monochrome?: boolean;
}) {
  if (isImageOnlyBrand(name)) {
    const brand = IMAGE_ONLY_BRANDS[name];
    return <Image src={brand.src} alt={brand.title} width={size} height={size} className={className} />;
  }
  const icon = BRANDS[name];
  const rasterSrc = RASTER_BRANDS[name];
  if (rasterSrc && !monochrome) {
    return (
      <Image src={rasterSrc} alt={icon.title} width={size} height={size} className={className} />
    );
  }
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill={monochrome ? "currentColor" : `#${icon.hex}`}
      className={className}
      role="img"
      aria-label={icon.title}
    >
      <path d={icon.path} />
    </svg>
  );
}
