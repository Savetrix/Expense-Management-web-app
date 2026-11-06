import { SignupLink } from "@/components/blog/SignupLink";

import { ClientDemo } from "./ClientDemo";
import { PauseButton } from "./PauseButton";

export function Hero() {
  return (
    <section className="hero">
      {" "}
      <div className="wrap">
        {" "}
        <h1 className="kick">Invoice-to-bill automation for QuickBooks and Xero</h1>
        {" "}
        <p className="sr">Invoices in. Bills posted.</p>
        {" "}
        <div className="stage">
          {" "}
          <div className="side side-in" aria-hidden="true">
            {" "}
            <p className="big big-in">
              <span className="ln">
                <span>Invoices</span>
              </span>
              <span className="ln">
                <span className="ln-row">
                  <span>
                    in
                    <i className="pd pd-in">.</i>
                  </span>
                  <span className="tail tail-in">
                    <span className="t-base" />
                    <span className="t-fill" />
                    <span className="t-trk">
                      <i />
                    </span>
                  </span>
                </span>
              </span>
            </p>
            {" "}
            <span className="cap cap-in">
              <svg width={13} height={13}>
                <use href="#ic-mail" />
              </svg>
              Fwd: Invoice INV-20418
            </span>
            {" "}
            <div className="vconn vconn-in">
              {" "}
              <span className="vrail">
                <span className="v-base" />
                <span className="v-fill" />
                <span className="v-trk">
                  <i />
                </span>
              </span>
              {" "}
              <span className="vcap">
                <svg width={13} height={13}>
                  <use href="#ic-mail" />
                </svg>
                Fwd: Invoice INV-20418
              </span>
              {" "}
            </div>
            {" "}
          </div>
          {" "}
          <ClientDemo />
          {" "}
          <div className="side side-out" aria-hidden="true">
            {" "}
            <div className="out">
              {" "}
              <p className="big big-out">
                <span className="ln">
                  <span>Bills</span>
                </span>
                <span className="ln">
                  <span>
                    posted
                    <i className="pd sl pd-out">.</i>
                  </span>
                </span>
              </p>
              {" "}
              <span className="tail tail-out">
                <span className="t-base" />
                <span className="t-fill" />
                <span className="t-trk">
                  <i />
                </span>
              </span>
              {" "}
              <span className="riser">
                <span className="rs-base" />
                <span className="rs-fill" />
                <span className="rs-trk">
                  <i />
                </span>
              </span>
              {" "}
              <span className="cap cap-out">
                {" "}
                <span className="swap">
                  <span className="sw sw-qb">
                    <svg width={13} height={13}>
                      <use href="#lg-qb" />
                    </svg>
                    To QuickBooks
                  </span>
                  <span className="sw sw-xe">
                    <svg width={13} height={13}>
                      <use href="#lg-xero" />
                    </svg>
                    To Xero
                  </span>
                </span>
                {" "}
              </span>
              {" "}
            </div>
            {" "}
            <div className="vconn vconn-out">
              {" "}
              <span className="vrail">
                <span className="v-base" />
                <span className="v-fill" />
                <span className="v-trk">
                  <i />
                </span>
              </span>
              {" "}
              <span className="vcap">
                {" "}
                <span className="swap">
                  <span className="sw sw-qb">To QuickBooks</span>
                  <span className="sw sw-xe">To Xero</span>
                </span>
                {" "}
              </span>
              {" "}
            </div>
            {" "}
          </div>
          {" "}
          <PauseButton className="pause pause-d" />
          {" "}
        </div>
        {" "}
        <div className="hero-foot">
          {" "}
          <p className="lede">
            Forward the email, drop in the PDF or snap the paper. ScanTrix reads every line, posts the bill to QuickBooks or Xero and files the original in Google Drive or OneDrive.
          </p>
          {" "}
          <div className="hero-cta">
            {" "}
            <div className="hero-btns">
              {" "}
              <SignupLink className="pbtn">
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
              <a className="tlink" href="#how">
                <span className="tlink-t">See how it works</span>
                <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 5v14" />
                  <path d="m6 13 6 6 6-6" />
                </svg>
              </a>
              {" "}
            </div>
            {" "}
            <div className="hero-meta">
              {" "}
              <p className="note">14 days free. No card needed.</p>
              {" "}
              <PauseButton className="pause" />
              {" "}
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
