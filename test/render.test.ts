import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Target } from "../src/model.ts";
import { loadProject } from "../src/project.ts";
import { renderHtml } from "../src/render/html.ts";
import { renderMarkdown } from "../src/render/markdown.ts";
import { inlineMarkdown, markdownTree } from "../src/render/shared.ts";
import { fixture } from "./helpers.ts";

const fixtures = join(import.meta.dirname, "fixtures");

describe("renderMarkdown", () => {
  const files = renderMarkdown(fixture(["classes", "heritage"]), {
    basePath: "/api/",
  });

  it.each(["/api", "/api/"])("links with the base path %s", (basePath) => {
    expect(
      renderMarkdown(fixture(["classes"]), { basePath }).get("index.md"),
    ).toContain("(/api/classes/Base.md)");
  });

  it("writes a page per module and declaration, linking with the base path", () => {
    expect([...files.keys()]).toStrictEqual([
      "index.md",
      "modules/classes.md",
      "classes/classes.Base.md",
      "classes/classes.Derived.md",
      "interfaces/classes.Indexed.md",
      "interfaces/classes.Runner.md",
      "modules/heritage.md",
      "interfaces/heritage.Wrapper.md",
    ]);
  });

  it("indexes declarations with the first paragraph of their summary", () => {
    expect(files.get("modules/classes.md")).toContain(
      "| [Base](/api/classes/classes.Base.md) | Base docs. |",
    );
  });

  it("sections members by category", () => {
    expect(
      files.get("interfaces/heritage.Wrapper.md")!.match(/^## .*/gmu),
    ).toStrictEqual(["## Extends", "## Math", "## Other"]);
  });

  it("sections accessors by their getters' categories", () => {
    expect(
      renderMarkdown(fixture(["rendering"])).get("classes/Cache.md"),
    ).toMatch(/^## Settings\n\n### mode$/mu);
  });

  it("links inherited members to the members they are inherited from", () => {
    expect(files.get("classes/classes.Derived.md")).toContain(
      "#### Inherited from\n\n[`Base.value`](/api/classes/classes.Base.md#value)",
    );
  });
});

describe("renderMarkdown of READMEs", () => {
  it("writes the READMEs of packages on their modules' pages", () => {
    const files = renderMarkdown(
      loadProject(join(fixtures, "monorepo"), { packages: ["packages/*"] }),
    );
    expect(files.get("modules/one.md")).toContain("# one");
  });

  it("writes READMEs as they are", () => {
    const readme = "    npm install my-library\n";
    expect(
      renderMarkdown({ name: "p", readme, modules: [] }).get("index.md"),
    ).toBe(readme);
  });
});

describe("renderMarkdown of special cases", () => {
  const files = renderMarkdown(fixture(["rendering"]));

  it("writes code with backticks in longer code spans", () => {
    expect(files.get("functions/id.md")).toContain(
      `## Returns\n\n\`\` \`item- \`\`\${\`number\`}\`\` \` \`\``,
    );
  });

  it("escapes pipes in the names of table cells", () => {
    expect(files.get("types/Keys.md")).toContain("| `a\\|b` |");
  });

  it("writes the signatures of methods in tables", () => {
    expect(files.get("types/Hooks.md")).toContain(
      "| `onError` | (`error`) => `void` |",
    );
  });

  it("documents methods named new as methods", () => {
    expect(files.get("interfaces/Factory.md")).toContain(
      '```ts\n"new"(name): string;\n```',
    );
  });

  it("writes the names of optional methods as keys", () => {
    expect(files.get("interfaces/Events.md")).toContain('"on-error"?(): void;');
  });

  it("writes the overloads of methods in tables", () => {
    expect(files.get("types/Codec.md")).toContain(
      "| `decode` | ((`value`) => `string`) & ((`value`) => [`Uint8Array`](",
    );
  });

  it("documents a member of several categories once", () => {
    expect(
      files.get("interfaces/Multi.md")!.match(/^### both$/gmu),
    ).toHaveLength(1);
  });

  it("writes pages for the categories of declarations with enough members", () => {
    const project = fixture(["rendering"]);
    const split = renderMarkdown(project, { categoryPages: 4 });
    expect([
      [...split.keys()].filter((path) => path.startsWith("interfaces/Multi")),
      split.get("interfaces/Multi.md"),
      split.get("interfaces/Multi/b.md"),
      renderMarkdown(project, { categoryPages: 5 }).has(
        "interfaces/Multi/a.md",
      ),
    ]).toStrictEqual([
      [
        "interfaces/Multi.md",
        "interfaces/Multi/a.md",
        "interfaces/Multi/b.md",
        // Not `index.md`, which sites serve as the directory's page.
        "interfaces/Multi/index-category.md",
        "interfaces/Multi/other.md",
      ],
      expect.stringContaining(
        '## [A](Multi/a.md)\n\nThe first category.\n\n| Property | Description |\n| - | - |\n| <a id="both"></a>[both](Multi/a.md#both) | In two categories. |',
      ),
      expect.stringMatching(
        /^# Multi: B\n\nMembers of \[`Multi`\]\(\.\.\/Multi\.md\)\.\n\nSee \[both\]\(a\.md#both\)\.\n\n\*\*\*\n\n## second$/mu,
      ),
      false,
    ]);
  });

  it("describes properties of function types as functions", () => {
    expect(
      renderMarkdown(fixture(["rendering"])).get("interfaces/Handlers.md"),
    ).toContain(
      "Handles values.\n\n#### Parameters\n\n| Parameter | Type | Description |\n| - | - | - |\n| `value` | `string` | The value. |\n\n#### Returns\n\n`boolean`\n\nWhether it was handled.",
    );
  });

  it("describes a variable's function type once, with its comment's tags", () => {
    const page = files.get("variables/load.md")!;
    expect([
      page.includes("## Returns\n\n`number`\n\nThe count."),
      page.match(/^## See$/gmu)?.length,
    ]).toStrictEqual([true, 1]);
  });

  it.each([
    "Zero when empty.",
    "A nonnegative number.",
    "protected abstract refresh(): void;",
    "static get count(): number;",
  ])("documents accessors and methods with %s", (text) => {
    expect(files.get("classes/Cache.md")).toContain(text);
  });

  it("writes the types accessors read in member tables", () => {
    expect(files.get("types/Settings.md")).toContain("| `volume` | `number` |");
  });

  it("documents index signatures of type aliases, keeping key types", () => {
    const page = files.get("types/Lookup.md")!;
    expect([
      page.includes("type Lookup = { [key: string]: number };"),
      page.includes("Values by key."),
      page.includes("## Type Declaration"),
    ]).toStrictEqual([true, true, false]);
  });

  it("documents index signatures", () => {
    expect(files.get("interfaces/Dictionary.md")).toMatch(
      /Values by name\.\n\nThe value\.\n\n### Example\n\n```ts\ndictionary\.a;/u,
    );
  });
});

describe("renderHtml", () => {
  it("keeps members' IDs apart from the layout's", async () => {
    const files = await renderHtml(fixture(["rendering"]));
    const page = files.get("interfaces/Layout.html")!;
    expect([
      page.includes('id="main"'),
      page.includes('<main id="Main"'),
    ]).toStrictEqual([true, true]);
  });

  it.each([
    ["## [Configuration](https://example.org/config)", "configuration"],
    ["## A → B", "a--b"],
  ])("makes the ID of %s from its text, as GitHub does", async (readme, id) => {
    const files = await renderHtml({ name: "p", readme, modules: [] });
    expect(files.get("index.html")).toContain(`<h2 id="${id}">`);
  });

  it("puts tables in regions keyboards can scroll", async () => {
    const files = await renderHtml({
      name: "p",
      readme: "| a |\n| - |\n| b |",
      modules: [],
    });
    expect(files.get("index.html")).toContain(
      '<div class="table" tabindex="0" role="region" aria-label="Table"><table>',
    );
  });

  it("resolves a README's relative links where it is in its repository", async () => {
    const files = await renderHtml({
      name: "p",
      readme:
        "[Guide](docs/guide.md) ![Logo](./logo.png) [Top](#top) ![Icon][icon] ![Root](/root.png)\n\n[icon]: ./icon.png",
      readmeUrl: "https://github.com/o/r/blob/abc/packages/p/README.md",
      modules: [],
    });
    expect(files.get("index.html")).toContain(
      '<a href="https://github.com/o/r/blob/abc/packages/p/docs/guide.md">Guide</a> <img src="https://github.com/o/r/raw/abc/packages/p/logo.png" alt="Logo"> <a href="#top">Top</a> <img src="https://github.com/o/r/raw/abc/packages/p/icon.png" alt="Icon"> <img src="https://github.com/o/r/raw/abc/root.png" alt="Root">',
    );
  });

  it("links the API reference next to the README, with titles apart", async () => {
    const files = await renderHtml({ name: "p", readme: "# p", modules: [] });
    expect([
      files
        .get("index.html")!
        .includes('<a href="modules.html">API reference</a>'),
      /<title>(?<title>.*?)<\/title>/u.exec(files.get("index.html")!)?.groups?.[
        "title"
      ],
      /<title>(?<title>.*?)<\/title>/u.exec(files.get("modules.html")!)
        ?.groups?.["title"],
    ]).toStrictEqual([true, "Overview | p", "API reference | p"]);
  });

  it("gives the headings of READMEs IDs", async () => {
    const files = await renderHtml(loadProject(join(fixtures, "package")));
    expect(files.get("index.html")).toContain('<h1 id="pkg">pkg</h1>');
  });

  it("links the headings of members of object types to their anchors", async () => {
    const files = await renderHtml(fixture(["rendering"]));
    expect(files.get("types/Hooks.html")).toMatch(
      /<h3 id="onerror"><a class="anchor" href="#onerror">onError<\/a>/u,
    );
  });

  it("publishes an index of its URLs by qualified name", async () => {
    const files = await renderHtml(fixture(["namespaces"]));
    expect(JSON.parse(files.get("symbols.json")!)).toMatchObject({
      version: 1,
      symbols: {
        "Outer.Deep.Options": "interfaces/Outer.Deep.Options.html",
        "Outer.Deep.Options.b": "interfaces/Outer.Deep.Options.html#b",
        // Static members, as `typeof Schema.parse` refers to them.
        "Schema.parse": "classes/Schema.html#parse-1",
      },
    });
  });

  it("links to members on the pages of their categories", async () => {
    const files = await renderHtml(fixture(["rendering"]), {
      categoryPages: 3,
    });
    const index = files.get("interfaces/Multi.html")!;
    const page = files.get("interfaces/Multi/b.html")!;
    expect([
      page,
      // Its navigation lists only the members on it, if any.
      /<nav class="toc".*?<\/nav>/u.exec(page)?.[0].match(/<li>/gu)?.length,
      files
        .get("interfaces/Multi/index-category.html")!
        .includes('class="toc"'),
      index,
      // Old links to members find them in the index, once.
      index.match(/id="both"/gu)?.length,
    ]).toStrictEqual([
      expect.stringContaining('<p class="also"><a href="a.html#both">'),
      1,
      false,
      expect.stringMatching(
        /aria-label="Members">.*<li><a href="Multi\/a.html#both">both<\/a><\/li>/u,
      ),
      1,
    ]);
  });

  it("documents a member of several categories once", async () => {
    const files = await renderHtml(fixture(["rendering"]));
    const page = files.get("interfaces/Multi.html")!;
    expect(page.match(/id="both"/gu)).toHaveLength(1);
  });

  it.each([
    "Zero when empty.",
    "A nonnegative number.",
    /static<\/span> <span[^>]*>get<\/span> <span[^>]*>count/u,
  ])("documents accessors with %s", async (text) => {
    const files = await renderHtml(fixture(["rendering"]));
    expect(files.get("classes/Cache.html")).toMatch(text);
  });

  it("links to members of object types on their aliases' pages in Markdown", () => {
    expect(
      renderMarkdown(fixture(["rendering"])).get("functions/configure.md"),
    ).toContain("(../types/Config.md)");
  });

  it("documents call signatures of object types", async () => {
    const html = await renderHtml(fixture(["rendering"]));
    const pages = [
      renderMarkdown(fixture(["rendering"])).get("types/Loader.md")!,
      html.get("types/Loader.html")!,
    ];
    expect(
      pages.map((page) => [
        page.includes("Loads by ID."),
        page.includes("The ID."),
        page.includes("__type"),
      ]),
    ).toStrictEqual([
      [true, true, false],
      [true, true, false],
    ]);
  });

  it("indexes members of object types for search", async () => {
    const files = await renderHtml(fixture(["rendering"]));
    expect(JSON.parse(files.get("assets/search.json")!)).toContainEqual({
      name: "strict",
      kind: "Property",
      url: "types/Config.html#strict",
      parent: "Config",
    });
  });

  it("links to members of object types on their aliases' pages", async () => {
    const files = await renderHtml(fixture(["rendering"]));
    expect([
      files
        .get("functions/configure.html")!
        .includes('href="../types/Config.html#strict"'),
      files.get("types/Config.html")!.includes('id="strict"'),
    ]).toStrictEqual([true, true]);
  });

  it("documents index signatures of type aliases", async () => {
    const files = await renderHtml(fixture(["rendering"]));
    const page = files.get("types/Lookup.html")!;
    expect([
      page.includes("<p>Values by key.</p>"),
      page.includes("<h2>Properties</h2>"),
    ]).toStrictEqual([true, false]);
  });

  it("documents index signatures", async () => {
    const files = await renderHtml(fixture(["rendering"]));
    expect(files.get("interfaces/Dictionary.html")).toMatch(
      /Values by name\.<\/p><p>The value\.<\/p>.*Example/su,
    );
  });

  it("indexes re-exports by their names for search", async () => {
    const files = await renderHtml(fixture(["exports"]));
    expect(JSON.parse(files.get("assets/search.json")!)).toContainEqual(
      expect.objectContaining({ name: "alias", kind: "Variable" }),
    );
  });

  it("indexes re-exports of dependencies by their docs' URLs, others by their pages", async () => {
    const url = "https://dep.example/interfaces/Dep.html";
    const files = await renderHtml({
      name: "test",
      modules: [
        {
          id: 0,
          kind: "Module",
          name: "test",
          flags: {},
          children: [
            {
              id: 1,
              kind: "Reference",
              name: "Dep",
              flags: {},
              type: {
                type: "reference",
                name: "Dep",
                target: { kind: "url", url },
              },
            },
            {
              id: 2,
              kind: "Variable",
              name: "pattern",
              flags: {},
              type: {
                type: "reference",
                name: "RegExp",
                target: { kind: "url", url: "https://developer.mozilla.org/" },
              },
            },
          ],
        },
      ],
    });
    expect(JSON.parse(files.get("assets/search.json")!)).toStrictEqual([
      { name: "Dep", kind: "Reference", url },
      { name: "pattern", kind: "Variable", url: "variables/pattern.html" },
    ]);
  });

  it("writes pages, the search index and the assets", async () => {
    const files = await renderHtml(fixture(["classes"]));
    expect([
      [...files.keys()].filter((path) => path.startsWith("assets/")),
      (JSON.parse(files.get("assets/search.json")!) as unknown[]).slice(0, 2),
    ]).toStrictEqual([
      ["assets/search.json", "assets/style.css", "assets/main.js"],
      [
        { name: "Base", kind: "Class", url: "classes/Base.html" },
        {
          name: "constructor",
          kind: "Constructor",
          url: "classes/Base.html#constructor",
          parent: "Base",
        },
      ],
    ]);
  });

  it("escapes code and links names to their pages", async () => {
    const files = await renderHtml(fixture(["classes"]));
    const page = files.get("classes/Derived.html")!;
    expect(page).toContain('<span class="k">extends</span>');
    expect(page).toContain(
      '<a class="n" href="Base.html">Base</a>&#x3C;<span class="k">string</span>>',
    );
  });
});

describe("module comments", () => {
  const project = fixture(["module-comment"]);

  it("shows the comment of a single module on the Markdown index", () => {
    expect(renderMarkdown(project).get("index.md")).toContain(
      "# test\n\nDocumented module\n\n## Functions",
    );
  });

  it("shows the comment of a single module on the HTML index", async () => {
    const files = await renderHtml(project);
    expect(files.get("index.html")).toContain("<p>Documented module</p>");
  });
});

describe("accessors", () => {
  const project = fixture(["inherit-doc"]);

  it.each([
    ["get x(): number;", 60, "getter"],
    ["set x(value);", 62, "setter"],
  ])(
    "shows %s with its source and comment in Markdown",
    (code, line, comment) => {
      expect(renderMarkdown(project).get("classes/Accessors.md")).toContain(
        `${code}\n\`\`\`\n\nDefined in: inherit-doc.ts:${line}\n\n${comment}`,
      );
    },
  );

  it.each([
    ["getter", 60],
    ["setter", 62],
  ])(
    "shows the %s with its source and comment in HTML",
    async (comment, line) => {
      const files = await renderHtml(project);
      expect(files.get("classes/Accessors.html")).toContain(
        `</pre><p class="source">Defined in inherit-doc.ts:${line}</p><p>${comment}</p>`,
      );
    },
  );
});

describe("markdownTree", () => {
  it.each([
    ["@linkcode", "[iterator]", { type: "inlineCode", value: "[iterator]" }],
    ["@link", "a]b", { type: "text", value: "a]b" }],
  ])("links %s tags, keeping their labels and URLs", (tag, text, label) => {
    const url = "https://example.com/a_(b) c";
    expect(
      markdownTree(
        [{ kind: "inline-tag", tag, text, target: { kind: "url", url } }],
        (target) => (target.kind === "url" ? target.url : undefined),
      ).children,
    ).toMatchObject([
      {
        type: "paragraph",
        children: [{ type: "link", url, children: [label] }],
      },
    ]);
  });
});

/**
 * @param target A link's target.
 * @returns The URL of a URL target.
 */
const link = (target: Target): string | undefined =>
  target.kind === "url" ? target.url : undefined;

describe("comment Markdown", () => {
  it("keeps a ! before a link out of it", () => {
    const [paragraph] = markdownTree(
      [
        { kind: "code", text: "`value`" },
        { kind: "text", text: "!" },
        {
          kind: "inline-tag",
          tag: "@link",
          text: "guide",
          target: { kind: "url", url: "u" },
        },
      ],
      link,
    ).children;
    expect(
      paragraph?.type === "paragraph" &&
        paragraph.children.map((child) => child.type),
    ).toStrictEqual(["inlineCode", "text", "link"]);
  });

  it("keeps list items apart on one line", () => {
    expect(
      inlineMarkdown(
        [{ kind: "text", text: "- first option\n- second option" }],
        link,
      ).map((node) => (node.type === "text" ? node.value : node.type)),
    ).toStrictEqual(["first option second option"]);
  });

  it("puts blocks on one line after parsing them", () => {
    expect(
      inlineMarkdown(
        [{ kind: "text", text: "First\nline.\n\n```ts\nfoo();\n```" }],
        link,
      ).map((node) => (node.type === "text" ? node.value : node.type)),
    ).toStrictEqual(["First line.", " ", "foo();"]);
  });
});
