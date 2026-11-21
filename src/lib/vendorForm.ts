// Field checks shared by the two Add Vendor forms (Vendors page sheet and
// AddVendorModalV2). Every problem is reported at once, next to its field —
// an email the accounting software would refuse is caught here instead of
// coming back as a raw provider error after the round trip.

export interface VendorFieldErrors {
  name?: string;
  currency?: string;
  glAccount?: string;
  email?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateVendorForm({
  name,
  currency,
  glAccountId,
  email,
  requireGlAccount,
}: {
  name: string;
  /** Required on a new vendor; undefined when the form can't change it (editing). */
  currency?: string;
  glAccountId: string;
  email: string;
  requireGlAccount: boolean;
}): VendorFieldErrors {
  const errors: VendorFieldErrors = {};
  if (!name.trim()) errors.name = "Vendor name is required";
  if (currency !== undefined && !currency.trim()) errors.currency = "Pick the vendor's currency";
  if (requireGlAccount && !glAccountId) errors.glAccount = "GL account is required to create a vendor";
  if (email.trim() && !EMAIL_PATTERN.test(email.trim())) errors.email = "Enter a valid email address, e.g. billing@vendor.com";
  return errors;
}

export const hasVendorErrors = (errors: VendorFieldErrors) => Object.values(errors).some(Boolean);

// A new vendor's currency starts empty and must be picked (Saurabh, 20 Nov: a
// pre-filled currency gets saved wrong by accident). Currency can't be changed
// once the vendor exists in QuickBooks/Xero.
export const NO_CURRENCY = "";
