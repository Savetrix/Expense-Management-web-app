"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { PasswordInput } from "@/components/v2/ui/PasswordInput";
import { loginUser } from "@/store/auth/authApi";
import { acceptQBInvite } from "@/store/quickBooks/quickBooksApi";
import { getPendingInviteToken, clearPendingInviteToken } from "@/lib/storage";
import { showToast } from "@/lib/dialogManager";
import { useAppDispatch, useAppSelector } from "@/store/hooks";

import { GoogleSignInButton } from "../../auth/GoogleSignInButton";

const isValidEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());

const validateEmail = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "Email is required";
  if (!isValidEmail(trimmed)) return "Enter a valid email address";
  return "";
};

const validatePassword = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return "Password is required";
  if (trimmed.length < 6) return "Password must be at least 6 characters";
  return "";
};

export function LoginFormV2() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const loading = useAppSelector((state) => state.auth.loading);

  const sessionExpired = searchParams.get("sessionExpired") === "true";
  const fromInvite = searchParams.get("fromInvite") === "true";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [emailError, setEmailError] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [touched, setTouched] = useState({ email: false, password: false });
  const [formError, setFormError] = useState("");

  const isFormValid = isValidEmail(email) && password.trim().length >= 6;

  const goToDashboard = async () => {
    const pendingToken = await getPendingInviteToken();
    if (pendingToken) {
      const result = await dispatch(acceptQBInvite({ inviteToken: pendingToken }));
      await clearPendingInviteToken();
      if (!acceptQBInvite.fulfilled.match(result)) {
        const payload = result.payload as { message?: string } | undefined;
        showToast(
          payload?.message ||
            "We couldn't accept your invite automatically. Please ask for a new invite link.",
          "error",
        );
      }
    }
    router.push("/dashboard");
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();

    const currentEmailError = validateEmail(email);
    const currentPasswordError = validatePassword(password);
    setTouched({ email: true, password: true });
    setEmailError(currentEmailError);
    setPasswordError(currentPasswordError);
    if (currentEmailError || currentPasswordError) return;

    setFormError("");
    const result = await dispatch(
      loginUser({ email: email.trim().toLowerCase(), password: password.trim() }),
    );

    if (loginUser.fulfilled.match(result)) {
      await goToDashboard();
    } else {
      const payload = result.payload;
      setFormError(typeof payload === "string" ? payload : "Login failed");
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
            <h2 className="text-h2 font-bold text-content-primary">
              Manage your expenses, effortlessly
            </h2>
            <p className="mt-[var(--space-sm)] text-body text-content-secondary">
              Scan, review, and track invoices with AI — all in one place.
            </p>
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center px-[var(--space-lg)] py-[var(--space-xxl)]">
        <div className="w-full max-w-md">
          <div className="mb-[var(--space-xl)] text-center">
            <h1 className="text-h1 font-bold text-content-primary">Welcome to Scantrix</h1>
            <p className="mt-[var(--space-sm)] text-body text-content-secondary">
              Sign in to upload and manage financial documents with AI.
            </p>
          </div>

          {sessionExpired && (
            <div className="mb-[var(--space-md)] rounded-md border border-status-warning-border bg-status-warning-bg p-[var(--space-sm)] text-center text-body-sm font-semibold text-status-warning-text">
              Your session has expired. Please login again.
            </div>
          )}

          {fromInvite && (
            <div className="mb-[var(--space-md)] rounded-md border border-content-primary bg-content-primary/5 p-[var(--space-sm)] text-center text-body-sm font-semibold text-content-primary">
              Log in to accept your team invite.
            </div>
          )}

          <Card>
            <form className="flex flex-col gap-[var(--space-md)]" onSubmit={handleSubmit} noValidate>
              <Input
                label="Email"
                type="email"
                name="email"
                autoComplete="email"
                placeholder="Enter your email"
                value={email}
                disabled={loading}
                error={touched.email ? emailError : ""}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (touched.email) setEmailError(validateEmail(event.target.value));
                }}
                onBlur={() => {
                  setTouched((prev) => ({ ...prev, email: true }));
                  setEmailError(validateEmail(email));
                }}
              />

              <div>
                <PasswordInput
                  label="Password"
                  name="password"
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  disabled={loading}
                  maxLength={50}
                  error={touched.password ? passwordError : ""}
                  onChange={(event) => {
                    const value = event.target.value;
                    setPassword(value);
                    if (touched.password) setPasswordError(validatePassword(value));
                  }}
                  onBlur={() => {
                    setTouched((prev) => ({ ...prev, password: true }));
                    setPasswordError(validatePassword(password));
                  }}
                />
                <div className="mt-[var(--space-xs)] text-right">
                  <Link href="/forgot-password" className="text-caption font-semibold text-accent">
                    Forgot password?
                  </Link>
                </div>
              </div>

              {formError && (
                <div className="rounded-md border-l-4 border-status-danger-border bg-status-danger-bg px-[var(--space-sm)] py-[var(--space-xs)] text-body-sm font-medium text-status-danger-text">
                  {formError}
                </div>
              )}

              <Button type="submit" loading={loading} disabled={!isFormValid || loading}>
                Login
              </Button>

              <div className="flex items-center gap-[var(--space-md)]">
                <div className="h-px flex-1 bg-border" />
                <span className="text-caption text-content-secondary">or continue with</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <GoogleSignInButton onSuccess={goToDashboard} onError={setFormError} />
            </form>
          </Card>
        </div>

        <div className="mt-[var(--space-lg)] flex items-center gap-[var(--space-xs)] border-t border-border pt-[var(--space-lg)] text-body-sm">
          <span className="text-content-secondary">Don&apos;t have an account?</span>
          <Link href="/v2/register" className="font-bold text-accent">
            Sign Up
          </Link>
        </div>
      </div>
    </div>
  );
}
