import "server-only";
import { z } from "zod";

/**
 * Server-side environment contract.
 *
 * Every variable here is optional in Phase 4.1 so the application runs
 * locally without infrastructure. Later phases tighten individual
 * fields to required as the corresponding integration is implemented.
 *
 * These values must NEVER be exposed through NEXT_PUBLIC_* or imported
 * from client components — the "server-only" import makes any client
 * import a build-time error.
 */
const serverEnvSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  DATABASE_URL: z.url().optional(),
  SUPABASE_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().min(1).optional(),
  WHATSAPP_WEBHOOK_SECRET: z.string().min(1).optional(),
  PAYMENT_API_KEY: z.string().min(1).optional(),
  PAYMENT_WEBHOOK_SECRET: z.string().min(1).optional(),
  SENTRY_DSN_SERVER: z.url().optional(),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

let cached: ServerEnv | null = null;

/**
 * Parses and caches the server environment. Throws with a safe,
 * variable-name-only message on invalid configuration — values are
 * never included in the error.
 */
export function serverEnv(): ServerEnv {
  if (cached === null) {
    const parsed = serverEnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const invalidKeys = parsed.error.issues
        .map((issue) => issue.path.join("."))
        .join(", ");
      throw new Error(
        `Invalid server environment configuration: ${invalidKeys}`,
      );
    }
    cached = parsed.data;
  }
  return cached;
}
