import Image from "next/image";

// Section 4: the dark integrations band.
export function Integrations() {
  return (
    <section className="intg" id="integrations">
      {" "}
      <div className="wrap">
        {" "}
        <div className="sec-top">
          {" "}
          <p className="eyebrow">Integrations</p>
          {" "}
          <h2 className="h2">
            <span className="s">
              Posted to your ledger
              <i className="pd">.</i>
            </span>
            {" "}
            <span className="s">
              Filed in your drive
              <i className="pd">.</i>
            </span>
          </h2>
          {" "}
          <p className="intg-sub">
            QuickBooks Online and Xero get the bill. Google Drive and OneDrive keep the original. Each connected company gets its own forwarding address.
          </p>
          {" "}
        </div>
        {" "}
        <div className="lanes m-alt" aria-hidden="true">
          {" "}
          <div className="lanes-in">
            {" "}
            <span className="lane-lab li-lab">Email · Upload · Mobile</span>
            {" "}
            <span className="li-base" />
            <span className="li-fill" />
            <span className="li-trk">
              <i />
            </span>
            {" "}
          </div>
          {" "}
          <div className="lanes-core">
            {" "}
            <svg className="lanes-svg" width={760} height={440} viewBox="0 0 760 440">
              <path className="ln-p" d="M20 220 L92 148 Q100 140 111.31 140 L420 140" />
              <path className="ln-p" d="M288.69 140 Q300 140 308 132 L372 68 Q380 60 391.31 60 L420 60" />
              <path className="ln-n" d="M30 220 L420 220" />
              <path className="ln-p" d="M20 220 L92 292 Q100 300 111.31 300 L420 300" />
              <path className="ln-p" d="M288.69 300 Q300 300 308 308 L372 372 Q380 380 391.31 380 L420 380" />
              <path className="ln-f ln-fq" pathLength="1" d="M20 220 L92 148 Q100 140 111.31 140 L288.69 140 Q300 140 308 132 L372 68 Q380 60 391.31 60 L420 60">
              </path>
              <path className="ln-f ln-fx" pathLength="1" d="M20 220 L92 148 Q100 140 111.31 140 L420 140" />
              <path className="ln-f ln-fg" pathLength="1" d="M20 220 L92 292 Q100 300 111.31 300 L420 300" />
              <path className="ln-f ln-fo" pathLength="1" d="M20 220 L92 292 Q100 300 111.31 300 L288.69 300 Q300 300 308 308 L372 372 Q380 380 391.31 380 L420 380">
              </path>
            </svg>
            {" "}
            <span className="lane-node" />
            {" "}
            <span className="lane-lab hub-lab">ScanTrix</span>
            {" "}
            <span className="lane-lab" style={{ left: "130px", top: "112px" }}>Bills</span>
            {" "}
            <span className="lane-lab" style={{ left: "130px", top: "310px" }}>Originals</span>
            {" "}
            <div className="le le-qb" style={{ top: "34px" }}>
              <span className="le-ico">
                <svg width={22} height={22}>
                  <use href="#lg-qb" />
                </svg>
              </span>
              <span className="le-n">QuickBooks Online</span>
              <span className="le-s">Live</span>
            </div>
            {" "}
            <div className="le le-xe" style={{ top: "114px" }}>
              <span className="le-ico">
                <svg width={22} height={22}>
                  <use href="#lg-xero" />
                </svg>
              </span>
              <span className="le-n">Xero</span>
              <span className="le-s">Live</span>
            </div>
            {" "}
            <div className="le le-next" style={{ top: "194px" }}>
              <span className="le-n">Sage · Zoho Books · FreshBooks</span>
              <span className="le-s">Next</span>
            </div>
            {" "}
            <div className="le le-gd" style={{ top: "274px" }}>
              <span className="le-ico">
                <Image src="/brand/google-drive.png" alt="" width={18} height={18} />
              </span>
              <span className="le-n">Google Drive</span>
              <span className="le-s">Live</span>
            </div>
            {" "}
            <div className="le le-od" style={{ top: "354px" }}>
              <span className="le-ico">
                <svg width={22} height={22}>
                  <use href="#lg-od" />
                </svg>
              </span>
              <span className="le-n">OneDrive</span>
              <span className="le-s">Live</span>
            </div>
            {" "}
            <span className="lp lp-qb" />
            <span className="lp lp-xe" />
            <span className="lp lp-gd" />
            <span className="lp lp-od" />
            {" "}
          </div>
          {" "}
        </div>
        {" "}
        <div className="lanes-m">
          {" "}
          <div className="lm-g">
            {" "}
            <p className="lm-h">Bills go to</p>
            {" "}
            <div className="lm-row">
              <span className="le-ico">
                <svg width={22} height={22} aria-hidden="true">
                  <use href="#lg-qb" />
                </svg>
              </span>
              <span className="le-n">QuickBooks Online</span>
              <span className="le-s">Live</span>
            </div>
            {" "}
            <div className="lm-row">
              <span className="le-ico">
                <svg width={22} height={22} aria-hidden="true">
                  <use href="#lg-xero" />
                </svg>
              </span>
              <span className="le-n">Xero</span>
              <span className="le-s">Live</span>
            </div>
            {" "}
          </div>
          {" "}
          <div className="lm-g">
            {" "}
            <p className="lm-h">Originals go to</p>
            {" "}
            <div className="lm-row">
              <span className="le-ico">
                <Image src="/brand/google-drive.png" alt="" width={18} height={18} />
              </span>
              <span className="le-n">Google Drive</span>
              <span className="le-s">Live</span>
            </div>
            {" "}
            <div className="lm-row">
              <span className="le-ico">
                <svg width={22} height={22} aria-hidden="true">
                  <use href="#lg-od" />
                </svg>
              </span>
              <span className="le-n">OneDrive</span>
              <span className="le-s">Live</span>
            </div>
            {" "}
          </div>
          {" "}
          <div className="lm-g">
            {" "}
            <p className="lm-h">Coming next</p>
            {" "}
            <div className="lm-row lm-next">
              <span className="le-n">Sage, Zoho Books, FreshBooks</span>
            </div>
            {" "}
          </div>
          {" "}
        </div>
        {" "}
      </div>
      {" "}
    </section>
  );
}
