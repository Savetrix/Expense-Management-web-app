import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The e-book PDFs live in private/ebooks/ and are read from disk at request
  // time by src/app/ebooks/[slug]/download/route.ts. Next only bundles files it
  // can see being imported, so name the folder here or the deployed function
  // would not contain the PDFs.
  outputFileTracingIncludes: {
    "/ebooks/*/download": ["./private/ebooks/**/*"],
  },
};

export default nextConfig;
