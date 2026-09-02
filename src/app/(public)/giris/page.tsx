import type { Metadata } from "next";
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
