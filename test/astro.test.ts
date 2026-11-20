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
      { data: unknown; body: string; digest?: string }
    >();
    const listeners: ((path: string) => void)[] = [];
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
      renderMarkdown: async (markdown) => ({ html: markdown }),
      generateDigest: (data) => data,
      logger: { info: () => undefined, error: () => undefined },
      watcher: {
        add: (paths) => watched.push(...paths),
        on: (_event, listener) => listeners.push(listener),
      },
    };
    await typerefLoader({
      root: "package",
      basePath: "/api",
      readme: false,
    }).load(context);
    const loaded = [...entries.keys()];
    // A page that no longer exists, removed by the next update.
    entries.set("gone", { data: {}, body: "" });
    for (const listener of listeners) listener(watched[0]);
    await delay(300);
    expect([
      loaded,
      entries.get("variables/pkg.a")?.data,
      entries.get("modules/pkg")?.body,
      entries.has("gone"),
    ]).toStrictEqual([
      [
        "index",
        "modules/pkg",
        "variables/pkg.a",
        "modules/pkg_sub",
        "functions/pkg_sub.b",
        "modules/pkg_feature.ts",
        "variables/pkg_feature.ts.f",
      ],
      {
        title: "Variable: a",
        kind: "Variable",
        name: "a",
        href: "/api/variables/pkg.a/",
      },
      expect.stringContaining("[a](/api/variables/pkg.a/)"),
      false,
    ]);
  });
});
