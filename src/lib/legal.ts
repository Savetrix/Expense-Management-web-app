// Legal documents and the support address. Shared by the in-app profile screen
// and the public site footer and FAQ, so the two can never point at different
// documents. The PDFs are the same S3-hosted files the mobile app links to.

export const TERMS_URL =
  "https://scantrix-uploads.s3.ap-south-1.amazonaws.com/invoices/6a00877a03676409687bac34_1781529818953.pdf";

export const PRIVACY_URL =
  "https://scantrix-uploads.s3.ap-south-1.amazonaws.com/invoices/6a00877a03676409687bac34_1781529819012.pdf";

/** Also the fallback address in src/app/api/custom-plan-enquiry/route.ts. */
export const SUPPORT_EMAIL = "support@scantrix.ai";
