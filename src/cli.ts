#!/usr/bin/env node
/**
 * The command: `typeref [config]` documents the package in the current
 * directory, configured by `typeref.config.ts` (or the given file), or else
 * by the `typeref` key of its `package.json`.
 *
 * @module
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import { build } from "./build.ts";
import type { Config } from "./project.ts";

const { positionals } = parseArgs({ allowPositionals: true });
const root = process.cwd();
const path =
  positionals[0] === undefined
    ? ["typeref.config.ts", "typeref.config.js", "typeref.config.mjs"]
        .map((name) => resolve(root, name))
        .find((candidate) => existsSync(candidate))
    : resolve(root, positionals[0]);

try {
  const config =
    path === undefined
      ? ((
          JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as {
            typeref?: Config;
          }
        ).typeref ?? {})
      : ((await import(pathToFileURL(path).href)) as { default?: Config })
          .default;
  if (config === undefined) {
    throw new Error(`${path} must export the configuration as its default.`);
  }
  const files = await build(root, config);
  process.stdout.write(
    `Wrote ${files.length} files to ${config.out ?? "docs"}.\n`,
  );
} catch (e) {
  process.stderr.write(
    `typeref: ${e instanceof Error ? e.message : String(e)}\n`,
  );
  process.exitCode = 1;
}
