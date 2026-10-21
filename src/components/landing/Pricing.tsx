// Section 5. The trial and plan CTAs go to /register; Custom opens the same
// enquiry modal as the in-app /plans page.
import { SignupLink } from "@/components/blog/SignupLink";

import { TalkToSalesButton } from "./TalkToSalesButton";

export function Pricing() {
  return (
    <section className="price" id="pricing">
      {" "}
      <div className="wrap">
        {" "}
        <div className="sec-top">
          {" "}
          <p className="eyebrow">Pricing</p>
          {" "}
          <h2 className="h2">
            Start free. Plans scale with your companies
            <i className="pd">.</i>
          </h2>
          {" "}
          <p className="price-sub">
            Every plan starts with a 14-day free trial, no card needed. Scans and team members are unlimited on every plan. Plans differ by how many QuickBooks or Xero companies you connect.
          </p>
          {" "}
        </div>
        {" "}
        <div className="plans">
          {" "}
          <article className="plan">
            {" "}
            <h3 className="plan-n">Trial</h3>
            {" "}
            <p className="plan-t">Try ScanTrix free for 14 days</p>
            {" "}
            <p className="plan-p">
              <b>$0</b>
              <span>for 14 days</span>
            </p>
            {" "}
            <span className="plan-m pm-1" aria-hidden="true">
              <i />
            </span>
            {" "}
            <ul className="plan-f">
              {" "}
              <li>Unlimited scans</li>
              {" "}
              <li>Unlimited team members</li>
              {" "}
              <li>1 company in QuickBooks or Xero</li>
              {" "}
            </ul>
            {" "}
            <SignupLink className="gbtn plan-cta">Start free trial</SignupLink>
            {" "}
          </article>
          {" "}
          <article className="plan">
            {" "}
            <h3 className="plan-n">Standard</h3>
            {" "}
            <p className="plan-t">For growing teams</p>
            {" "}
            <p className="plan-p">
              <b>Monthly</b>
              <span>or yearly billing</span>
            </p>
            {" "}
            <span className="plan-m pm-1" aria-hidden="true">
              <i />
            </span>
            {" "}
            <ul className="plan-f">
              {" "}
              <li>Unlimited scans</li>
              {" "}
              <li>Unlimited team members</li>
              {" "}
              <li>1 company in QuickBooks or Xero</li>
              {" "}
            </ul>
            {" "}
            <SignupLink className="gbtn plan-cta">Start free trial</SignupLink>
            {" "}
          </article>
          {" "}
          <article className="plan plan-hl">
            {" "}
            <span className="tag plan-tag">Most popular</span>
            {" "}
            <h3 className="plan-n">Enterprise</h3>
            {" "}
            <p className="plan-t">For multi-entity businesses</p>
            {" "}
            <p className="plan-p">
              <b>Monthly</b>
              <span>or yearly billing</span>
            </p>
            {" "}
            <span className="plan-m pm-3" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {" "}
            <ul className="plan-f">
              {" "}
              <li>Unlimited scans</li>
              {" "}
              <li>Unlimited team members</li>
              {" "}
              <li>3 companies in QuickBooks or Xero</li>
              {" "}
            </ul>
            {" "}
            <SignupLink className="pbtn plan-cta">
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
          </article>
          {" "}
          <article className="plan plan-x">
            {" "}
            <h3 className="plan-n">Custom</h3>
            {" "}
            <p className="plan-t">For businesses that outgrow the plans above</p>
            {" "}
            <p className="plan-p">
              <b>Let’s talk</b>
              <span>sized to your volume</span>
            </p>
            {" "}
            <span className="plan-m pm-x" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            {" "}
            <ul className="plan-f">
              {" "}
              <li>Invoice volumes sized to your throughput</li>
              {" "}
              <li>Multiple companies and entities</li>
              {" "}
              <li>Large teams with roles that fit</li>
              {" "}
              <li>Custom integrations and workflows</li>
              {" "}
              <li>Guided onboarding and priority support</li>
              {" "}
            </ul>
            {" "}
            <TalkToSalesButton className="gbtn plan-cta">Talk to sales</TalkToSalesButton>
            {" "}
          </article>
          {" "}
        </div>
        {" "}
        <p className="price-note">Current prices are shown in the app when you start your trial.</p>
        {" "}
      </div>
      {" "}
    </section>
  );
}
