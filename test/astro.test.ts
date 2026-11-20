import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import { typerefLoader, type TyperefLoaderContext } from "../src/astro.ts";

const fixtures = join(import.meta.dirname, "fixtures");

describe("typerefLoader", () => {
  it("loads pages linked where the site serves them, and updates them", async () => {
    const entries = new Map<
      string,
      {
        data: unknown;
        body: string;
        digest?: string;
        rendered?: unknown;
        filePath?: string;
        assetImports?: string[];
      }
    >();
    const listeners = new Map<string, (path: string) => void>();
    const rendered: { fileURL?: URL }[] = [];
    const watched: string[] = [];
    const context: TyperefLoaderContext = {
      config: { root: pathToFileURL(`${fixtures}/`) },
      store: {
        get: (id) => entries.get(id),
        set: (entry) => Boolean(entries.set(entry.id, entry)),
        keys: () => [...entries.keys()],
        delete: (id) => {
          entries.delete(id);
        },
      },
      parseData: async ({ data }) => data,
      renderMarkdown: async (_markdown, options) => {
        rendered.push(options);
        return {
          html: "<p>Rendered</p>",
          metadata: { imagePaths: ["./logo.svg"] },
        };
      },
      generateDigest: (data) => data,
      logger: { info: () => undefined, error: () => undefined },
      watcher: {
        add: (paths) => watched.push(...paths),
        on: (event, listener) => listeners.set(event, listener),
      },
    };
    await typerefLoader({
      root: "package",
      basePath: "/api",
      // A README whose heading follows a logo.
      readme: "LOGO.md",
    }).load(context);
    const loaded = [...entries.keys()];
    // A page that no longer exists, removed by the next update.
    entries.set("gone", { data: {}, body: "" });
    listeners.get("change")?.(watched[0]);
    await delay(300);
    expect([
      loaded,
      entries.get("index")?.data,
      // Its images are found next to it.
      entries.get("index")?.filePath,
      entries.get("index")?.assetImports,
      rendered[0],
      entries.get("variables/pkg.a")?.data,
      entries.get("variables/pkg.a")?.rendered,
      entries.get("modules/pkg")?.body,
      entries.has("gone"),
    ]).toStrictEqual([
      [
        "index",
        "modules",
        "modules/pkg",
        "variables/pkg.a",
        "modules/pkg_sub",
        "functions/pkg_sub.b",
        "modules/pkg_feature.ts",
        "variables/pkg_feature.ts.f",
      ],
      { title: "The pkg", kind: "readme", name: "pkg", href: "/api/" },
      "package/LOGO.md",
      ["./logo.svg"],
      { fileURL: pathToFileURL(join(fixtures, "package", "LOGO.md")) },
      {
        title: "Variable: a",
        kind: "Variable",
        name: "a",
        href: "/api/variables/pkg.a/",
      },
      { html: "<p>Rendered</p>", metadata: { imagePaths: ["./logo.svg"] } },
      expect.stringContaining("[a](/api/variables/pkg.a/)"),
      false,
    ]);
  });
});
