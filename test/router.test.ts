import { describe, expect, it } from "vitest";

import type { Declaration, Kind, Module, Project } from "../src/model.ts";
import { Router } from "../src/render/router.ts";

let id = 0;
const declaration = (
  kind: Kind,
  name: string,
  children?: Declaration[],
): Declaration => ({
  id: id++,
  kind,
  name,
  flags: {},
  ...(children && { children }),
});
const module = (name: string, children: Declaration[]): Module => ({
  ...declaration("Module", name, children),
  kind: "Module",
});

describe("Router", () => {
  it("routes as TypeDoc does: pages by kind, members as anchors", () => {
    const method = declaration("Method", "get");
    const other = declaration("Property", "Get");
    const project: Project = {
      name: "p",
      modules: [
        module("p", [
          declaration("Class", "Foo", [method, other]),
          declaration("Class", "foo"),
        ]),
      ],
    };
    const router = new Router(project, ".html");
    expect([
      router.pages.map((page) => page.url),
      router.url(method),
      router.url(other),
    ]).toStrictEqual([
      ["index.html", "classes/Foo.html", "classes/foo-1.html"],
      "classes/Foo.html#get",
      "classes/Foo.html#get-1",
    ]);
  });

  it("makes anchors of names without letters unique", () => {
    const router = new Router(
      { name: "p", modules: [module("p", [])] },
      ".html",
    );
    expect([
      router.anchor("a.html", "_"),
      router.anchor("a.html", "!"),
    ]).toStrictEqual(["_", "_-1"]);
  });

  it("prefixes the names of modules when there are several", () => {
    const tree = declaration("Interface", "TreeAdapter");
    const project: Project = {
      name: "p",
      readme: "# p",
      modules: [module("parse5", [tree]), module("parse5-sax-parser", [])],
    };
    const router = new Router(project, ".html");
    expect([
      router.pages.map((page) => page.url),
      router.url(tree),
    ]).toStrictEqual([
      [
        "index.html",
        "modules.html",
        "modules/parse5.html",
        "interfaces/parse5.TreeAdapter.html",
        "modules/parse5-sax-parser.html",
      ],
      "interfaces/parse5.TreeAdapter.html",
    ]);
  });

  it("links references to what they reference, without anchors of their own", () => {
    const target = declaration("Class", "Foo");
    const external = declaration("Reference", "Foo");
    const internal = { ...declaration("Reference", "Bar"), target: target.id };
    const router = new Router(
      { name: "p", modules: [module("p", [target, external, internal])] },
      ".html",
    );
    expect([router.url(external), router.url(internal)]).toStrictEqual([
      undefined,
      "classes/Foo.html",
    ]);
  });

  it.each([
    ["classes/A.html", "classes/B.html#c", "B.html#c"],
    ["classes/A.html", "functions/b.html", "../functions/b.html"],
    ["classes/A.html", "classes/A.html#c", "#c"],
    ["index.html", "classes/A.html", "classes/A.html"],
  ])("links from %s to %s as %s", (from, to, url) => {
    expect(Router.relative(from, to)).toBe(url);
  });
});
