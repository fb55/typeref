/**
 * Compiles the fixtures' declarations, as their packages would, before the
 * tests: `.d.ts` files with declaration maps, in a temporary directory.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    fixtures: string;
  }
}

export default function setup(project: TestProject): () => void {
  const out = mkdtempSync(join(tmpdir(), "typeref-fixtures-"));
  const result = spawnSync(
    join(import.meta.dirname, "../node_modules/.bin/tsc"),
    ["-p", join(import.meta.dirname, "fixtures"), "--outDir", out],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `Compiling the fixtures failed:\n${result.stdout}${result.stderr}`,
    );
  }
  project.provide("fixtures", out);
  return () => rmSync(out, { recursive: true, force: true });
}
