import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
  },
  resolve: {
    alias: {
      // "server-only" throws outside a React Server environment; unit
      // tests run in plain Node, so it is stubbed out here.
      "server-only": path.resolve(
        import.meta.dirname,
        "tests/helpers/server-only-stub.ts",
      ),
      "@": path.resolve(import.meta.dirname, "src"),
    },
  },
});
