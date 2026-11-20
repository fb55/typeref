/**
 * An Astro content loader: the documentation's pages as a collection, its
 * Markdown rendered by the site's pipeline (remark and rehype plugins
 * included), without files written into the site.
 *
 * ```ts
 * // src/content.config.ts
 * import { defineCollection } from "astro:content";
 * import { typerefLoader } from "typeref/astro";
 *
 * export const collections = {
 *   api: defineCollection({
 *     loader: typerefLoader({ root: "..", basePath: "/docs/api/" }),
 *   }),
 * };
 * ```
 *
 * @module
 */
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";

import type { Kind } from "./model.ts";
import { loadProject, type Config } from "./project.ts";
import { renderMarkdownPages } from "./render/markdown.ts";
import type { Page } from "./render/router.ts";
import { fetchSymbols } from "./symbols.ts";

export interface TyperefLoaderOptions extends Omit<
  Config,
  "out" | "format" | "basePath"
> {
  /** The package's directory, relative to the site's root. */
  root: string;
  /** The path the pages are served under, e.g. `/docs/api/`. */
  basePath: string;
}

/** The data of each entry. */
export interface TyperefEntryData extends Record<string, unknown> {
  /** The page's title: its first heading, or else the name. */
  title: string;
  /**
   * What the page documents: the README, the index of the project's
   * exports, a declaration of a kind, or a category of a declaration's
   * members.
   */
  kind: "readme" | "index" | "category" | Kind;
  /** The declaration's name; the project's for its README and index. */
  name: string;
  /** Categories: the category's title. */
  category?: string;
  /** Where the page is served, with a trailing slash. */
  href: string;
}

/** What the loader uses of Astro's `LoaderContext`. */
export interface TyperefLoaderContext {
  config: { root: URL };
  store: {
    get(id: string): { digest?: number | string } | undefined;
    set(entry: {
      id: string;
      data: TyperefEntryData;
      body: string;
      digest: string;
      rendered: { html: string };
    }): boolean;
    keys(): string[];
    delete(id: string): void;
  };
  parseData(entry: {
    id: string;
    data: TyperefEntryData;
  }): Promise<TyperefEntryData>;
  renderMarkdown(markdown: string): Promise<{ html: string }>;
  generateDigest(data: string): string;
  logger: { info(message: string): void; error(message: string): void };
  watcher?: {
    add(paths: string[]): unknown;
    on(
      event: "add" | "change" | "unlink",
      listener: (path: string) => void,
    ): unknown;
  };
}

export interface TyperefLoader {
  name: string;
  load(context: TyperefLoaderContext): Promise<void>;
}

/**
 * @param path A page's path, such as `classes/Cheerio.md`.
 * @returns Its entry's ID: lowercase, as sites serve the pages, without the
 *   extension (`classes/cheerio`).
 */
function idOf(path: string): string {
  return path.replace(/\.md$/u, "").toLowerCase();
}

/**
 * @param page A page.
 * @param project The project's name.
 * @returns What the page documents.
 */
function describe(
  page: Page,
  project: string,
): Pick<TyperefEntryData, "kind" | "name" | "category"> {
  const { declaration, section } = page;
  if (!declaration) return { kind: page.kind as "readme", name: project };
  return section
    ? { kind: "category", name: declaration.name, category: section.title }
    : { kind: declaration.kind, name: declaration.name };
}

/**
 * Documents a package as an Astro content collection. Its pages link to each
 * other where the site serves them: `/docs/api/classes/cheerio/`. In
 * development, it updates when the declaration files change.
 *
 * @param options The package and its configuration.
 * @returns The loader.
 */
export function typerefLoader(options: TyperefLoaderOptions): TyperefLoader {
  const { root, basePath, ...config } = options;
  const base = basePath.replace(/\/?$/u, "/");
  const hrefOf = (id: string): string =>
    id === "index" ? base : `${base}${id}/`;
  return {
    name: "typeref",
    async load(context) {
      const directory = resolve(fileURLToPath(context.config.root), root);
      const watched = new Set<string>();
      const update = async (): Promise<void> => {
        const project = loadProject(
          directory,
          config,
          config.links &&
            (await fetchSymbols(
              config.links,
              join(directory, "node_modules", ".cache", "typeref"),
            )),
        );
        const pages = renderMarkdownPages(project, {
          ...(config.categoryPages !== undefined && {
            categoryPages: config.categoryPages,
          }),
          urlOf: (path) => hrefOf(idOf(path)),
        });
        const stale = new Set(context.store.keys());
        for (const { page, markdown } of pages) {
          const id = idOf(page.url);
          stale.delete(id);
          const described = describe(page, project.name);
          // READMEs may start with a logo, before their headings.
          const heading = fromMarkdown(markdown).children.find(
            (node) => node.type === "heading",
          );
          const data = await context.parseData({
            id,
            data: {
              title: heading ? toString(heading) : described.name,
              ...described,
              href: hrefOf(id),
            },
          });
          const digest = context.generateDigest(
            JSON.stringify([markdown, data]),
          );
          if (context.store.get(id)?.digest === digest) continue;
          context.store.set({
            id,
            data,
            body: markdown,
            digest,
            rendered: await context.renderMarkdown(markdown),
          });
        }
        for (const id of stale) context.store.delete(id);
        // The package's own declarations; dependencies' do not change.
        const files = (project.files ?? []).filter(
          (file) =>
            !watched.has(file) && !file.includes(`${sep}node_modules${sep}`),
        );
        for (const file of files) watched.add(file);
        if (files.length > 0) context.watcher?.add(files);
      };
      await update();
      context.logger.info(`Documented ${context.store.keys().length} pages.`);
      const { watcher } = context;
      if (!watcher) return;
      // Builds of declarations write many files: one update follows them.
      let timer: NodeJS.Timeout | undefined;
      let running = Promise.resolve();
      // Declarations mid-build may not load; the next change updates.
      const refresh = async (): Promise<void> => {
        try {
          await update();
        } catch (e) {
          context.logger.error(e instanceof Error ? e.message : String(e));
        }
      };
      const schedule = (path: string): void => {
        if (!watched.has(path)) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          running = running.then(refresh);
        }, 100);
      };
      for (const event of ["add", "change", "unlink"] as const) {
        watcher.on(event, schedule);
      }
    },
  };
}
