import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

import { build } from "../src/build.ts";

const fixture = join(import.meta.dirname, "fixtures", "package");

describe("build", () => {
  it("removes what earlier builds wrote, and nothing else", async () => {
    const out = mkdtempSync(join(tmpdir(), "typeref-build-"));
    try {
      writeFileSync(join(out, ".typeref-files"), JSON.stringify(["stale.md"]));
      writeFileSync(join(out, "stale.md"), "");
      writeFileSync(join(out, "guide.md"), "");
      const files = await build(relative(process.cwd(), fixture), {
        out,
        format: "markdown",
      });
      expect([
        existsSync(join(out, "stale.md")),
        existsSync(join(out, "guide.md")),
        JSON.parse(readFileSync(join(out, ".typeref-files"), "utf8")),
      ]).toStrictEqual([false, true, files]);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("refuses to replace files it did not write", async () => {
    const out = mkdtempSync(join(tmpdir(), "typeref-build-"));
    try {
      writeFileSync(join(out, "index.md"), "Handwritten.");
      await expect(build(fixture, { out, format: "markdown" })).rejects.toThrow(
        "was not written by typeref",
      );
      expect(readFileSync(join(out, "index.md"), "utf8")).toBe("Handwritten.");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("replaces what a failed build wrote", async () => {
    const out = mkdtempSync(join(tmpdir(), "typeref-build-"));
    try {
      // A file in the way of a directory fails the build after the index.
      writeFileSync(join(out, "modules"), "");
      await expect(build(fixture, { out, format: "markdown" })).rejects.toThrow(
        "EEXIST",
      );
      rmSync(join(out, "modules"));
      await expect(
        build(fixture, { out, format: "markdown" }),
      ).resolves.toContain("index.md");
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
