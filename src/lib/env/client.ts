import { z } from "zod";

/**
 * Client-safe environment contract.
 *
 * Only NEXT_PUBLIC_* values may appear here, and each one must be
 * referenced literally (process.env.NEXT_PUBLIC_X) so Next.js can
 * inline it at build time. Secrets must never be added to this module.
 */
const clientEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.url().optional(),
});

export type ClientEnv = z.infer<typeof clientEnvSchema>;

const parsed = clientEnvSchema.safeParse({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
});

if (!parsed.success) {
  throw new Error(
    `Invalid client environment configuration: ${parsed.error.issues
      .map((issue) => issue.path.join("."))
      .join(", ")}`,
  );
}

export const clientEnv: ClientEnv = parsed.data;
