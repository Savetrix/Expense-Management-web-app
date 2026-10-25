// The four Product-menu previews. Each mounts only while its item is
// previewed, so its short loop starts from the top when the menu opens —
// the one deliberate exception to the page's shared clock (SPEC §3).

export function CapturePreview() {
  return (
    <div className="pv">
      <div className="pv-box">
        {" "}
        <div className="pvc-doc">
          {" "}
          <i style={{ top: "16px", width: "52px", height: "6px", background: "#C9D8D3" }} />
          {" "}
          <i style={{ top: "30px", width: "36px" }} />
          {" "}
          <i style={{ top: "54px", width: "76px" }} />
          {" "}
          <i style={{ top: "66px", width: "64px" }} />
          {" "}
          <i style={{ top: "78px", width: "70px" }} />
          {" "}
          <i style={{ top: "104px", left: "auto", right: "12px", width: "30px", height: "6px", background: "#C9D8D3" }} />
          {" "}
          <i style={{ top: "128px", width: "56px", height: "3px" }} />
          {" "}
          <span className="pvc-scan" />
          {" "}
        </div>
        {" "}
        <span className="pvc-f pvc-f1">
          Vendor
          <b>Northwind</b>
        </span>
        {" "}
        <span className="pvc-f pvc-f2">
          Total
          <b>$783.50</b>
        </span>
        {" "}
        <span className="pvc-f pvc-f3">
          <i />
          Posted
        </span>
        {" "}
      </div>
    </div>
  );
}

export function EmailPreview() {
  return (
    <div className="pv">
      <div className="pv-box">
        {" "}
        <div className="pve-mail">
          {" "}
          <span className="pve-to">
            To
            {" "}
            <b>acme-7k2m9x@invoice.scantrix.ai</b>
          </span>
          {" "}
          <span className="pve-sub">Fwd: Invoice INV-20418</span>
          {" "}
          <span className="pve-att">
            <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
              <path d="M14 3v5h5" />
            </svg>
            northwind-july.pdf
          </span>
          {" "}
        </div>
        {" "}
        <span className="pve-ck pve-c1">
          <i />
          Approved sender
        </span>
        {" "}
        <span className="pve-ck pve-c2">
          <i />
          SPF, DKIM and DMARC passed
        </span>
        {" "}
        <span className="pve-ck pve-c3">
          <i />
          In your ScanTrix inbox
        </span>
        {" "}
      </div>
    </div>
  );
}

export function ClaudePreview() {
  return (
    <div className="pv">
      <div className="pv-box pvl">
        {" "}
        <span className="pvl-in">
          <svg width={16} height={16}>
            <use href="#lg-claude" />
          </svg>
          <span className="pvl-q">Which invoices failed to post?</span>
          <span className="pvl-caret" />
        </span>
        {" "}
        <span className="pvl-r pvl-r1">
          <i />
          2 invoices · currency mismatch
        </span>
        {" "}
        <span className="pvl-r pvl-r2">
          <i />
          1 invoice · reconnect needed
        </span>
        {" "}
      </div>
    </div>
  );
}

export function MobilePreview() {
  return (
    <div className="pv">
      <div className="pv-box">
        {" "}
        <div className="pvm-phone">
          <div className="pvm-scr">
            {" "}
            <div className="pvm-doc">
              <i style={{ top: "10px", width: "40%" }} />
              <i style={{ top: "22px", width: "28%" }} />
              <i style={{ top: "40px", width: "70%" }} />
              <i style={{ top: "50px", width: "62%" }} />
              <i style={{ top: "60px", width: "66%" }} />
              <i style={{ top: "76px", left: "auto", right: "8px", width: "30%" }} />
            </div>
            {" "}
            <span className="pvm-vf" />
            {" "}
            <span className="pvm-toast">
              <i />
              Uploaded
            </span>
            {" "}
            <span className="pvm-shutter" />
            {" "}
            <span className="pvm-flash" />
            {" "}
          </div>
        </div>
        {" "}
      </div>
    </div>
  );
}
