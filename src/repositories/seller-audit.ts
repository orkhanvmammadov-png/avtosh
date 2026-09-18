import type { Sql } from "@/lib/server/db/client";

/** Append-only audit entries for seller lifecycle actions (O.12). */
export async function insertSellerAudit(
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
    values (${input.actorUserId}, 'USER', ${input.action}, 'listing',
      ${input.entityId}, ${sql.json(input.afterData)})
  `;
}
