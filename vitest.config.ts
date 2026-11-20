import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/compile-fixtures.ts"],
    coverage: { include: ["src/**"] },
  },
});
