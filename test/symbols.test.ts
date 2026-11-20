import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fetchSymbols } from "../src/symbols.ts";

describe("fetchSymbols", () => {
  it("fetches indexes, and uses the last one fetched when they fail", async () => {
    let state: "ok" | "unavailable" | "page" = "ok";
    const server = createServer((request, response) => {
      if (request.url === "/docs/symbols.json") {
        if (state === "page") {
          response.end("<!doctype html><title>Maintenance</title>");
          return;
        }
        response.statusCode = state === "unavailable" ? 503 : 301;
        response.setHeader("location", "/api/symbols.json");
        response.end();
      } else if (request.url === "/api/symbols.json") {
        response.end(
          JSON.stringify({
            version: 1,
            symbols: { Node: "classes/Node.html" },
          }),
        );
      } else {
        response.statusCode = 404;
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
    const online = await fetchSymbols(links, cache);
    state = "unavailable";
    const unavailable = await fetchSymbols(links, cache);
    // Error pages served as successes do not replace the last index.
    state = "page";
    await fetchSymbols(links, cache);
    state = "unavailable";
    const afterPage = await fetchSymbols(links, cache);
    await new Promise((resolve) => {
      server.close(resolve);
    });
    rmSync(cache, { recursive: true });
    // URLs are relative to where the index was redirected to.
    const expected = new Map([
      [
        "typeref",
        new Map([["Node", `http://127.0.0.1:${port}/api/classes/Node.html`]]),
      ],
    ]);
    expect([online, unavailable, afterPage]).toStrictEqual([
      expected,
      expected,
      expected,
    ]);
  });
});
