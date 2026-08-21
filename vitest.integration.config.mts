import path from "node:path";
import { defineConfig } from "vitest/config";
import { BaseSequencer, type TestSpecification } from "vitest/node";

/**
 * The integration files share ONE ephemeral database by accepted
 * design (fileParallelism: false), so file order is part of the test
 * contract. Vitest's default sequencer orders by cached durations,
 * which made local order differ from CI and masked an order-dependent
 * defect. Alphabetical order is deterministic everywhere.
 */
class AlphabeticalSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
}

// Integration tests run against a real ephemeral PostgreSQL provided
// by scripts/db/with-temp-postgres.sh (which exports DATABASE_URL).
// Run via: pnpm test:integration:db
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/integration/**/*.test.ts"],
    // One shared database instance — keep files sequential, in a
    // deterministic (alphabetical) order so local runs reproduce CI.
    fileParallelism: false,
    sequence: { sequencer: AlphabeticalSequencer },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      // Test-only auth secrets/tuning — NOT production values. The
      // pepper is deliberately a committed dummy: real peppers live
      // only in deployment secret stores.
      OTP_PEPPER: "integration-test-pepper-0123456789abcdef",
      OTP_MIN_INTERVAL_SECONDS: "0",
      OTP_RESEND_COOLDOWN_SECONDS: "0",
    },
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
