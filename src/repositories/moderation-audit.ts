import type { Sql } from "@/lib/server/db/client";

/** Append-only audit entries for staff moderation actions. */
export async function insertModerationAudit(
  sql: Sql,
  input: {
    actorUserId: string;
    action: string;
    entityId: string;
    afterData: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  await sql`
    insert into audit_logs (actor_user_id, actor_type, action, entity_type, entity_id, after_data)
    values (${input.actorUserId}, 'MODERATOR', ${input.action}, 'listing',
      ${input.entityId}, ${sql.json(input.afterData)})
  `;
}
