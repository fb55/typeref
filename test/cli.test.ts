import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const cli = join(import.meta.dirname, "..", "src", "cli.ts");

describe("typeref", () => {
  it("reads its configuration from package.json without a file", () => {
    const directory = mkdtempSync(join(tmpdir(), "typeref-cli-"));
    try {
      writeFileSync(
        join(directory, "package.json"),
        JSON.stringify({
          name: "pkg",
          types: "index.d.ts",
          typeref: { out: "site", format: "markdown" },
        }),
      );
      writeFileSync(
        join(directory, "index.d.ts"),
        "export declare const a: number;\n",
      );
      const result = spawnSync(process.execPath, [cli], {
        cwd: directory,
        encoding: "utf8",
      });
      expect([
        result.stdout,
        existsSync(join(directory, "site", "variables", "a.md")),
      ]).toStrictEqual(["Wrote 2 files to site.\n", true]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

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
