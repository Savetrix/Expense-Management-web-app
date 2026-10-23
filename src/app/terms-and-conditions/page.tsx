import type { Metadata } from "next";
import Link from "next/link";

import { LegalContents } from "@/components/legal/LegalContents";
import { SUPPORT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service | Scantrix",
  description: "The terms that govern your use of ScanTrix, operated by ScanTrix Technologies Inc.",
  alternates: { canonical: "/terms-and-conditions" },
};

// The legal text below is supplied by the business and is rendered as written.
// Section ids drive the contents list, so keep the two in step.
const SECTIONS = [
  ["agreement", "Agreement and the Service"],
  ["beta", "Beta disclaimer"],
  ["eligibility", "Eligibility, accounts, and business use"],
  ["ai", "AI processing and auto-posting"],
  ["acceptable-use", "Acceptable use"],
  ["data", "Your data, security, and export"],
  ["processing", "Data processing"],
  ["fees", "Fees, taxes, and refunds"],
  ["support", "Support and availability"],
  ["ip", "Intellectual property and AI improvement"],
  ["third-party", "Third-party services"],
  ["apple", "Apple App Store terms"],
  ["disclaimers", "Disclaimers"],
  ["liability", "Limitation of liability"],
  ["indemnity", "Indemnity"],
  ["termination", "Changes, suspension, and termination"],
  ["law", "Governing law and arbitration"],
  ["general", "General"],
  ["contact", "Contact"],
] as const;

const mail = <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>;

