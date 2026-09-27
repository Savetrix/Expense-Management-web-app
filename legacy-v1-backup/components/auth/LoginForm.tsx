"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { FormEvent, useState } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Card } from "@/components/ui/Card";
import { loginUser } from "@/store/auth/authApi";
import { acceptQBInvite } from "@/store/quickBooks/quickBooksApi";
import { getPendingInviteToken, clearPendingInviteToken } from "@/lib/storage";
import { showToast } from "@/lib/dialogManager";
import { useAppDispatch, useAppSelector } from "@/store/hooks";

import { GoogleSignInButton } from "./GoogleSignInButton";

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

export function LoginForm() {
  const dispatch = useAppDispatch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const loading = useAppSelector((state) => state.auth.loading);

  const sessionExpired = searchParams.get("sessionExpired") === "true";
  const fromInvite = searchParams.get("fromInvite") === "true";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background-soft px-[var(--space-lg)] py-[var(--space-xxl)]">
      <div className="w-full max-w-md">
        <div className="mb-[var(--space-xl)] text-center">
          <h1 className="text-h1 font-bold text-trust-navy">Welcome to Scantrix</h1>
          <p className="mt-[var(--space-sm)] text-body text-text-secondary">
            Sign in to upload and manage financial documents with AI.
          </p>
        </div>

        {sessionExpired && (
          <div className="mb-[var(--space-md)] rounded-md border border-warning bg-warning/10 p-[var(--space-sm)] text-center text-body-sm font-semibold text-warning">
            Your session has expired. Please login again.
          </div>
        )}

        {fromInvite && (
          <div className="mb-[var(--space-md)] rounded-md border border-trust-navy bg-trust-navy/5 p-[var(--space-sm)] text-center text-body-sm font-semibold text-trust-navy">
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
              <div className="flex items-center justify-between">
                <label htmlFor="password" className="text-body-sm font-semibold text-trust-navy">
                  Password
                </label>
                <button
                  type="button"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="-m-2 flex items-center gap-1 p-2 text-caption font-semibold text-primary"
                  onClick={() => setShowPassword((value) => !value)}
                >
                  {showPassword ? <EyeOff size={16} strokeWidth={2} /> : <Eye size={16} strokeWidth={2} />}
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                disabled={loading}
                maxLength={50}
                onChange={(event) => {
                  const value = event.target.value;
                  setPassword(value);
                  if (touched.password) setPasswordError(validatePassword(value));
                }}
                onBlur={() => {
                  setTouched((prev) => ({ ...prev, password: true }));
                  setPasswordError(validatePassword(password));
                }}
                className={`mt-[var(--space-xs)] h-[50px] w-full rounded-md border bg-white px-[var(--space-md)] text-body text-text-primary placeholder:text-text-secondary focus:outline-none focus:ring-2 focus:ring-primary/40 ${
                  touched.password && passwordError ? "border-error" : "border-border"
                }`}
              />
              {touched.password && passwordError && (
                <p className="mt-[var(--space-xs)] text-caption font-medium text-error">
                  {passwordError}
                </p>
              )}
              <div className="mt-[var(--space-xs)] text-right">
                <Link href="/forgot-password" className="text-caption font-semibold text-primary">
                  Forgot password?
                </Link>
              </div>
            </div>

            {formError && (
              <div className="rounded-md border-l-4 border-error bg-error/10 px-[var(--space-sm)] py-[var(--space-xs)] text-body-sm font-medium text-error">
                {formError}
              </div>
            )}

            <Button type="submit" loading={loading} disabled={!isFormValid || loading}>
              Login
            </Button>

            <div className="flex items-center gap-[var(--space-md)]">
              <div className="h-px flex-1 bg-border" />
              <span className="text-caption text-text-secondary">or continue with</span>
              <div className="h-px flex-1 bg-border" />
            </div>

            <GoogleSignInButton onSuccess={goToDashboard} onError={setFormError} />
          </form>
        </Card>
      </div>

      <div className="mt-[var(--space-lg)] flex items-center gap-[var(--space-xs)] border-t border-border pt-[var(--space-lg)] text-body-sm">
        <span className="text-text-secondary">Don&apos;t have an account?</span>
        <Link href="/register" className="font-bold text-primary">
          Sign Up
        </Link>
      </div>
    </div>
  );
}
