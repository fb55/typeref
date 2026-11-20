/**
 * Builds the docs a configuration describes, and writes them.
 *
 * @module
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { loadProject, type Config } from "./project.ts";
import { renderHtml } from "./render/html.ts";
import { renderMarkdown } from "./render/markdown.ts";

/**
 * Documents a project and writes the pages.
 *
 * @param root The project's directory.
 * @param config The configuration.
 * @returns The paths of the files written, relative to the output directory.
 */
export async function build(
  root: string,
  config: Config = {},
): Promise<string[]> {
  const project = loadProject(root, config);
  const files =
    config.format === "markdown"
      ? renderMarkdown(project, config)
      : await renderHtml(project, config);
  const out = resolve(root, config.out ?? "docs");
  // The files the last build wrote; those it no longer writes are removed.
  const manifest = join(out, ".typeref-files");
  const previous = new Set(
    existsSync(manifest)
      ? (JSON.parse(readFileSync(manifest, "utf8")) as string[])
      : [],
  );
  // Files that typeref did not write are never replaced.
  for (const path of files.keys()) {
    if (!previous.has(path) && existsSync(join(out, path))) {
      throw new Error(
        `${join(out, path)} was not written by typeref. Remove it, or choose another output directory.`,
      );
    }
  }
  // Listed before writing, so the retry of a failed build may replace them.
  mkdirSync(out, { recursive: true });
  writeFileSync(
    manifest,
    JSON.stringify([...new Set([...previous, ...files.keys()])]),
  );
  for (const path of previous) {
    if (!files.has(path)) rmSync(join(out, path), { force: true });
  }
  for (const [path, content] of files) {
    const file = join(out, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  writeFileSync(manifest, JSON.stringify([...files.keys()]));
  return [...files.keys()];
}
