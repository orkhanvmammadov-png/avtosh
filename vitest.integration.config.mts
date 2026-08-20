import path from "node:path";
import { defineConfig } from "vitest/config";

// Integration tests run against a real ephemeral PostgreSQL provided
// by scripts/db/with-temp-postgres.sh (which exports DATABASE_URL).
// Run via: pnpm test:integration:db
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // One shared database instance — keep files sequential.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  resolve: {
    alias: {
      "server-only": path.resolve(
        import.meta.dirname,
        "tests/helpers/server-only-stub.ts",
      ),
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
