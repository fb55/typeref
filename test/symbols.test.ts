import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fetchSymbols } from "../src/symbols.ts";

describe("fetchSymbols", () => {
  it("fetches indexes, and uses the last one fetched when offline", async () => {
    const server = createServer((request, response) => {
      if (request.url === "/docs/symbols.json") {
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
    await new Promise((resolve) => {
      server.close(resolve);
    });
    const offline = await fetchSymbols(links, cache);
    rmSync(cache, { recursive: true });
    const expected = new Map([
      [
        "typeref",
        new Map([["Node", `http://127.0.0.1:${port}/docs/classes/Node.html`]]),
      ],
    ]);
    expect([online, offline]).toStrictEqual([expected, expected]);
  });
});
