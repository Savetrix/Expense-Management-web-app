// Field checks shared by the two Add Vendor forms (Vendors page sheet and
// AddVendorModalV2). Every problem is reported at once, next to its field —
// an email the accounting software would refuse is caught here instead of
// coming back as a raw provider error after the round trip.

export interface VendorFieldErrors {
  name?: string;
  glAccount?: string;
  email?: string;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateVendorForm({
  name,
  glAccountId,
  email,
  requireGlAccount,
}: {
  name: string;
  glAccountId: string;
  email: string;
  requireGlAccount: boolean;
}): VendorFieldErrors {
  const errors: VendorFieldErrors = {};
  if (!name.trim()) errors.name = "Vendor name is required";
  if (requireGlAccount && !glAccountId) errors.glAccount = "GL account is required to create a vendor";
  if (email.trim() && !EMAIL_PATTERN.test(email.trim())) errors.email = "Enter a valid email address, e.g. billing@vendor.com";
  return errors;
}

export const hasVendorErrors = (errors: VendorFieldErrors) => Object.values(errors).some(Boolean);

// The currency a new vendor starts in: the company's home currency when the
// backend knows it, else the first option.
export const defaultVendorCurrency = (homeCurrency: string | null | undefined, options: readonly string[]) =>
  homeCurrency && options.includes(homeCurrency) ? homeCurrency : options[0];
