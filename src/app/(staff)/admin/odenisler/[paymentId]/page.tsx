import { notFound } from "next/navigation";
import { ConfirmAction } from "@/components/admin/confirm-action";
import { formatDateAz } from "@/lib/format";
import { ADMIN } from "@/lib/marketplace/labels";
import { requireAdminPage } from "@/lib/admin/admin-page";
import { adminPaymentAttemptHistory } from "@/services/admin";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Payment operational detail: safe attempt history + the accepted
 * provider verification/reconcile action. Refund initiation is
 * BLOCKED pending an official provider contract (see docs) — nothing
 * here can mark a payment REFUNDED directly.
 */
export default async function AdminPaymentDetailPage({
  params,
}: {
  params: Promise<{ paymentId: string }>;
}) {
  const { paymentId } = await params;
  if (!UUID.test(paymentId)) notFound();
  await requireAdminPage(`/admin/odenisler/${paymentId}`);
  const attempts = await adminPaymentAttemptHistory(paymentId);
  return (
    <div className="py-6" data-testid="admin-payment-detail">
      <h1 className="text-xl font-bold text-navy">{ADMIN.payments}</h1>
      <div className="mt-3 max-w-xl space-y-4">
        <ConfirmAction
          label={ADMIN.verifyPayment}
          title={ADMIN.verifyConfirm}
          url={`/api/v1/admin/payments/${paymentId}/verify`}
          variant="primary"
          testid="payment-verify"
        />
        <p className="rounded-lg border border-line bg-white px-3 py-2 text-xs text-muted" data-testid="refund-blocked">
          {ADMIN.refundBlocked}
        </p>
        <section aria-label={ADMIN.attempts} className="rounded-card border border-line bg-white p-4 text-sm">
          <h2 className="font-semibold text-navy">{ADMIN.attempts}</h2>
          <ul className="mt-2 space-y-1" data-testid="payment-attempts">
            {attempts.length === 0 ? <li className="text-muted">—</li> : null}
            {attempts.map((a, i) => (
              <li key={i} className="text-muted">
                {a.provider} · {a.providerOrderId ?? "—"} · {a.providerStatus}
                {a.isTerminal ? " · bitib" : " · aktiv"} · {formatDateAz(a.createdAt)}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
