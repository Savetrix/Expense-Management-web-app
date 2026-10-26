// SERVER-ONLY. The "this visitor has given their details" marker for the
// e-books, and the one place that reads it.
//
// This is a lead gate, not DRM: an httpOnly cookie set by the lead route after a
// valid submission. It keeps the PDFs and the web text from being handed out
// without the form, which is what the form is for. It does not try to stop a
// determined visitor who forges the cookie, and it holds no secret, so there is
// nothing to rotate and no environment variable to set.
import { cookies } from "next/headers";

export const EBOOK_ACCESS_COOKIE = "scantrix_ebook_access";

/** One year. The visitor gave their details once; they should not be asked again. */
export const EBOOK_ACCESS_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export async function hasEbookAccess(): Promise<boolean> {
  const store = await cookies();
  return store.get(EBOOK_ACCESS_COOKIE)?.value === "1";
}
