import { resolve } from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/compile-fixtures.ts"],
    // Fixtures link to no repository, wherever typeref is checked out.
    env: { GIT_CEILING_DIRECTORIES: resolve(import.meta.dirname, "test") },
    coverage: { include: ["src/**"] },
  },
});
