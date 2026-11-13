// Section 5. The trial and plan CTAs go to /register; Custom opens the same
// enquiry modal as the in-app /plans page.
//
// Prices are the client's (in-app /plans, October 2026), in US dollars:
// Standard $14.99/month or $149.99/year, Enterprise $29.99/month or
// $299.99/year, extra companies $10/month ($100/year). Yearly is about 17%
// off twelve monthly payments. Change them here and on /plans together.
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
              <b>Free</b>
              <span>for 14 days</span>
              <span>No card needed to start</span>
            </p>
            {" "}
            <span className="plan-m pm-1" aria-hidden="true">
              <i />
            </span>
            {" "}
            <ul className="plan-f">
              {" "}
              <li>Unlimited scans during the trial</li>
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
            <h3 className="plan-n">Standard</h3>
            {" "}
            <p className="plan-t">For growing teams and businesses</p>
            {" "}
            <p className="plan-p">
              <b>$14.99</b>
              <span>per month, cancel anytime</span>
              <span>or $149.99 a year, about 17% less</span>
            </p>
            {" "}
            <span className="plan-m pm-1" aria-hidden="true">
              <i />
            </span>
            {" "}
            <ul className="plan-f">
              {" "}
              <li>Unlimited scans, posted automatically</li>
              {" "}
              <li>Unlimited team members</li>
              {" "}
              <li>1 company in QuickBooks or Xero</li>
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
          <article className="plan">
            {" "}
            <h3 className="plan-n">Enterprise</h3>
            {" "}
            <p className="plan-t">For multi-entity businesses and firms</p>
            {" "}
            <p className="plan-p">
              <b>$29.99</b>
              <span>per month</span>
              <span>or $299.99 a year, about 17% less</span>
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
              <li>Audit logs and role permissions</li>
              {" "}
              <li>Dedicated CPA support and onboarding</li>
              {" "}
              <li>More companies at $10 a month each ($100 a year)</li>
              {" "}
            </ul>
            {" "}
            <SignupLink className="gbtn plan-cta">Start free trial</SignupLink>
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
        <p className="price-note">Prices in US dollars. Every paid plan starts with the 14-day free trial.</p>
        {" "}
      </div>
      {" "}
    </section>
  );
}
