import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const cli = join(import.meta.dirname, "..", "src", "cli.ts");

describe("typeref", () => {
  it("rejects configurations without a default export", () => {
    const directory = mkdtempSync(join(tmpdir(), "typeref-cli-"));
    try {
      writeFileSync(
        join(directory, "typeref.config.mjs"),
        "export const config = {};\n",
      );
      const result = spawnSync(process.execPath, [cli], {
        cwd: directory,
        encoding: "utf8",
      });
      expect([result.status, result.stderr]).toStrictEqual([
        1,
        `typeref: ${join(directory, "typeref.config.mjs")} must export the configuration as its default.\n`,
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
