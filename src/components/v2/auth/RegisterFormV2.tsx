"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { PasswordInput } from "@/components/v2/ui/PasswordInput";
import { SelectDropdown } from "@/components/v2/ui/SelectDropdown";
import { registerUser } from "@/store/auth/authApi";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import { COUNTRY_CODES } from "@/lib/countryCodes";

import { GoogleSignInButton } from "../../auth/GoogleSignInButton";

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

export function RegisterFormV2() {
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
    <div className="grid min-h-dvh grid-cols-1 bg-page lg:grid-cols-2">
      <div className="hidden flex-col items-center justify-center gap-[var(--space-xl)] bg-surface-alt px-[var(--space-xl)] py-[var(--space-xxl)] lg:flex">
        <div className="flex w-full max-w-sm flex-col items-center gap-[var(--space-lg)] text-center">
          <Image
            src="/Mobile login-amico.svg"
            alt="Illustration of a person signing in on a mobile phone"
            width={500}
            height={500}
            priority
            unoptimized
            className="h-auto w-full max-w-[360px]"
          />
          <div>
            <h2 className="text-h2 font-bold text-content-primary">Get started in minutes</h2>
            <p className="mt-[var(--space-sm)] text-body text-content-secondary">
              Create your account to scan, verify, and sync invoices automatically.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center px-[var(--space-lg)] py-[var(--space-xxl)]">
        <div className="w-full max-w-md">
          <div className="mb-[var(--space-xl)] text-center">
            <h1 className="text-h1 font-bold text-content-primary">Create Account</h1>
            <p className="mt-[var(--space-sm)] text-body text-content-secondary">
              Start using Scantrix to scan, verify, and sync business documents.
            </p>
          </div>

          {inviteToken && (
            <div className="mb-[var(--space-md)] rounded-md border border-content-primary bg-content-primary/5 p-[var(--space-sm)] text-center text-body-sm font-semibold text-content-primary">
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
                <label className="text-body-sm font-semibold text-content-primary">Phone</label>
                <div className="mt-[var(--space-xs)] flex gap-[var(--space-xs)]">
                  <SelectDropdown
                    aria-label="Country code"
                    className="w-28"
                    value={countryCode}
                    disabled={loading}
                    onChange={(e) => setCountryCode(e.target.value)}
                  >
                    {COUNTRY_CODES.map((c) => (
                      <option key={`${c.name}-${c.code}`} value={c.code}>
                        {c.name} ({c.code})
                      </option>
                    ))}
                  </SelectDropdown>
                  <input
                    name="phone"
                    type="tel"
                    autoComplete="tel-national"
                    placeholder="10-digit phone number"
                    value={values.phone}
                    disabled={loading}
                    onChange={(e) => handleChange("phone", e.target.value)}
                    onBlur={() => handleBlur("phone")}
                    className={`h-[50px] flex-1 rounded-md border bg-surface px-[var(--space-md)] text-body text-content-primary placeholder:text-content-secondary focus:outline-none focus:ring-2 focus:ring-accent/40 ${
                      touched.phone && errors.phone ? "border-status-danger-border" : "border-border"
                    }`}
                  />
                </div>
                {touched.phone && errors.phone && (
                  <p className="mt-[var(--space-xs)] text-caption font-medium text-status-danger-text">
                    {errors.phone}
                  </p>
                )}
              </div>

              <PasswordInput
                label="Password"
                name="password"
                autoComplete="new-password"
                value={values.password}
                disabled={loading}
                maxLength={50}
                error={touched.password ? errors.password : ""}
                onChange={(e) => handleChange("password", e.target.value)}
                onBlur={() => handleBlur("password")}
              />

              {formError && (
                <div className="rounded-md border-l-4 border-status-danger-border bg-status-danger-bg px-[var(--space-sm)] py-[var(--space-xs)] text-body-sm font-medium text-status-danger-text">
                  {formError}
                </div>
              )}

              <Button type="submit" loading={loading} disabled={!isFormValid || loading}>
                Create Account
              </Button>

              <div className="flex items-center gap-[var(--space-md)]">
                <div className="h-px flex-1 bg-border" />
                <span className="text-caption text-content-secondary">or continue with</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <GoogleSignInButton onSuccess={() => router.push("/dashboard")} onError={setFormError} />
            </form>
          </Card>
        </div>

        <div className="mt-[var(--space-lg)] flex items-center gap-[var(--space-xs)] border-t border-border pt-[var(--space-lg)] text-body-sm">
          <span className="text-content-secondary">Already have an account?</span>
          <Link href="/v2/login" className="font-bold text-accent">
            Log in
          </Link>
        </div>
      </div>
    </div>
  );
}
