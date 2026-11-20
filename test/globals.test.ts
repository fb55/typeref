import { describe, expect, it } from "vitest";

import { globalUrl } from "../src/globals.ts";

describe("globalUrl", () => {
  it("ignores names of the object prototype", () => {
    expect(globalUrl("toString")).toBeUndefined();
  });
});
