import { describe, expect, it } from "vitest";

import type { Type } from "../src/model.ts";
import { plain, tokens } from "../src/render/types.ts";

const name = (text: string): Type => ({ type: "reference", name: text });
const fn: Type = {
  type: "function",
  signature: {
    name: "",
    parameters: [{ name: "a", type: name("A") }],
    returns: name("B"),
  },
};
const union: Type = { type: "union", types: [name("A"), name("B")] };
const print = (type: Type, shouldHideParameterTypes = false) =>
  plain(
    tokens(
      (printer) => {
        printer.type(type);
      },
      { shouldHideParameterTypes },
    ),
  );

describe("TypePrinter", () => {
  it.each<[string, Type, string]>([
    ["unions in arrays", { type: "array", elementType: union }, "(A | B)[]"],
    [
      "functions in unions",
      { type: "union", types: [fn, name("C")] },
      "((a: A) => B) | C",
    ],
    [
      "unions in intersections",
      { type: "intersection", types: [union, name("C")] },
      "(A | B) & C",
    ],
    [
      "unions after keyof",
      { type: "operator", operator: "keyof", target: union },
      "keyof (A | B)",
    ],
    [
      "conditionals in checks",
      {
        type: "conditional",
        checkType: {
          type: "conditional",
          checkType: name("A"),
          extendsType: name("B"),
          trueType: name("C"),
          falseType: name("D"),
        },
        extendsType: name("E"),
        trueType: name("F"),
        falseType: name("G"),
      },
      "(A extends B ? C : D) extends E ? F : G",
    ],
  ])("wraps %s in parentheses", (_title, type, text) => {
    expect(print(type)).toBe(text);
  });

  it("prints the constraints of function types' type parameters", () => {
    expect(
      print({
        type: "function",
        signature: {
          name: "",
          typeParameters: [{ name: "T", constraint: name("Entity") }],
          parameters: [{ name: "value", type: name("T") }],
          returns: name("T"),
        },
      }),
    ).toBe("<T extends Entity>(value: T) => T");
  });

  it("leaves out the types of parameters of function types, if asked to", () => {
    expect(print(fn, true)).toBe("(a) => B");
  });

  it.each<[string, Type, string]>([
    [
      "tuples",
      {
        type: "tuple",
        elements: [
          { name: "a", type: name("A") },
          { name: "b", type: name("B"), optional: true },
          { type: name("C"), rest: true },
        ],
      },
      "[a: A, b?: B, ...C]",
    ],
    [
      "mapped types",
      {
        type: "mapped",
        parameter: "K",
        constraint: name("T"),
        templateType: name("V"),
        readonly: "-",
        optional: "+",
      },
      "{ -readonly [K in T]+?: V }",
    ],
    [
      "template literals",
      { type: "templateLiteral", head: "a", tail: [[name("B"), "c"]] },
      `\`a\${B}c\``,
    ],
    [
      "object types",
      {
        type: "object",
        declaration: {
          id: 0,
          kind: "TypeLiteral",
          name: "__type",
          flags: {},
          children: [
            {
              id: 1,
              kind: "Property",
              name: "a",
              flags: { optional: true, readonly: true },
              type: name("A"),
            },
          ],
        },
      },
      "{ readonly a?: A }",
    ],
    [
      "optional methods",
      {
        type: "object",
        declaration: {
          id: 0,
          kind: "TypeLiteral",
          name: "__type",
          flags: {},
          children: [
            {
              id: 1,
              kind: "Method",
              name: "on-error",
              flags: { optional: true },
              signatures: [{ name: "on-error", parameters: [] }],
            },
          ],
        },
      },
      '{ "on-error"?() }',
    ],
  ])("prints %s", (_title, type, text) => {
    expect(print(type)).toBe(text);
  });

  it.each([
    ["a", "a"],
    ["$a1", "$a1"],
    ["0", "0"],
    ["[iterator]", "[iterator]"],
    ["a)b", '"a)b"'],
  ])("writes the key %s as %s", (key, text) => {
    expect(
      plain(
        tokens((printer) => {
          printer.property(key);
        }),
      ),
    ).toBe(text);
  });

  it("prints readonly index signatures", () => {
    expect(
      plain(
        tokens((printer) => {
          printer.indexSignature({
            name: "__index",
            readonly: true,
            parameters: [{ name: "key", type: name("string") }],
            returns: name("T"),
          });
        }),
      ),
    ).toBe("readonly [key: string]: T");
  });

  it("keeps the targets of names", () => {
    expect(
      tokens((printer) => {
        printer.type({
          type: "reference",
          name: "A",
          target: { kind: "url", url: "u" },
        });
      }),
    ).toStrictEqual([
      { kind: "name", text: "A", target: { kind: "url", url: "u" } },
    ]);
  });
});
