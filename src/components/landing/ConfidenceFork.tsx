// Section 3: "If it's sure, it posts. If it isn't, it asks."

export function ConfidenceFork() {
  return (
    <section className="ctrl">
      {" "}
      <div className="wrap">
        {" "}
        <h2 className="ctrl-h">
          If it’s sure, it posts
          <i className="pd">.</i>
          {" "}
          <span className="ctrl-2">
            If it isn’t, it asks
            <i className="pd">.</i>
          </span>
        </h2>
        {" "}
        <div className="fork fork-w" aria-hidden="true">
          {" "}
          <svg width={900} height={240} viewBox="0 0 900 240">
            <defs>
              <linearGradient id="fkg-w" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="160" y2="0">
                <stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
                <stop offset="1" stopColor="#FFFFFF" />
              </linearGradient>
              <mask id="fkm-w" maskUnits="userSpaceOnUse" x="-10" y="0" width={920} height={240}>
                <rect x="-10" width={920} height={240} fill="url(#fkg-w)" />
              </mask>
            </defs>
            <path className="fk-p" mask="url(#fkm-w)" d="M0 120 L300 120" />
            <path className="fk-p" d="M300 120 C380 120 390 56 470 56 L780 56" />
            <path className="fk-p" d="M300 120 C380 120 390 184 470 184 L780 184" />
            <g mask="url(#fkm-w)">
              <path className="fk-f fk-fa" pathLength="1" d="M0 120 L300 120 C380 120 390 56 470 56 L774 56" />
              <path className="fk-f fk-fb" pathLength="1" d="M0 120 L300 120 C380 120 390 184 470 184 L774 184" />
            </g>
            <circle className="fk-jr" cx="300" cy="120" r="5" />
            <circle className="fk-j" cx="300" cy="120" r="4" />
            <circle className="fk-e fk-e1" cx="780" cy="56" r="6" />
            <circle className="fk-e fk-e2" cx="780" cy="184" r="6" />
          </svg>
          {" "}
          <span className="fk-lab" style={{ left: "160px", top: "86px", width: "128px", textAlign: "right" }}>Confidence check</span>
          {" "}
          <span className="fk-lab" style={{ left: "796px", top: "47px" }}>Posted</span>
          {" "}
          <span className="fk-lab" style={{ left: "796px", top: "175px" }}>Posted</span>
          {" "}
          <span className="fk-gate" style={{ left: "596px", top: "170px" }}>
            <svg className="fk-g1" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21a8 8 0 0 1 16 0" />
            </svg>
            <svg className="fk-g2" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5 10 17 19 7" />
            </svg>
          </span>
          {" "}
          <span className="fk-lab" style={{ left: "560px", top: "206px", width: "100px", textAlign: "center" }}>Your review</span>
          {" "}
          <span className="fk-chip fk-a">
            <i />
            <span className="fkl">
              <span className="fa0">New bill</span>
              <span className="fa1">All fields sure</span>
            </span>
          </span>
          {" "}
          <span className="fk-chip fk-b">
            <i />
            <span className="fkl">
              <span className="fb0">New bill</span>
              <span className="fb1">Needs review</span>
              <span className="fb2">Approved</span>
            </span>
          </span>
          {" "}
        </div>
        {" "}
        <div className="fork fork-c" aria-hidden="true">
          {" "}
          <svg width={480} height={240} viewBox="0 0 480 240">
            <defs>
              <linearGradient id="fkg-c" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="90" y2="0">
                <stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
                <stop offset="1" stopColor="#FFFFFF" />
              </linearGradient>
              <mask id="fkm-c" maskUnits="userSpaceOnUse" x="-10" y="0" width={500} height={240}>
                <rect x="-10" width={500} height={240} fill="url(#fkg-c)" />
              </mask>
            </defs>
            <path className="fk-p" mask="url(#fkm-c)" d="M0 120 L150 120" />
            <path className="fk-p" d="M150 120 C215 120 225 56 290 56 L420 56" />
            <path className="fk-p" d="M150 120 C215 120 225 184 290 184 L420 184" />
            <g mask="url(#fkm-c)">
              <path className="fk-f fk-fa" pathLength="1" d="M0 120 L150 120 C215 120 225 56 290 56 L414 56" />
              <path className="fk-f fk-fb" pathLength="1" d="M0 120 L150 120 C215 120 225 184 290 184 L414 184" />
            </g>
            <circle className="fk-jr" cx="150" cy="120" r="4.5" />
            <circle className="fk-j" cx="150" cy="120" r="3.5" />
            <circle className="fk-e fk-e1" cx="420" cy="56" r="6" />
            <circle className="fk-e fk-e2" cx="420" cy="184" r="6" />
          </svg>
          {" "}
          <span className="fk-lab" style={{ left: "12px", top: "84px" }}>Confidence check</span>
          {" "}
          <span className="fk-lab" style={{ left: "432px", top: "46px" }}>Posted</span>
          {" "}
          <span className="fk-lab" style={{ left: "432px", top: "174px" }}>Posted</span>
          {" "}
          <span className="fk-gate" style={{ left: "326px", top: "170px" }}>
            <svg className="fk-g1" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21a8 8 0 0 1 16 0" />
            </svg>
            <svg className="fk-g2" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5 10 17 19 7" />
            </svg>
          </span>
          {" "}
          <span className="fk-lab" style={{ left: "290px", top: "206px", width: "100px", textAlign: "center" }}>Your review</span>
          {" "}
          <span className="fk-chip fk-a">
            <i />
            <span className="fkl">
              <span className="fa0">New bill</span>
              <span className="fa1">All fields sure</span>
            </span>
          </span>
          {" "}
          <span className="fk-chip fk-b">
            <i />
            <span className="fkl">
              <span className="fb0">New bill</span>
              <span className="fb1">Needs review</span>
              <span className="fb2">Approved</span>
            </span>
          </span>
          {" "}
          <span className="fk-dot" />
          {" "}
        </div>
        {" "}
        <div className="fork fork-m" aria-hidden="true">
          {" "}
          <svg width={350} height={220} viewBox="0 0 350 220">
            <defs>
              <linearGradient id="fkg-m" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="70" y2="0">
                <stop offset="0" stopColor="#FFFFFF" stopOpacity="0" />
                <stop offset="1" stopColor="#FFFFFF" />
              </linearGradient>
              <mask id="fkm-m" maskUnits="userSpaceOnUse" x="-10" y="0" width={370} height={220}>
                <rect x="-10" width={370} height={220} fill="url(#fkg-m)" />
              </mask>
            </defs>
            <path className="fk-p" mask="url(#fkm-m)" d="M0 110 L120 110" />
            <path className="fk-p" d="M120 110 C165 110 175 50 220 50 L320 50" />
            <path className="fk-p" d="M120 110 C165 110 175 170 220 170 L320 170" />
            <path className="fk-f fk-fa" pathLength="1" d="M70 110 L120 110 C165 110 175 50 220 50 L314 50" />
            <path className="fk-f fk-fb" pathLength="1" d="M70 110 L120 110 C165 110 175 170 220 170 L314 170" />
            <circle className="fk-jr" cx="120" cy="110" r="4.5" />
            <circle className="fk-j" cx="120" cy="110" r="3.5" />
            <circle className="fk-e fk-e1" cx="320" cy="50" r="6" />
            <circle className="fk-e fk-e2" cx="320" cy="170" r="6" />
          </svg>
          {" "}
          <span className="fk-lab" style={{ left: "0", top: "80px" }}>Confidence check</span>
          {" "}
          <span className="fk-lab" style={{ left: "290px", top: "20px", width: "60px", textAlign: "center" }}>Posted</span>
          {" "}
          <span className="fk-lab" style={{ left: "290px", top: "140px", width: "60px", textAlign: "center" }}>Posted</span>
          {" "}
          <span className="fk-gate" style={{ left: "246px", top: "156px" }}>
            <svg className="fk-g1" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 21a8 8 0 0 1 16 0" />
            </svg>
            <svg className="fk-g2" width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5 10 17 19 7" />
            </svg>
          </span>
          {" "}
          <span className="fk-lab" style={{ left: "210px", top: "192px", width: "100px", textAlign: "center" }}>Your review</span>
          {" "}
          <span className="fk-chip fk-a">
            <i />
            <span className="fkl">
              <span className="fa0">New bill</span>
              <span className="fa1">All fields sure</span>
            </span>
          </span>
          {" "}
          <span className="fk-chip fk-b">
            <i />
            <span className="fkl">
              <span className="fb0">New bill</span>
              <span className="fb1">Needs review</span>
              <span className="fb2">Approved</span>
            </span>
          </span>
          {" "}
          <span className="fk-dot" />
          {" "}
        </div>
        {" "}
        <p className="ctrl-note">
          <b>Auto-post is a switch on each company.</b>
          {" "}
          Unsure bills wait in one review queue, with the reason, until someone on your team approves them.
        </p>
        {" "}
      </div>
      {" "}
    </section>
  );
}
