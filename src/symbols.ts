/**
 * Symbol indexes: where a site documents each name, so that the docs of
 * other packages link to it. HTML sites publish theirs as `symbols.json`;
 * builds fetch those of the dependencies they link to.
 *
 * @module
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { indexUrl } from "./render/router.ts";

export interface SymbolIndex {
  /** The format's version. */
  version: 1;
  /**
   * URLs, relative to the index, by name: `Element`, its members as
   * `Element.attribs`, members of namespaces as `Namespace.name`.
   */
  symbols: Record<string, string>;
}

/** URLs by name, of a dependency's docs. */
export type Symbols = Map<string, string>;

/**
 * @param text An index, as JSON.
 * @param base The index's URL.
 * @returns Its symbols' URLs, or nothing if it is not an index.
 */
function parseIndex(text: string, base: string): Symbols | undefined {
  try {
    const index = JSON.parse(text) as Partial<SymbolIndex> | null;
    if (index?.version !== 1 || typeof index.symbols !== "object") {
      return undefined;
    }
    const symbols: Symbols = new Map();
    for (const [name, url] of Object.entries(index.symbols)) {
      if (typeof url === "string") symbols.set(name, new URL(url, base).href);
    }
    return symbols;
  } catch {
    return undefined;
  }
}

/**
 * Fetches the indexes of the dependencies' docs. Links given as templates
 * have none. If a site cannot be reached, the index fetched from it last is
 * used.
 *
 * @param links Links to the docs of dependencies, by package name.
 * @param cache The directory keeping the last indexes fetched.
 * @returns The indexes found, by package name.
 */
export async function fetchSymbols(
  links: Record<string, string>,
  cache: string,
): Promise<Map<string, Symbols>> {
  const found = new Map<string, Symbols>();
  await Promise.all(
    Object.entries(links).map(async ([name, base]) => {
      if (!/^https?:\/\//u.test(base) || base.includes("{")) return;
      const url = new URL(indexUrl, base.replace(/\/?$/u, "/")).href;
      const file = join(cache, `${encodeURIComponent(name)}.json`);
      let text: string;
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(10_000),
        });
        // Sites that typeref did not build link by their URLs' pattern.
        if (!response.ok) {
          rmSync(file, { force: true });
          return;
        }
        text = await response.text();
        mkdirSync(cache, { recursive: true });
        writeFileSync(file, JSON.stringify({ url, text }));
      } catch {
        try {
          const cached = JSON.parse(readFileSync(file, "utf8")) as {
            url: string;
            text: string;
          };
          if (cached.url !== url) return;
          ({ text } = cached);
        } catch {
          return;
        }
      }
      const symbols = parseIndex(text, url);
      if (symbols) found.set(name, symbols);
    }),
  );
  return found;
}
