import type { Metadata } from "next";

import { LegalContents } from "@/components/legal/LegalContents";
import { SUPPORT_EMAIL } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy | Scantrix",
  description: "How ScanTrix Technologies Inc. collects, uses, stores, and protects personal information.",
  alternates: { canonical: "/privacy-policy" },
};

// The legal text below is supplied by the business and is rendered as written.
// Section ids drive the contents list, so keep the two in step.
const SECTIONS = [
  ["who-we-are", "Who we are"],
  ["information-we-collect", "Information we collect"],
  ["how-we-use-information", "How we use information and AI processing"],
  ["sharing", "Sharing and service providers"],
  ["storage-and-retention", "Storage, retention, and data residency"],
  ["security-and-rights", "Security and your rights"],
  ["contact", "Privacy Officer, complaints, and contact"],
] as const;

export default function PrivacyPolicyPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16">
      <h1 className="text-[clamp(2rem,4.6vw,2.75rem)] font-bold leading-[1.1] tracking-[-0.025em] text-[color:var(--lp-teal-700)]">
        ScanTrix Privacy Policy
      </h1>
      <p className="mt-4 text-[15px] text-text-secondary">
        <strong>Effective date:</strong> August 1, 2026
      </p>

      <LegalContents sections={SECTIONS} />

      <div className="lp-prose mt-8 [&_h2]:scroll-mt-24 [&_h2]:text-[color:var(--lp-teal-700)]!">
        <h2 id="who-we-are">1. Who we are</h2>
        <p>
          ScanTrix is an AI-powered invoice scanning and accounts payable application operated by{" "}
          <strong>ScanTrix Technologies Inc.</strong>, a Canadian federal corporation with its registered office in{" "}
          Ontario (&ldquo;ScanTrix&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, or
          &ldquo;our&rdquo;). ScanTrix is the organization responsible for the personal information described in this
          Privacy Policy.
        </p>
        <p>
          The iOS app is published on the Apple App Store under the name Savetrix Accounting Services LLP
          (&ldquo;Savetrix&rdquo;) under licence from ScanTrix. Savetrix is the App Store publisher only. ScanTrix owns
          the app and operates the service.
        </p>
        <p>
          This Privacy Policy applies to the ScanTrix mobile application, the ScanTrix web application, and our website
          at scantrix.ai (together, the &ldquo;Service&rdquo;). By using the Service, you agree to the practices
          described here. If you do not agree, please stop using the Service.
        </p>

        <h2 id="information-we-collect">2. Information we collect</h2>
        <p>
          <strong>Information you provide</strong>
        </p>
        <ul>
          <li>Account details: name, email address, business name, and password when you register.</li>
          <li>
            Invoice images and documents you scan or upload, and the data extracted from them (vendor, amount, date,
            line items). Invoices may contain personal information about third parties, such as vendor contacts or
            employees.
          </li>
          <li>
            QuickBooks Online authorization tokens. We do not receive or store your QuickBooks username or password.
          </li>
          <li>Vendor and general ledger (GL) coding data that you assign or correct in the Service.</li>
          <li>Messages and feedback you send to support.</li>
        </ul>
        <p>
          <strong>Information collected automatically</strong>
        </p>
        <ul>
          <li>Device and app information: device model, operating system version, app version, and device identifiers.</li>
          <li>Usage and processing data: features used, timestamps, confidence scores, and error logs.</li>
          <li>Analytics and crash data, which we use to maintain and improve the Service.</li>
        </ul>
        <p>
          <strong>Information about others.</strong> If you upload invoices or connect accounting files that belong to
          your employer or your clients, you confirm that you have the authority to do so and that you will give any
          notices and obtain any consents required by law.
        </p>

        <h2 id="how-we-use-information">3. How we use information and AI processing</h2>
        <p>We use personal information to:</p>
        <ul>
          <li>
            Extract invoice data and classify GL codes using AI, and post or queue bills in your connected accounting
            software according to the settings you choose.
          </li>
          <li>Show invoices for human review when AI confidence is below your configured auto-post threshold.</li>
          <li>Store and retrieve invoice images, and link them to the related records in your accounting software.</li>
          <li>Operate, secure, support, and improve the Service, and send transactional notifications.</li>
          <li>Comply with legal obligations and enforce our Terms of Service.</li>
        </ul>
        <p>
          <strong>AI processing.</strong> When you scan an invoice, the image and extracted data are sent to
          Anthropic&rsquo;s Claude API to extract and classify the information. Invoice approvals and postings may
          therefore involve automated processing. You can review, correct, or reverse any result, and you can turn
          automatic posting off in your settings.
        </p>
        <p>
          <strong>Improving our AI features.</strong> We may or may not use data submitted through the Service, including
          invoice data and your corrections, to develop, train, test, and improve ScanTrix&rsquo;s AI-assisted features
          and vendor memory system. Where we do, we will use it only in de-identified or aggregated form where
          reasonably practicable. We are under no obligation to do so, and we do not sell your personal information. Any
          third-party AI provider&rsquo;s use of your data is limited to what its agreement with us permits.
        </p>

        <h2 id="sharing">4. Sharing and service providers</h2>
        <p>
          We do not sell personal information. We share it only with the following, as needed to provide the Service:
        </p>
        <div className="lp-prose-table">
          <table>
            <thead>
              <tr>
                <th scope="col">Provider</th>
                <th scope="col">Purpose</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Anthropic (Claude API)</td>
                <td>AI extraction and classification of invoice images and data</td>
              </tr>
              <tr>
                <td>Amazon Web Services (AWS)</td>
                <td>Hosting and storage of Service data</td>
              </tr>
              <tr>
                <td>Intuit QuickBooks Online</td>
                <td>Reading vendor, account, and bill data and posting bills, on your authorization</td>
              </tr>
              <tr>
                <td>Make.com</td>
                <td>Workflow automation and webhook processing in our backend</td>
              </tr>
              <tr>
                <td>Connected drives you choose</td>
                <td>Saving invoice files to a drive you have connected to ScanTrix</td>
              </tr>
              <tr>
                <td>Savetrix Accounting Services LLP (India)</td>
                <td>Apple App Store publisher only</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          We may also disclose information where required by law, court order, or a governmental authority, or to
          protect the rights, property, or safety of ScanTrix, our users, or others. If ScanTrix is involved in a
          merger, acquisition, or sale of assets, personal information may be transferred, and we will give notice
          before it becomes subject to a different privacy policy.
        </p>
        <p>
          Your use of QuickBooks Online and other third-party services is governed by their own terms and privacy
          policies. ScanTrix is independent of and not affiliated with Intuit.
        </p>

        <h2 id="storage-and-retention">5. Storage, retention, and data residency</h2>
        <p>
          <strong>Where data is stored.</strong> ScanTrix stores Service data on Amazon Web Services (AWS). ScanTrix
          decides from time to time where data is stored and processed, and the AWS region may change. Data may be
          stored or processed in Canada, the United States, or other countries where our service providers operate.{" "}
          Our current AWS region is India. We will update this Privacy Policy if our storage location
          changes materially.
        </p>
        <p>
          <strong>Invoice images and records.</strong> Invoice images you scan are uploaded to your connected accounting
          software and are stored there, under that software&rsquo;s own terms and retention rules. If you choose to
          save invoice files to a drive connected through ScanTrix, they are saved in that drive. ScanTrix also keeps
          copies and related processing data on AWS for as long as needed to provide the Service.
        </p>
        <p>
          <strong>How long we keep data.</strong> ScanTrix decides how long we keep invoice images and related
          documents. We will not keep them longer than six years, and we may delete them sooner. We keep account data
          while your account is active and for a reasonable period afterward, as needed for legal, tax, security, and
          dispute purposes. Vendor memory data (GL assignments and confidence history) is kept while your account is
          active so the Service can work accurately. You may ask us to delete your data at any time, subject to legal
          retention duties.
        </p>
        <p>
          <strong>Your records.</strong> ScanTrix is not a records archive. You are responsible for keeping the books
          and records that the law requires of you, including by exporting or backing up your invoice files before any
          deletion.
        </p>

        <h2 id="security-and-rights">6. Security and your rights</h2>
        <p>
          <strong>Security.</strong> We use measures appropriate to the sensitivity of the data, including encryption in
          transit, access controls that limit staff access on a need-to-know basis, and OAuth 2.0 for QuickBooks Online
          so we never store your QuickBooks password. No system is completely secure, and we cannot guarantee absolute
          security. If a breach creates a real risk of significant harm, we will notify affected users and the relevant
          privacy regulators as the law requires.
        </p>
        <p>
          <strong>Your rights.</strong> Depending on where you live, you may have the right to access your personal
          information, correct it, delete it, withdraw consent, receive a portable copy, object to certain processing,
          and ask about automated decisions. Residents of Quebec, other Canadian provinces, and certain US states
          (including California) have rights under local law, and we will honour them as required. To make a request,
          contact the Privacy Officer below. We will respond within 30 days.
        </p>
        <p>
          <strong>Consent.</strong> By using the Service you consent to the collection, use, and disclosure described
          here. You may withdraw consent at any time, but the Service may not work without it.
        </p>

        <h2 id="contact">7. Privacy Officer, complaints, and contact</h2>
        <p>
          <strong>Privacy Officer:</strong> Saurabh Kalpasi
          <br />
          <strong>Email:</strong> <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          <br />
          <strong>Company:</strong> ScanTrix Technologies Inc., Ontario
        </p>
        <p>
          Contact the Privacy Officer with any privacy question, access or deletion request, or complaint. If you are
          not satisfied with our response, you may contact the Office of the Privacy Commissioner of Canada or your
          provincial or state privacy regulator.
        </p>
        <p>
          <strong>Children.</strong> The Service is intended for accounting professionals and businesses. We do not
          knowingly collect personal information from anyone under 18, and we will delete it promptly if we learn we
          have.
        </p>
        <p>
          <strong>Changes.</strong> We may update this Privacy Policy. For material changes we will update the effective
          date and give notice by email or in the app before they take effect.
        </p>
      </div>
    </div>
  );
}
