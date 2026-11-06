// The client's own invoice-scanning demo in the hero (.stx-demo, stx-*).
// Ported as written from design-handoff/design/Main.dc.html, not from the old
// mockups. Its loops run on the page's shared 5.5s clock, so it must stay in
// the server HTML: mounting it after hydration would put it out of step.

export function ClientDemo() {
  return (
    <div className="demo-wrap">
      {" "}
      <div className="stx-demo" role="img" aria-label="ScanTrix reads an invoice from Northwind Supplies, fills in five fields and posts the bill to QuickBooks or Xero">
        {" "}
        <div className="stx-frame">
          {" "}
          <div className="stx-bar">
            {" "}
            <span className="stx-dots">
              <i style={{ background: "#EF6A5F" }} />
              <i style={{ background: "#F5BD4F" }} />
              <i style={{ background: "#61C454" }} />
            </span>
            {" "}
            <span className="stx-url">
              <i className="stx-url-dot" />
              app.scantrix.ai/invoices/review
            </span>
            {" "}
          </div>
          {" "}
          <div className="stx-body">
            {" "}
            <div className="stx-invoice">
              {" "}
              <div className="stx-scanline" aria-hidden="true" />
              {" "}
              <div className="stx-inv-head">
                {" "}
                <span className="stx-inv-title">INVOICE</span>
                {" "}
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#888780" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
                  <path d="M14 2v4a2 2 0 0 0 2 2h4" />
                  <path d="M10 9H8" />
                  <path d="M16 13H8" />
                  <path d="M16 17H8" />
                </svg>
                {" "}
              </div>
              {" "}
              <div className="stx-vendor">Northwind Supplies Co.</div>
              {" "}
              <div className="stx-meta">Invoice #INV-20418 · Jul 22, 2026</div>
              {" "}
              <div className="stx-rule" />
              {" "}
              <div className="stx-lines">
                {" "}
                <div>
                  <span>Paper stock, A4</span>
                  <b>$420.00</b>
                </div>
                {" "}
                <div>
                  <span>Toner cartridges</span>
                  <b>$318.50</b>
                </div>
                {" "}
                <div>
                  <span>Delivery</span>
                  <b>$45.00</b>
                </div>
                {" "}
              </div>
              {" "}
              <div className="stx-total">
                <span>Total</span>
                <b>$783.50</b>
              </div>
              {" "}
            </div>
            {" "}
            <div className="stx-right">
              {" "}
              <div className="stx-extracted">
                {" "}
                <span className="stx-pulse-wrap">
                  <span className="stx-pulse" />
                </span>
                {" "}
                <span>Extracted by ScanTrix</span>
                {" "}
              </div>
              {" "}
              <div className="stx-fields">
                {" "}
                <div className="stx-field" style={{ animationDelay: "200ms" }}>
                  <span>Vendor</span>
                  <span>
                    <b>Northwind Supplies</b>
                    <i className="stx-check" />
                  </span>
                </div>
                {" "}
                <div className="stx-field" style={{ animationDelay: "520ms" }}>
                  <span>Invoice #</span>
                  <span>
                    <b>INV-20418</b>
                    <i className="stx-check" />
                  </span>
                </div>
                {" "}
                <div className="stx-field" style={{ animationDelay: "840ms" }}>
                  <span>Date</span>
                  <span>
                    <b>Jul 22, 2026</b>
                    <i className="stx-check" />
                  </span>
                </div>
                {" "}
                <div className="stx-field" style={{ animationDelay: "1160ms" }}>
                  <span>Total</span>
                  <span>
                    <b>$783.50</b>
                    <i className="stx-check" />
                  </span>
                </div>
                {" "}
                <div className="stx-field" style={{ animationDelay: "1480ms" }}>
                  <span>Currency</span>
                  <span>
                    <b>USD</b>
                    <i className="stx-check" />
                  </span>
                </div>
                {" "}
              </div>
              {" "}
              <div className="stx-status">
                {" "}
                <div className="stx-processing">
                  {" "}
                  <span className="stx-spinner" aria-hidden="true" />
                  {" "}
                  <span>Processing invoice…</span>
                  {" "}
                </div>
                {" "}
                <div className="stx-posted alt-qb">
                  {" "}
                  <span className="stx-posted-left">
                    <i className="stx-check stx-check-lg" />
                    <span>Auto-posted to QuickBooks</span>
                  </span>
                  {" "}
                  <svg width={18} height={18} viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="12" fill="#2CA01C" />
                    <path fill="#fff" d="M12.642 4.1335c.9554 0 1.7296.776 1.7296 1.7332v9.0667h1.6c1.614 0 2.9275-1.3156 2.9275-2.933 0-1.6173-1.3136-2.9333-2.9276-2.9333h-.6654V7.3334h.6654c2.5722 0 4.6577 2.0897 4.6577 4.667 0 2.5774-2.0855 4.6666-4.6577 4.6666H12.642zM7.9837 7.333h3.3291v12.533c-.9555 0-1.73-.7759-1.73-1.7332V9.0662H7.9837c-1.6146 0-2.9277 1.316-2.9277 2.9334 0 1.6175 1.3131 2.9333 2.9277 2.9333h.6654v1.7332h-.6654c-2.5725 0-4.6577-2.0892-4.6577-4.6665 0-2.5771 2.0852-4.6666 4.6577-4.6666Z">
                    </path>
                  </svg>
                  {" "}
                </div>
                {" "}
                <div className="stx-posted alt-xero">
                  {" "}
                  <span className="stx-posted-left">
                    <i className="stx-check stx-check-lg" />
                    <span>Auto-posted to Xero</span>
                  </span>
                  {" "}
                  <svg width={18} height={18} aria-hidden="true">
                    <use href="#lg-xero" />
                  </svg>
                  {" "}
                </div>
                {" "}
              </div>
              {" "}
            </div>
            {" "}
          </div>
          {" "}
        </div>
        {" "}
      </div>
      {" "}
    </div>
  );
}
