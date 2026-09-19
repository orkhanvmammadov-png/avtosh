import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Container } from "@/components/ui/container";
import { getCurrentAuthFromCookies } from "@/auth/current-user";
import { AxinFlow } from "@/components/seller/axin/axin-flow";
import { PendingEditView } from "@/components/seller/axin/pending-edit-view";
import { isApiError } from "@/lib/api/errors";
import { SELLER, UI } from "@/lib/marketplace/labels";
import { getEditView } from "@/services/listing-edit";

export const metadata: Metadata = {
  title: `${SELLER.editHeader} — ${UI.brand}`,
  robots: { index: false },
};

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * O.12 seller edit route — explicit EDIT mode (never inferred). The
 * page READS the open revision only; creation happens through the
 * explicit POST from the "Redaktə et" action (a GET/prefetch must
 * never create state). No open revision → back to My Listings.
 */
export default async function EditListingPage({
  params,
  searchParams,
}: {
  params: Promise<{ listingId: string }>;
  searchParams: Promise<{ aktivlesdir?: string }>;
}) {
  const { listingId } = await params;
  if (!UUID.test(listingId)) {
    notFound();
  }
  const auth = await getCurrentAuthFromCookies();
  if (auth === null) {
    redirect(`/giris?return_to=${encodeURIComponent(`/profil/elanlar/${listingId}/redakte`)}`);
  }
  if (auth.user.status === "BLOCKED") {
    // blocked sellers may read state, never mutate (the APIs enforce
    // the same rule server-side)
    return (
      <Container>
        <div className="py-16 text-center" data-testid="seller-blocked">
          <h1 className="text-xl font-bold tracking-[-0.01em] text-ink md:text-2xl">{SELLER.blockedTitle}</h1>
          <p className="mt-2 text-sm text-muted">{SELLER.blockedHint}</p>
        </div>
      </Container>
    );
  }

  let view;
  try {
    view = await getEditView(auth, listingId);
  } catch (error) {
    if (isApiError(error) && error.code === "LISTING_NOT_FOUND") {
      notFound();
    }
    throw error;
  }
  if (view === null) {
    // edit no longer available (cancelled/decided elsewhere, or never
    // started) — server state wins, back to the cards
    redirect("/profil/elanlar");
  }

  if (view.context.editStatus === "PENDING_MODERATION") {
    return (
      <PendingEditView listing={view.listing} submittedAt={view.context.editSubmittedAt} />
    );
  }

  const { aktivlesdir } = await searchParams;
  const feedback =
    view.context.moderationFeedback === null
      ? null
      : {
          decision: "CORRECTION_REQUESTED",
          reasonCode: view.context.moderationFeedback.reasonCode,
          note: view.context.moderationFeedback.note,
          reviewedAt: "",
        };
  return (
    <AxinFlow
      initial={view.listing}
      feedback={feedback}
      authPhoneE164={auth.user.phone_e164}
      authDisplayName={auth.user.display_name}
      edit={{ context: view.context, activateIntent: aktivlesdir === "1" }}
    />
  );
}
