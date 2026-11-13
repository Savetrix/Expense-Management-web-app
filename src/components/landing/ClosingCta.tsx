// Section 6: "Forward one invoice. Watch it post."
import { SignupLink } from "@/components/blog/SignupLink";

import { TalkToSalesButton } from "./TalkToSalesButton";

export function ClosingCta() {
  return (
    <section className="cta">
      {" "}
      <div className="wrap">
        {" "}
        <p className="receipt">
          <span className="okdot" aria-hidden="true" />
          <span>INV-20418</span>
          <span className="rc-x">Northwind Supplies</span>
          <span className="rc-x">$783.50</span>
          <span>Posted</span>
          <span>Original filed</span>
        </p>
        {" "}
        <h2 className="sr">Forward one invoice. Watch it post.</h2>
        {" "}
        <p className="cta-l1" aria-hidden="true">
          Forward one invoice
          <i className="pd">.</i>
        </p>
        {" "}
        <div className="cta-l2">
          {" "}
          <p className="cta-t" aria-hidden="true">
            Watch it post
            <i className="pd">.</i>
          </p>
          {" "}
          <span className="cta-rail" aria-hidden="true">
            <span className="t-base" />
            <span className="t-fill" />
            <span className="t-trk">
              <i />
            </span>
          </span>
          {" "}
          <span className="cta-drop" aria-hidden="true">
            <span className="d-base" />
            <span className="d-fill" />
            <span className="d-trk">
              <i />
            </span>
          </span>
          {" "}
          <SignupLink className="pbtn cta-btn">
            <span>Start free trial</span>
            <span className="pbtn-c" aria-hidden="true">
              <svg className="a1" width={16} height={16}>
                <use href="#ic-arrow" />
              </svg>
              <svg className="a2" width={16} height={16}>
                <use href="#ic-arrow" />
              </svg>
            </span>
          </SignupLink>
          {" "}
          <p className="note cta-note">14 days free. No card needed.</p>
          {" "}
        </div>
        {" "}
        <div className="cta-row">
          {" "}
          <p>Connect QuickBooks or Xero, then forward the next invoice you’d have typed by hand. Built for finance teams and accounting firms.</p>
          {" "}
          <div className="cta-meta">
            <TalkToSalesButton className="tlink">
              <span className="tlink-t">Talk to sales</span>
            </TalkToSalesButton>
            <span className="note">14 days free. No card needed.</span>
          </div>
          {" "}
        </div>
        {" "}
      </div>
      {" "}
    </section>
  );
}
