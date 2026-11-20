/**
 * Symbol indexes: where a site documents each name, so that the docs of
 * other packages link to it. HTML sites publish theirs as `symbols.json`;
 * builds fetch those of the dependencies they link to.
 *
 * @module
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

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
 * @returns Its symbols' URLs, or nothing if it is not a valid index.
 */
function parseIndex(text: string, base: string): Symbols | undefined {
  try {
    const index = JSON.parse(text) as {
      version?: unknown;
      symbols?: unknown;
    } | null;
    if (
      index?.version !== 1 ||
      typeof index.symbols !== "object" ||
      index.symbols === null ||
      Array.isArray(index.symbols)
    ) {
      return undefined;
    }
    const symbols: Symbols = new Map();
    for (const [name, url] of Object.entries(index.symbols)) {
      if (typeof url !== "string") return undefined;
      const resolved = new URL(url, base);
      // Links go to pages; others (`javascript:`) would run on this site.
      if (resolved.protocol !== "https:" && resolved.protocol !== "http:") {
        return undefined;
      }
      symbols.set(name, resolved.href);
    }
    return symbols;
  } catch {
    return undefined;
  }
}

interface Download {
  /** The index's URL. */
  url: string;
  /** Where it was found, after redirects; its URLs are relative to it. */
  source: string;
  text: string;
}

/**
 * @param url An index's URL.
 * @returns The index; `null` if the site has none, nothing if it could not
 *   be fetched.
 */
async function download(url: string): Promise<Download | null | undefined> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (response.status === 404) return null;
    if (!response.ok) return undefined;
    return { url, source: response.url, text: await response.text() };
  } catch {
    return undefined;
  }
}

/**
 * @param file A file in the cache.
 * @param url The index's URL.
 * @returns The index last fetched from it, if any.
 */
function recall(file: string, url: string): Symbols | undefined {
  try {
    const cached = JSON.parse(readFileSync(file, "utf8")) as Download;
    return cached.url === url
      ? parseIndex(cached.text, cached.source)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Changes the cache if it can; builds work without it.
 *
 * @param file A file in the cache.
 * @param index The index to keep, or nothing to forget the last one.
 */
function remember(file: string, index: Download | undefined): void {
  try {
    if (index) {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(index));
    } else {
      rmSync(file, { force: true });
    }
  } catch {
    // A read-only cache keeps what it has.
  }
}

/**
 * Fetches the indexes of the dependencies' docs. Links given as templates
 * have none, and sites answering 404 do not publish one. If an index cannot
 * be fetched, or is not valid, the one fetched last is used.
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
      const index = await download(url);
      // Sites that typeref did not build link by their URLs' pattern.
      if (index === null) {
        remember(file, undefined);
        return;
      }
      // Not an index, such as a host's error page: the last one is kept.
      const fetched = index ? parseIndex(index.text, index.source) : undefined;
      if (fetched) remember(file, index);
      const symbols = fetched ?? recall(file, url);
      if (symbols) found.set(name, symbols);
    }),
  );
  return found;
}
