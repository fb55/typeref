import { chmodSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fetchSymbols } from "../src/symbols.ts";

describe("fetchSymbols", () => {
  it("fetches indexes, and uses the last valid one when they fail", async () => {
    let state: "ok" | "unavailable" | "page" | "unsafe" | "gone" = "ok";
    let page = "Node.html";
    const server = createServer((request, response) => {
      if (request.url === "/api/symbols.json") {
        response.end(JSON.stringify({ version: 1, symbols: { Node: page } }));
      } else if (request.url !== "/docs/symbols.json") {
        response.statusCode = 404;
        response.end();
      } else if (state === "page") {
        response.end("<!doctype html><title>Maintenance</title>");
      } else if (state === "unsafe") {
        response.end(
          JSON.stringify({ version: 1, symbols: { Node: "data:text/html,0" } }),
        );
      } else {
        response.statusCode = { ok: 301, unavailable: 503, gone: 404 }[state];
        response.setHeader("location", "/api/symbols.json");
        response.end();
      }
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address() as { port: number };
    const links = {
      typeref: `http://127.0.0.1:${port}/docs`,
      other: `http://127.0.0.1:${port}/other/`,
    };
    const cache = mkdtempSync(join(tmpdir(), "typeref-"));
    const fetchIn = async (next: typeof state) => {
      state = next;
      return fetchSymbols(links, cache);
    };
    const results = [];
    for (const next of ["ok", "unavailable", "page", "unsafe"] as const) {
      results.push(await fetchIn(next));
    }
    // A read-only cache neither replaces new indexes nor outlives a 404.
    page = "Node2.html";
    chmodSync(cache, 0o555);
    results.push(await fetchIn("ok"), await fetchIn("gone"));
    chmodSync(cache, 0o755);
    results.push(await fetchIn("gone"), await fetchIn("unavailable"));
    await new Promise((resolve) => {
      server.close(resolve);
    });
    rmSync(cache, { recursive: true });
    // URLs are relative to where the index was redirected to.
    const index = (path: string) =>
      new Map([
        [
          "typeref",
          new Map([["Node", `http://127.0.0.1:${port}/api/${path}`]]),
        ],
      ]);
    // Only a 404 drops it: the site no longer publishes one.
    expect(results).toStrictEqual([
      index("Node.html"),
      index("Node.html"),
      index("Node.html"),
      index("Node.html"),
      index("Node2.html"),
      new Map(),
      new Map(),
      new Map(),
    ]);
  });
});
