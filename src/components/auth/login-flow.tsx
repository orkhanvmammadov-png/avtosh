"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { UI } from "@/lib/marketplace/labels";
import { invalidateFavoriteIds } from "@/lib/marketplace/favorites-client";
import { publicFetch, PublicApiError } from "@/lib/marketplace/public-api";

interface ChallengeState {
  challengeId: string;
  phone: string;
  resendAfter: number;
}

const field = "min-h-12 w-full rounded-lg border border-line bg-white px-3 text-base text-navy";

function errorMessage(error: unknown): string {
  if (error instanceof PublicApiError) {
    switch (error.code) {
      case "AUTH_INVALID_PHONE": return UI.invalidPhone;
      case "OTP_INVALID": return UI.otpInvalid;
      case "OTP_EXPIRED": return UI.otpExpired;
      case "OTP_LOCKED": return UI.otpLocked;
      case "OTP_RESEND_TOO_SOON":
      case "OTP_RATE_LIMITED": return UI.otpRateLimited;
    }
  }
  return `${UI.errorTitle}. ${UI.errorHint}`;
}

/** Two-step passwordless login on the accepted Phase 4.4 APIs. */
export function LoginFlow({ returnTo }: { returnTo: string | null }) {
  const router = useRouter();
  const [challenge, setChallenge] = useState<ChallengeState | null>(null);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const otpRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  useEffect(() => {
    if (challenge !== null) otpRef.current?.focus();
  }, [challenge]);

  async function requestOtp(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { data } = await publicFetch<{ challenge_id: string; resend_after_seconds: number }>(
        "/api/v1/auth/otp/request",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone }) },
      );
      setChallenge({ challengeId: data.challenge_id, phone, resendAfter: data.resend_after_seconds });
      setCountdown(data.resend_after_seconds);
      setOtp("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    if (challenge === null || countdown > 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await publicFetch<{ resend_after_seconds: number }>(
        "/api/v1/auth/otp/resend",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ challenge_id: challenge.challengeId }) },
      );
      setCountdown(data.resend_after_seconds);
      setOtp("");
      otpRef.current?.focus();
    } catch (err) {
      const message = errorMessage(err);
      setError(message);
      if (err instanceof PublicApiError && (err.code === "OTP_EXPIRED" || err.code === "OTP_INVALID")) {
        setChallenge(null); // start over with a fresh code request
      }
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (challenge === null) return;
    setBusy(true);
    setError(null);
    try {
      const { data } = await publicFetch<{ return_to: string | null }>(
        "/api/v1/auth/otp/verify",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ challenge_id: challenge.challengeId, otp, ...(returnTo ? { return_to: returnTo } : {}) }),
        },
      );
      invalidateFavoriteIds();
      // The SERVER-sanitized return path is authoritative (open-redirect safe).
      router.push(data.return_to ?? "/profil");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof PublicApiError && (err.code === "OTP_EXPIRED" || err.code === "OTP_LOCKED")) {
        setChallenge(null);
        setOtp("");
      }
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-card border border-line bg-white p-6 shadow-sm" data-testid="login-flow">
      <h1 className="text-xl font-bold text-navy">{UI.loginTitle}</h1>
      {challenge === null ? (
        <form onSubmit={requestOtp} className="mt-4 space-y-4" aria-label={UI.loginTitle}>
          <p className="text-sm text-muted">{UI.loginHint}</p>
          <label className="block text-sm font-medium text-navy">
            <span className="mb-1 block">{UI.phoneLabel}</span>
            <input
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              required
              placeholder={UI.phonePlaceholder}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className={field}
              data-testid="login-phone"
            />
          </label>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" disabled={busy} className="w-full" data-testid="login-request">
            {busy ? UI.loading : UI.sendCode}
          </Button>
        </form>
      ) : (
        <form onSubmit={verify} className="mt-4 space-y-4" aria-label={UI.otpLabel}>
          <p className="text-sm text-muted">
            {UI.otpSentTo} <strong className="text-navy">{challenge.phone}</strong>
          </p>
          <label className="block text-sm font-medium text-navy">
            <span className="mb-1 block">{UI.otpLabel}</span>
            <input
              ref={otpRef}
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/[^0-9]/g, ""))}
              className={`${field} text-center text-2xl tracking-[0.5em]`}
              data-testid="login-otp"
            />
          </label>
          <p className="text-xs text-muted">{UI.otpHint}</p>
          {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
          <Button type="submit" disabled={busy || otp.length !== 6} className="w-full" data-testid="login-verify">
            {busy ? UI.loading : UI.verify}
          </Button>
          <div className="flex items-center justify-between text-sm">
            <button type="button" onClick={() => { setChallenge(null); setError(null); }} className="min-h-12 rounded-lg px-2 text-muted hover:text-navy" data-testid="login-change-phone">
              {UI.changePhone}
            </button>
            <button
              type="button"
              onClick={() => void resend()}
              disabled={countdown > 0 || busy}
              aria-live="polite"
              className="min-h-12 rounded-lg px-2 font-medium text-primary disabled:text-muted"
              data-testid="login-resend"
            >
              {countdown > 0 ? `${UI.resendIn} ${countdown}s` : UI.resend}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
