import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { isReadOnlyLaunch } from "@/lib/config/launch";
import { LAUNCH } from "@/lib/marketplace/labels";
import { Container } from "@/components/ui/container";
import { redirect } from "next/navigation";
import { getCurrentAuthFromCookies } from "@/auth/current-user";
import { LoginFlow } from "@/components/auth/login-flow";
import { UI } from "@/lib/marketplace/labels";
import { sanitizeReturnTo } from "@/lib/security/return-to";

export const metadata: Metadata = {
  title: `${UI.loginTitle} — ${UI.brand}`,
  robots: { index: false },
};

/**
 * Login page. Already-authenticated visitors are bounced straight to
 * their (server-sanitized) destination; the raw query value is never
 * used for navigation.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ return_to?: string }>;
}) {
  const params = await searchParams;
  const returnTo = sanitizeReturnTo(params.return_to);
  if (isReadOnlyLaunch()) {
    // Read-only launch: login is not available; explain honestly.
    return (
      <Container>
        <div className="mx-auto max-w-md py-10 md:py-16" data-testid="login-readonly-notice">
          <div className="rounded-[10px] border border-line bg-raised px-5 py-6 text-center">
            <h1 className="text-xl font-bold text-ink">{LAUNCH.comingSoonTitle}</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-strong">{LAUNCH.comingSoonHint}</p>
            <Link href="/" className={`${buttonClasses("primary", "px-6")} mt-5`}>
              {UI.backHome}
            </Link>
          </div>
        </div>
      </Container>
    );
  }
  const auth = await getCurrentAuthFromCookies();
  if (auth !== null) {
    redirect(returnTo ?? "/profil");
  }
  return (
    <Container>
      <div className="py-10 md:py-16">
        <LoginFlow returnTo={returnTo} />
      </div>
    </Container>
  );
}