export default function TermsAndConditionsPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
      <h1 className="text-[clamp(2rem,4.6vw,2.75rem)] font-bold leading-[1.1] tracking-[-0.025em] text-[color:var(--lp-teal-700)]">
        ScanTrix Terms of Service
      </h1>
      <p className="mt-4 text-[15px] text-text-secondary">
        <strong>Effective date:</strong> August 1, 2026
      </p>

      <LegalContents sections={SECTIONS} />

      <div className="lp-prose mt-8 [&_h2]:scroll-mt-24 [&_h2]:text-[color:var(--lp-teal-700)]!">
        <h2 id="agreement">1. Agreement and the Service</h2>
        <p>
          These Terms of Service (&ldquo;Terms&rdquo;) are a binding agreement between you (&ldquo;you&rdquo;) and{" "}
          <strong>ScanTrix Technologies Inc.</strong>, a Canadian federal corporation with its registered office in
          Ontario (&ldquo;ScanTrix&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). They govern your use of the ScanTrix
          mobile application, web application, and website (the &ldquo;Service&rdquo;). The iOS app is published on the
          Apple App Store by Savetrix Accounting Services LLP under licence from ScanTrix. ScanTrix owns the Service and
          is your contracting party.
        </p>
        <p>
          By creating an account, or by using the Service, you agree to these Terms and our{" "}
          <Link href="/privacy-policy">Privacy Policy</Link>. If you do not agree, do not use the Service.
        </p>
        <p>
          ScanTrix is an AI-powered invoice scanning and accounts payable tool. It extracts invoice data, suggests GL
          classifications, and can post bills to your connected accounting software. ScanTrix is software only. It does
          not provide accounting, tax, audit, assurance, or legal services, and using it creates no professional-client
          relationship with ScanTrix or with any CPA connected to it.
        </p>

        <h2 id="beta">2. Beta disclaimer</h2>
        <p>
          The Service is currently in beta. Features may be incomplete, change, or be removed without notice, and the
          Service may contain errors, interruptions, or data loss. Beta access is provided without any commitment of
          availability, support level, or continued operation. You use the beta at your own risk, and you should check
          all output and keep your own backups and records. We may ask for feedback on the beta, and you grant us a
          free, perpetual licence to use any feedback you give us without obligation to you. Nothing in this section
          limits any legal rights that cannot be excluded.
        </p>

        <h2 id="eligibility">3. Eligibility, accounts, and business use</h2>
        <p>
          You must be at least 18 and have authority to bind yourself or your organization. You represent that you use
          the Service for business or professional purposes only, not for personal, family, or household use.
        </p>
        <p>
          You must give accurate registration information, keep your credentials secure, and tell us at {mail} if you
          suspect unauthorized access. You are responsible for all activity under your account. We may suspend or
          terminate accounts with inaccurate information or that breach these Terms.
        </p>
        <p>
          <strong>QuickBooks Online.</strong> By connecting QuickBooks Online (QBO), you authorize ScanTrix to read
          vendor, account, and bill data, to create and post bills on your behalf according to the settings you choose,
          and to store the OAuth tokens needed to keep the connection. You can revoke this at any time in the app
          settings or in your Intuit account. ScanTrix is independent of Intuit and is not endorsed by it.
        </p>
        <p>
          <strong>Authority.</strong> If you connect or upload data that belongs to your employer or your clients, you
          represent that you are authorized to do so, that you have given any notices and obtained any consents
          required by law, and that you are responsible to them for your use of the Service.
        </p>

        <h2 id="ai">4. AI processing and auto-posting</h2>
        <p>
          ScanTrix uses third-party AI, including Anthropic&rsquo;s Claude, to extract and classify invoice data. AI
          output is not infallible. Confidence scores estimate the likelihood of accuracy but do not guarantee it.
          ScanTrix does not imply that Anthropic endorses the Service, and the usage requirements of our AI providers
          apply to your use of the Service.
        </p>
        <p>
          <strong>Auto-posting is optional.</strong> Automatic posting to QBO happens only if you turn it on and set a
          confidence threshold. You can turn it off at any time. Review thresholds and queues are described in the
          product documentation and may change.
        </p>
        <p>You are responsible for:</p>
        <ul>
          <li>Reviewing invoices placed in the review queue before approving them.</li>
          <li>Checking posted entries and reconciling your books regularly.</li>
          <li>Keeping your own records and backups.</li>
          <li>Your accounting, tax, and compliance decisions.</li>
        </ul>
        <p>ScanTrix keeps an activity log of postings so you can review and correct them.</p>

        <h2 id="acceptable-use">5. Acceptable use</h2>
        <p>You may use the Service only for lawful business purposes. You must not:</p>
        <ul>
          <li>Submit invoices or data that are false, fraudulent, or fabricated.</li>
          <li>
            Use the Service to facilitate tax evasion, money laundering, fraud, or any other unlawful financial
            activity.
          </li>
          <li>Upload content that infringes intellectual property or privacy rights, or that contains malware.</li>
          <li>Reverse engineer, decompile, or try to extract the source code of the Service.</li>
          <li>
            Interfere with or disrupt the Service, its servers, or its security, or probe or test its vulnerabilities
            without our written permission.
          </li>
          <li>Use bots, scripts, or scrapers to access the Service outside of normal use, or overload it.</li>
          <li>
            Share your account access with anyone not covered by your subscription, or resell the Service without our
            written agreement.
          </li>
          <li>Use the Service, its output, or its data to build or train a competing product.</li>
          <li>
            Use the Service in a way that violates the terms of Intuit, Apple, or any other third-party service it
            connects to.
          </li>
        </ul>
        <p>
          We may remove content, limit access, or suspend an account that we reasonably believe breaches this section.
        </p>

        <h2 id="data">6. Your data, security, and export</h2>
        <p>
          Invoice data and business information you submit remain yours. You grant ScanTrix a licence to host, process,
          and transmit that data to provide the Service, including to our service providers.
        </p>
        <p>
          <strong>Security.</strong> We use reasonable administrative, technical, and organizational safeguards designed
          to protect your data, as described in our Privacy Policy. No system is completely secure, and you are
          responsible for keeping your credentials and connected accounts secure. If we become aware of a security
          incident that affects your data, we will notify you without undue delay and as the law requires.
        </p>
        <p>
          <strong>Export.</strong> You can export your data from the Service at any time, and you may ask us in writing
          for a copy of your invoice and vendor data in a machine-readable format for up to 30 days after your account
          ends. ScanTrix is not a records archive, so you are responsible for keeping the books and records the law
          requires of you, including by exporting your invoice files before any deletion.
        </p>
        <p>
          <strong>Retention.</strong> How long we keep data is described in our Privacy Policy. We will not keep invoice
          images and related documents longer than six years, and we may delete them sooner, including after your
          account ends.
        </p>

        <h2 id="processing">7. Data processing</h2>
        <p>
          Invoices may include personal information about third parties, such as vendor contacts or employees. For that
          information, you are the party responsible for it (the controller or equivalent) and ScanTrix acts as your
          service provider (the processor or equivalent). ScanTrix will:
        </p>
        <ul>
          <li>
            Process that information only to provide the Service and as you instruct through your use of it, or as the
            law requires.
          </li>
          <li>Make sure staff who access it are bound by confidentiality.</li>
          <li>
            Use the service providers listed in our Privacy Policy, and be responsible for their performance of our
            obligations.
          </li>
          <li>
            Help you respond to access, correction, and deletion requests, taking into account the nature of the
            Service.
          </li>
          <li>Notify you of a confirmed breach affecting that information without undue delay.</li>
          <li>
            Delete or return it when your account ends, subject to the retention rules above and any legal duty to keep
            it.
          </li>
        </ul>
        <p>If you need a separate data processing agreement, contact {mail}.</p>

        <h2 id="fees">8. Fees, taxes, and refunds</h2>
        <p>
          <strong>Pricing.</strong> Pricing, tiers, and billing cycles are shown at the time of subscription. We will
          give you at least 30 days&rsquo; notice of price changes by email or in the app.
        </p>
        <p>
          <strong>Payment.</strong> Fees are charged in advance for each billing period. If you subscribe through the
          Apple App Store, billing, renewal, and cancellation are handled by Apple under its rules.
        </p>
        <p>
          <strong>Taxes.</strong> Fees are exclusive of taxes. Taxes, including GST/HST, provincial sales tax, VAT, and
          sales or use tax, will be charged based on the requirements that apply in your location, and you are
          responsible for paying them. If you are required to withhold tax, you will pay the additional amount needed
          so that we receive the full fees.
        </p>
        <p>
          <strong>Refunds.</strong> Fees are non-refundable, except that we will refund (a) fees as required by law, (b)
          the prepaid fees for the unused part of your billing period if we discontinue the Service or terminate without
          cause, and (c) a duplicate or incorrect charge that you report to us within 30 days. Refund requests go to{" "}
          {mail}. Refunds for purchases made through the Apple App Store are handled by Apple.
        </p>
        <p>
          <strong>Free trials.</strong> If a free trial is offered, your subscription converts to a paid subscription
          when the trial ends unless you cancel first.
        </p>
        <p>
          <strong>Cancellation.</strong> You may cancel at any time in the app settings or by contacting {mail}.
          Cancellation takes effect at the end of the current billing period, and you keep access until then.
        </p>

        <h2 id="support">9. Support and availability</h2>
        <p>
          We provide support by email at {mail} and aim to respond within a reasonable time on business days. We use
          commercially reasonable efforts to keep the Service available, but we do not guarantee any level of uptime,
          response time, or error-free operation, and during beta we make no availability commitment at all. We may
          perform maintenance that interrupts the Service, and we will try to give notice of planned downtime where we
          can.
        </p>

        <h2 id="ip">10. Intellectual property and AI improvement</h2>
        <p>
          ScanTrix and its licensors own the Service, including software, design, the ScanTrix name and logo, and AI
          models and tooling. These Terms give you a limited, non-exclusive, non-transferable, revocable licence to use
          the Service for your internal business purposes. All rights not expressly given are reserved.
        </p>
        <p>
          You agree that we may or may not use data submitted through the Service, including your corrections and vendor
          mappings, in de-identified or aggregated form to develop, train, test, and improve our AI features. We are not
          obliged to do so. We do not sell your personal information, and our Privacy Policy explains how we handle it.
        </p>
        <p>
          <strong>Publicity.</strong> We will not use your name or logo in our marketing without your prior written
          permission.
        </p>

        <h2 id="third-party">11. Third-party services</h2>
        <p>
          The Service relies on third parties, including Anthropic, Amazon Web Services, Intuit QuickBooks Online, and
          Make.com, and may connect to drives or other tools you choose. Their terms also apply to your use of them. We
          are not responsible for their availability, accuracy, or conduct.
        </p>

        <h2 id="apple">12. Apple App Store terms</h2>
        <p>If you get the iOS app from the Apple App Store, the following also applies:</p>
        <ul>
          <li>
            These Terms are between you and ScanTrix only, not Apple. ScanTrix, not Apple, is responsible for the app
            and its content.
          </li>
          <li>
            Your licence to the app is limited to use on Apple-branded products you own or control, as the Apple Media
            Services Terms permit.
          </li>
          <li>Apple has no duty to provide maintenance or support for the app.</li>
          <li>
            If the app does not meet any applicable warranty, you may tell Apple and Apple will refund the purchase
            price, if any. To the extent the law allows, Apple has no other warranty obligation for the app. ScanTrix is
            responsible for any other claims, losses, or costs related to a failure to meet a warranty.
          </li>
          <li>
            ScanTrix, not Apple, is responsible for addressing any claim about the app or your use of it, including
            product liability, legal or regulatory compliance, and consumer protection claims, and any claim that the
            app infringes a third party&rsquo;s intellectual property rights.
          </li>
          <li>
            You represent that you are not located in a country subject to a U.S. government embargo or designated as a
            &ldquo;terrorist supporting&rdquo; country, and that you are not on a U.S. government list of prohibited
            or restricted parties.
          </li>
          <li>
            You must comply with applicable third-party terms, such as your wireless data service agreement, when using
            the app.
          </li>
          <li>Apple and its subsidiaries are third-party beneficiaries of this section and may enforce it against you.</li>
        </ul>
        <p>
          Apple&rsquo;s own rules also govern anything you buy through the App Store. Our contact details for questions
          or claims about the app are in section 19.
        </p>

        <h2 id="disclaimers">13. Disclaimers</h2>
        <p className="text-[0.95em]">
          THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo;, AND DURING BETA WITHOUT ANY
          WARRANTY OF AVAILABILITY OR ACCURACY. TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES,
          EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT. WE DO
          NOT WARRANT THAT THE SERVICE WILL BE ERROR-FREE OR UNINTERRUPTED, THAT AI EXTRACTION OR CLASSIFICATION WILL BE
          ACCURATE OR COMPLETE, OR THAT DEFECTS WILL BE CORRECTED.
        </p>
        <p>
          ScanTrix is not responsible for errors, data loss, or incorrect postings that result from inaccurate invoice
          data, AI misclassification, or a misconfigured accounting file.
        </p>

        <h2 id="liability">14. Limitation of liability</h2>
        <p className="text-[0.95em]">
          TO THE MAXIMUM EXTENT PERMITTED BY LAW, SCANTRIX AND ITS OFFICERS, DIRECTORS, EMPLOYEES, AND AGENTS ARE NOT
          LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR FOR LOSS OF PROFITS, DATA, OR
          GOODWILL, EVEN IF ADVISED OF THE POSSIBILITY.
        </p>
        <p className="text-[0.95em]">
          OUR TOTAL LIABILITY FOR ALL CLAIMS RELATING TO THE SERVICE OR THESE TERMS IS LIMITED TO THE GREATER OF (A) THE
          AMOUNT YOU PAID US IN THE 12 MONTHS BEFORE THE CLAIM AND (B) CAD $100.
        </p>
        <p>
          These limits do not apply to liability for fraud, gross negligence, or wilful misconduct, or to any liability
          that cannot be limited by law.
        </p>

        <h2 id="indemnity">15. Indemnity</h2>
        <p>
          You will defend and indemnify ScanTrix and its officers, directors, employees, and agents against third-party
          claims and resulting losses, including reasonable legal fees, arising from (a) data or content you submit
          without authority, (b) your breach of these Terms, or (c) your violation of law or third-party rights. We will
          tell you promptly of any claim and you may not settle it without our consent if it imposes obligations on us.
        </p>

        <h2 id="termination">16. Changes, suspension, and termination</h2>
        <p>
          We may change the Service or these Terms. For material changes to these Terms we will give you at least 30
          days&rsquo; notice by email or in the app before they take effect, and your continued use after that date
          means you accept them. If you do not agree, you may cancel before the change takes effect.
        </p>
        <p>
          We may suspend or terminate your account immediately if you breach these Terms or if we reasonably believe
          your use poses a risk to us, other users, or third parties. We may also end the Service or terminate your
          account without cause on 30 days&rsquo; notice. If we discontinue the Service or terminate without cause, we
          will refund prepaid fees for the unused part of your billing period.
        </p>
        <p>
          On termination your licence ends and we may delete your account data under our Privacy Policy. Provisions that
          by nature survive, including intellectual property, disclaimers, limitation of liability, indemnity, and
          dispute resolution, continue to apply.
        </p>

        <h2 id="law">17. Governing law and arbitration</h2>
        <p>
          These Terms are governed by the laws of the Province of Ontario and the federal laws of Canada that apply
          there, without regard to conflict of law rules.
        </p>
        <p>
          <strong>Informal resolution.</strong> Before starting any proceeding, you and ScanTrix will try to resolve the
          dispute informally for 30 days after written notice sent to {mail}.
        </p>
        <p>
          <strong>Binding arbitration.</strong> If the dispute is not resolved, it will be finally resolved by
          arbitration by a single arbitrator.
        </p>
        <ul>
          <li>
            If your principal place of business is in Canada, the arbitration will be conducted under the Arbitration
            Rules of the ADR Institute of Canada, Inc.
          </li>
          <li>
            If your principal place of business is outside Canada, the arbitration will be administered by the
            International Centre for Dispute Resolution (ICDR) under its International Arbitration Rules.
          </li>
        </ul>
        <p>
          The seat of arbitration is Toronto, Ontario, the language is English, and hearings may be held virtually.
          Ontario&rsquo;s arbitration legislation applies, which is the <em>Arbitration Act, 1991</em> for domestic
          disputes and the <em>International Commercial Arbitration Act, 2017</em> for international ones. We will pay
          the arbitration fees and the arbitrator&rsquo;s compensation that exceed what you would have paid to file a
          claim in the Ontario Superior Court of Justice, so that cost does not prevent you from bringing a claim.
          Claims may be brought only on an individual basis, not as a class or representative action, to the extent the
          law permits.
        </p>
        <p>
          <strong>Court exceptions.</strong> Either party may ask the courts of Ontario for urgent injunctive relief to
          protect intellectual property, confidential information, or data. Ontario courts have jurisdiction for any
          matter not subject to arbitration.
        </p>

        <h2 id="general">18. General</h2>
        <p>
          <strong>Entire agreement.</strong> These Terms and our Privacy Policy are the entire agreement between us on
          the Service. If a provision is unenforceable, the rest remains in effect. Our failure to enforce a right is
          not a waiver. You may not assign these Terms without our written consent; we may assign them to an affiliate
          or a successor. We are not liable for delays caused by events beyond our reasonable control.
        </p>
        <p>
          <strong>Notices.</strong> You consent to receive notices electronically. We give notices to the email on your
          account, and you give notices to {mail}.
        </p>
        <p>
          <strong>Export and sanctions.</strong> You will comply with all applicable export control, sanctions, and
          anti-corruption laws, and you will not use or give access to the Service in any country or to any person
          where that is prohibited by Canadian, U.S., or other applicable law.
        </p>
        <p>
          <strong>Language.</strong> The parties have required that these Terms and all related documents be written in
          English.{" "}
          <em>
            Les parties ont exigé que les présentes conditions et tous les documents connexes soient rédigés en anglais.
          </em>
        </p>

        <h2 id="contact">19. Contact</h2>
        <p>ScanTrix Technologies Inc., Ontario. Support and legal notices: {mail}.</p>
      </div>
    </div>
  );
}
