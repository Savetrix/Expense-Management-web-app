import { ImageResponse } from "next/og";

// Generated at build time rather than committed as a binary, so the card can
// never drift from the positioning on the page. Applies to "/" and is
// inherited by the routes below it, which is what makes a pasted app link
// render as a Scantrix card instead of a bare URL.
//
// Rendered by satori: only a small CSS subset is supported, every element with
// more than one child needs an explicit `display: flex`, and no webfont is
// fetched (the system stack keeps the build offline-safe).

export const alt =
  "Scantrix — invoices read, vendors matched, and bills posted to QuickBooks Online automatically";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const NAVY = "#1f3a5f";
const NAVY_DEEP = "#132741";
const TEAL = "#1fb6aa";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: `linear-gradient(165deg, ${NAVY} 0%, ${NAVY_DEEP} 100%)`,
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              background: TEAL,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          />
          <div style={{ fontSize: 34, fontWeight: 700, color: "#ffffff" }}>
            Scantrix
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 68,
              fontWeight: 700,
              lineHeight: 1.08,
              letterSpacing: "-0.025em",
              color: "#ffffff",
              maxWidth: 940,
              display: "flex",
            }}
          >
            Your invoices, posted to QuickBooks automatically.
          </div>
          <div
            style={{
              marginTop: 28,
              fontSize: 29,
              lineHeight: 1.4,
              color: "rgba(255,255,255,0.72)",
              maxWidth: 900,
              display: "flex",
            }}
          >
            Scantrix reads every invoice, matches the vendor, and posts the bill
            — you review only the exceptions.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: 5,
              background: TEAL,
              display: "flex",
            }}
          />
          <div style={{ fontSize: 24, color: "rgba(255,255,255,0.6)" }}>
            Built for QuickBooks Online · 14-day free trial
          </div>
        </div>
      </div>
    ),
    size,
  );
}
