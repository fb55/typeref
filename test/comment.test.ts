/**
 * Doc comments. Cases follow TypeDoc's lexer and parser tests
 * (`src/test/comments.test.ts`, Apache-2.0).
 */
import { describe, expect, it } from "vitest";

import {
  extractTagName,
  firstParagraph,
  parseComment,
} from "../src/comment.ts";

const parse = (raw: string) => parseComment(raw, () => undefined);

describe("parseComment", () => {
  it.each([
    ["/**/", []],
    ["/** Comment */", [{ kind: "text", text: "Comment" }]],
    [
      "/**\n * Comment\n * Next line */",
      [{ kind: "text", text: "Comment\nNext line" }],
    ],
    // Lines without stars lose the indentation they share.
    [
      "/**\n      Comment start\n       * not a star line\n    */",
      [{ kind: "text", text: "Comment start\n * not a star line" }],
    ],
    // A missing space after the star.
    ["/**\n * A\n *B\n */", [{ kind: "text", text: "A\nB" }]],
  ])("strips the delimiters of %j", (raw, summary) => {
    expect(parse(raw).summary).toStrictEqual(summary);
  });

  it.each([
    [String.raw`/** \{\} */`, "{}"],
    [String.raw`/** Text *\/ */`, "Text */"],
    [String.raw`/** not a \@tag */`, "not a @tag"],
    [String.raw`/** \\ \n */`, String.raw`\\ \n`],
    ["/** test@example.com */", "test@example.com"],
    [
      "/** @typescript-eslint/parser @jest/globals */",
      "@typescript-eslint/parser @jest/globals",
    ],
    ["/** @123 @@ @ */", "@123 @@ @"],
  ])("reads %j as text", (raw, text) => {
    expect(parse(raw).summary).toStrictEqual([{ kind: "text", text }]);
  });

  it("keeps code spans, including tags and braces in them", () => {
    expect(
      parse("/** a `@b {@link c}` ```d `` e``` f */").summary,
    ).toStrictEqual([
      { kind: "text", text: "a " },
      { kind: "code", text: "`@b {@link c}`" },
      { kind: "text", text: " " },
      { kind: "code", text: "```d `` e```" },
      { kind: "text", text: " f" },
    ]);
  });

  it("reads unclosed code spans as text", () => {
    expect(parse("/**\n * code? `` fake\n * @remarks text\n */")).toStrictEqual(
      {
        summary: [{ kind: "text", text: "code? `` fake" }],
        blockTags: [
          { tag: "@remarks", content: [{ kind: "text", text: "text" }] },
        ],
        modifierTags: [],
      },
    );
  });

  it("keeps fenced code to its end, or to the end of the comment", () => {
    const comment = parse(
      "/**\n * ```ts\n *   test() // @returns\n * /* inner *\\/\n * ```\n * After\n * ```\n * open\n */",
    );
    expect(comment.summary).toStrictEqual([
      { kind: "code", text: "```ts\n  test() // @returns\n/* inner */\n```" },
      { kind: "text", text: "\nAfter\n" },
      { kind: "code", text: "```\nopen" },
    ]);
  });

  it("splits block tags, and collects modifier tags anywhere", () => {
    expect(
      parse(
        "/**\n * Summary @beta\n * @remarks Remarks\n * @internal\n * @see a\n */",
      ),
    ).toStrictEqual({
      summary: [{ kind: "text", text: "Summary" }],
      blockTags: [
        { tag: "@remarks", content: [{ kind: "text", text: "Remarks" }] },
        { tag: "@see", content: [{ kind: "text", text: "a" }] },
      ],
      modifierTags: ["@beta", "@internal"],
    });
  });

  it.each([
    ["@inheritdoc", "@inheritDoc"],
    ["@return", "@returns"],
    ["@template", "@typeParam"],
    ["@prop", "@property"],
  ])("spells %s as %s", (tag, spelling) => {
    expect(parse(`/** ${tag} */`).blockTags[0]?.tag).toBe(spelling);
  });

  it.each([
    ["@param", { tag: "@param", content: [] }],
    ["@param T", { tag: "@param", name: "T", content: [] }],
    [
      "@param {string} [T = [1]] - Text",
      { tag: "@param", name: "T", content: [{ kind: "text", text: "Text" }] },
    ],
  ])("names %j", (text, tag) => {
    expect(parse(`/** ${text} */`).blockTags).toStrictEqual([tag]);
  });

  it.each([
    ["code", [{ kind: "code", text: "```ts\ncode\n```" }]],
    [
      "text `code`",
      [
        { kind: "text", text: "text " },
        { kind: "code", text: "`code`" },
      ],
    ],
    [
      "text {@link foo}",
      [
        { kind: "text", text: "text " },
        { kind: "inline-tag", tag: "@link", text: "foo" },
      ],
    ],
  ])("writes @defaultValue %j as code only if it has none", (text, content) => {
    expect(
      parse(`/** @defaultValue ${text} */`).blockTags[0]?.content,
    ).toStrictEqual(content);
  });

  it("keeps examples fenced with indented fences", () => {
    expect(
      parse("/**\n * @example\n *   ~~~js\n *   foo();\n *   ~~~\n */")
        .blockTags[0]?.content,
    ).toStrictEqual([{ kind: "code", text: "  ~~~js\n  foo();\n  ~~~" }]);
  });

  it("keeps examples fenced with tildes", () => {
    expect(
      parse("/**\n * @example\n * ~~~js\n * foo();\n * ~~~\n */").blockTags[0]
        ?.content,
    ).toStrictEqual([{ kind: "code", text: "~~~js\nfoo();\n~~~" }]);
  });

  it("writes examples without code blocks as code", () => {
    expect(
      parse("/**\n * @example\n * foo();\n */").blockTags[0]?.content,
    ).toStrictEqual([{ kind: "code", text: "```ts\nfoo();\n```" }]);
  });

  it.each([
    ["{@link Foo}", "Foo", "Foo"],
    ["{@link Foo | the foo}", "Foo", "the foo"],
    ["{@link Foo the foo}", "Foo", "the foo"],
    [
      "{@linkcode https://example.com}",
      "https://example.com",
      "https://example.com",
    ],
  ])("resolves %s", (link, reference, text) => {
    const references: string[] = [];
    const comment = parseComment(`/** ${link} */`, (target) => {
      references.push(target);
      return { kind: "url", url: "u" };
    });
    expect(references).toStrictEqual([reference]);
    expect(comment.summary[0]).toMatchObject({ text, target: { url: "u" } });
  });

  it.each([
    ["/**\n * @inheritDoc\n * @override\n */", []],
    [
      "/**\n * @inheritDoc\n * See also the parser.\n */",
      [{ kind: "text", text: "See also the parser." }],
    ],
  ])("leaves tags alone on their lines unnamed: %j", (raw, content) => {
    expect(parse(raw).blockTags).toStrictEqual([
      { tag: "@inheritDoc", content },
    ]);
  });

  it("keeps examples fenced from the line of their tags", () => {
    expect(
      parse(
        "/**\n * @example ```ts\n * run();\n * ```\n * @returns The result.\n */",
      ).blockTags,
    ).toStrictEqual([
      {
        tag: "@example",
        content: [{ kind: "code", text: "```ts\nrun();\n```" }],
      },
      { tag: "@returns", content: [{ kind: "text", text: "The result." }] },
    ]);
  });

  it("keeps tags within lines of examples as code", () => {
    expect(
      parse(
        "/**\n * @example\n * // @ts-expect-error\n * parse(42);\n * @returns The result.\n */",
      ).blockTags,
    ).toStrictEqual([
      {
        tag: "@example",
        content: [
          { kind: "code", text: "```ts\n// @ts-expect-error\nparse(42);\n```" },
        ],
      },
      { tag: "@returns", content: [{ kind: "text", text: "The result." }] },
    ]);
  });

  it("leaves tags with only a type on their lines unnamed", () => {
    expect(
      parse("/**\n * @param {string}\n * value to parse\n */").blockTags,
    ).toStrictEqual([
      { tag: "@param", content: [{ kind: "text", text: "value to parse" }] },
    ]);
  });

  it("keeps other inline tags", () => {
    expect(parse("/** {@inheritDoc Base.method} */").summary).toStrictEqual([
      { kind: "inline-tag", tag: "@inheritDoc", text: "Base.method" },
    ]);
  });
});

describe("extractTagName", () => {
  it.each([
    ["T - abc", "T", "abc"],
    ["Ta abc", "Ta", "abc"],
    ["[  Ta ] - abc", "Ta", "abc"],
    ["[Ta = '['] - abc", "Ta", "abc"],
    ["[T = []] - abc", "T", "abc"],
    ["[T - abc", "T - abc", ""],
  ])("takes the name off %j", (text, name, newText) => {
    expect(extractTagName(text)).toStrictEqual({ name, newText });
  });
});

describe("firstParagraph", () => {
  it("stops at the first blank line", () => {
    expect(
      firstParagraph([
        { kind: "text", text: "First " },
        { kind: "code", text: "`a`" },
        { kind: "text", text: " line.\n\nSecond." },
      ]),
    ).toStrictEqual([
      { kind: "text", text: "First " },
      { kind: "code", text: "`a`" },
      { kind: "text", text: " line." },
    ]);
  });
});
