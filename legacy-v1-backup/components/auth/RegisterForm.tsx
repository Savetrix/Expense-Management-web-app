"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { registerUser } from "@/store/auth/authApi";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { COUNTRY_CODES } from "@/lib/countryCodes";

import { GoogleSignInButton } from "./GoogleSignInButton";

type FieldName = "firstName" | "lastName" | "email" | "phone" | "password";

const validators: Record<FieldName, (value: string) => string> = {
  firstName: (v) => {
    if (!v.trim()) return "First name is required";
    if (v.trim().length < 2) return "First name must be at least 2 characters";
    return "";
  },
  lastName: (v) => {
    if (!v.trim()) return "Last name is required";
    if (v.trim().length < 2) return "Last name must be at least 2 characters";
    return "";
  },
  email: (v) => {
    if (!v.trim()) return "Email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim())) return "Enter a valid email address";
    return "";
  },
  phone: (v) => {
    const digits = v.replace(/\D/g, "");
    if (!digits) return "Phone number is required";
    if (digits.length < 10) return "Enter a valid 10-digit phone number";
    return "";
  },
  password: (v) => {
    if (!v) return "Password is required";
    if (v.length < 6) return "Password must be at least 6 characters";
    return "";
  },
};

export function RegisterForm() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const loading = useAppSelector((state) => state.auth.loading);

  // /register?inviteToken=xxx deep link — carried through to Verify-OTP,
  // then to acceptQBInvite on OTP success. Reference: Scantrix_v2
  // CreateAccountScreen.tsx.
  const inviteToken = searchParams.get("inviteToken") ?? "";

  const [values, setValues] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    password: "",
  });
  const [countryCode, setCountryCode] = useState("+91");
  const [errors, setErrors] = useState<Record<FieldName, string>>({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    password: "",
  });
  const [touched, setTouched] = useState<Record<FieldName, boolean>>({
    firstName: false,
    lastName: false,
    email: false,
    phone: false,
    password: false,
  });
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState("");

  const handleChange = (field: FieldName, raw: string) => {
    let sanitized = raw;
    if (field === "phone") sanitized = raw.replace(/\D/g, "").slice(0, 10);

    setValues((prev) => ({ ...prev, [field]: sanitized }));
    if (touched[field]) {
      setErrors((prev) => ({ ...prev, [field]: validators[field](sanitized) }));
    }
  };

  const handleBlur = (field: FieldName) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
    setErrors((prev) => ({ ...prev, [field]: validators[field](values[field]) }));
  };

  const isFormValid =
    values.firstName.trim().length >= 2 &&
    values.lastName.trim().length >= 2 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim()) &&
    values.phone.replace(/\D/g, "").length >= 10 &&
    values.password.length >= 6;

  const goToVerifyOtp = (email: string) => {
    const params = new URLSearchParams({ email });
    if (inviteToken) params.set("inviteToken", inviteToken);
    router.push(`/register/verify-otp?${params.toString()}`);
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    const newErrors = {
      firstName: validators.firstName(values.firstName),
      lastName: validators.lastName(values.lastName),
      email: validators.email(values.email),
      phone: validators.phone(values.phone),
      password: validators.password(values.password),
    };
    setTouched({ firstName: true, lastName: true, email: true, phone: true, password: true });
    setErrors(newErrors);
    if (Object.values(newErrors).some(Boolean)) return;

    setFormError("");
    const email = values.email.trim().toLowerCase();
    const result = await dispatch(
      registerUser({
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        email,
        phone: countryCode + values.phone.replace(/\D/g, ""),
        password: values.password,
        userType: "business",
      }),
    );

    if (registerUser.fulfilled.match(result)) {
      goToVerifyOtp(email);
    } else {
      const payload = result.payload;
      setFormError(typeof payload === "string" ? payload : "Registration failed");
    }
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background-soft px-[var(--space-lg)] py-[var(--space-xxl)]">
      <div className="w-full max-w-md">
        <div className="mb-[var(--space-xl)] text-center">
          <h1 className="text-h1 font-bold text-trust-navy">Create Account</h1>
          <p className="mt-[var(--space-sm)] text-body text-text-secondary">
            Start using Scantrix to scan, verify, and sync business documents.
          </p>
        </div>

        {inviteToken && (
          <div className="mb-[var(--space-md)] rounded-md border border-trust-navy bg-trust-navy/5 p-[var(--space-sm)] text-center text-body-sm font-semibold text-trust-navy">
            You&apos;re joining a team — finish signing up to accept your invite.
          </div>
        )}

        <Card>
          <form className="flex flex-col gap-[var(--space-md)]" onSubmit={handleSubmit} noValidate>
            <div className="grid grid-cols-2 gap-[var(--space-md)]">
              <Input
                label="First name"
                name="firstName"
                autoComplete="given-name"
                value={values.firstName}
                disabled={loading}
                error={touched.firstName ? errors.firstName : ""}
                onChange={(e) => handleChange("firstName", e.target.value)}
                onBlur={() => handleBlur("firstName")}
              />
              <Input
                label="Last name"
                name="lastName"
                autoComplete="family-name"
                value={values.lastName}
                disabled={loading}
                error={touched.lastName ? errors.lastName : ""}
                onChange={(e) => handleChange("lastName", e.target.value)}
                onBlur={() => handleBlur("lastName")}
              />
            </div>

            <Input
              label="Email"
              type="email"
              name="email"
              autoComplete="email"
              value={values.email}
              disabled={loading}
              error={touched.email ? errors.email : ""}
              onChange={(e) => handleChange("email", e.target.value)}
              onBlur={() => handleBlur("email")}
            />

            <div>
              <label className="text-body-sm font-semibold text-trust-navy">Phone</label>
              <div className="mt-[var(--space-xs)] flex gap-[var(--space-xs)]">
                <select
                  value={countryCode}
                  disabled={loading}
                  onChange={(e) => setCountryCode(e.target.value)}
                  className="h-[50px] w-28 rounded-md border border-border bg-white px-[var(--space-xs)] text-body-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40"
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={`${c.name}-${c.code}`} value={c.code}>
                      {c.name} ({c.code})
                    </option>
                  ))}
                </select>
                <input
                  name="phone"
                  type="tel"
                  autoComplete="tel-national"
                  placeholder="10-digit phone number"
                  value={values.phone}
                  disabled={loading}
                  onChange={(e) => handleChange("phone", e.target.value)}
                  onBlur={() => handleBlur("phone")}
                  className={`h-[50px] flex-1 rounded-md border bg-white px-[var(--space-md)] text-body text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                    touched.phone && errors.phone ? "border-error" : "border-border"
                  }`}
                />
              </div>
              {touched.phone && errors.phone && (
                <p className="mt-[var(--space-xs)] text-caption font-medium text-error">
                  {errors.phone}
                </p>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-body-sm font-semibold text-trust-navy">
                  Password
                </label>
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="-m-2 flex items-center gap-1 p-2 text-caption font-semibold text-primary"
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? <EyeOff size={16} strokeWidth={2} /> : <Eye size={16} strokeWidth={2} />}
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={values.password}
                disabled={loading}
                maxLength={50}
                onChange={(e) => handleChange("password", e.target.value)}
                onBlur={() => handleBlur("password")}
                className={`mt-[var(--space-xs)] h-[50px] w-full rounded-md border bg-white px-[var(--space-md)] text-body text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                  touched.password && errors.password ? "border-error" : "border-border"
                }`}
              />
              {touched.password && errors.password && (
                <p className="mt-[var(--space-xs)] text-caption font-medium text-error">
                  {errors.password}
                </p>
              )}
            </div>

            {formError && (
              <div className="rounded-md border-l-4 border-error bg-error/10 px-[var(--space-sm)] py-[var(--space-xs)] text-body-sm font-medium text-error">
                {formError}
              </div>
            )}

            <Button type="submit" loading={loading} disabled={!isFormValid || loading}>
              Create Account
            </Button>

            <div className="flex items-center gap-[var(--space-md)]">
              <div className="h-px flex-1 bg-border" />
              <span className="text-caption text-text-secondary">or continue with</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <GoogleSignInButton onSuccess={() => router.push("/dashboard")} onError={setFormError} />
          </form>
        </Card>
      </div>

      <div className="mt-[var(--space-lg)] flex items-center gap-[var(--space-xs)] border-t border-border pt-[var(--space-lg)] text-body-sm">
        <span className="text-text-secondary">Already have an account?</span>
        <Link href="/login" className="font-bold text-primary">
          Log in
        </Link>
      </div>
    </div>
  );
}
