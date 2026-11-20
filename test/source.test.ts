import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { Sources } from "../src/source.ts";

describe("Sources", () => {
  it.each([
    ["git@github.com:o/r.git", "https://github.com/o/r/blob"],
    ["https://gitlab.com/o/r", "https://gitlab.com/o/r/-/blob"],
    ["https://example.com/o/r.git", undefined],
  ])("links files in repositories at %s", (remote, blob) => {
    const root = mkdtempSync(join(tmpdir(), "typeref-"));
    const git = (...args: string[]): string =>
      spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
        cwd: root,
        encoding: "utf8",
      }).stdout.trim();
    git("init", "--quiet");
    git("remote", "add", "origin", remote);
    git("commit", "--quiet", "--allow-empty", "--message", "Start");
    mkdirSync(join(root, "src"));
    const url = new Sources().url(join(root, "src", "a b.ts"), 3);
    const revision = git("rev-parse", "HEAD");
    rmSync(root, { recursive: true });
    expect(url).toBe(
      blob === undefined ? undefined : `${blob}/${revision}/src/a%20b.ts#L3`,
    );
  });
});
