import { ModeratorQueueList } from "@/components/moderator/queue-list";
import { STAFF } from "@/lib/marketplace/labels";
import { requireStaffPage } from "@/lib/moderator/staff-page";
import { getModerationQueue } from "@/services/moderation";

export const dynamic = "force-dynamic";

/** Moderation queue: server-rendered first page, cursor continuation. */
export default async function ModeratorQueuePage() {
  await requireStaffPage("/moderator/elanlar");
  const page = await getModerationQueue({ limit: 20 });
  return (
    <div className="py-6" data-testid="moderator-queue-page">
      <h1 className="text-xl font-bold tracking-[-0.01em] text-ink md:text-2xl">{STAFF.queue}</h1>
      <ModeratorQueueList initialItems={page.items} initialCursor={page.nextCursor} />
    </div>
  );
}
