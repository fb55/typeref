import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadProject } from "../src/project.ts";

const fixtures = join(import.meta.dirname, "fixtures");

describe("loadProject", () => {
  it("documents each subpath of a package's exports that has types", () => {
    const project = loadProject(join(fixtures, "package"));
    expect([
      project.name,
      project.version,
      project.readme,
      project.modules.map((module) => [
        module.name,
        module.children!.map((child) => child.name),
      ]),
    ]).toStrictEqual([
      "pkg",
      "1.0.0",
      "# pkg\n",
      [
        ["pkg", ["a"]],
        ["pkg/sub", ["b"]],
        ["pkg/feature.ts", ["f"]],
      ],
    ]);
  });

  it("resolves types for require", () => {
    expect(
      loadProject(join(fixtures, "cjs")).modules[0].children!.map(
        (child) => child.name,
      ),
    ).toStrictEqual(["c"]);
  });

  it("links to dependencies installed by pnpm", () => {
    const project = loadProject(join(fixtures, "linked"), {
      links: { dep: "https://dep.example/" },
    });
    const [signature] = project.modules[0].children!.find(
      (child) => child.name === "make",
    )!.signatures!;
    const target = {
      kind: "url",
      url: "https://dep.example/interfaces/Dep.html",
    };
    // Types, and links through re-exports.
    expect([signature.returns, signature.comment!.summary[1]]).toMatchObject([
      { target },
      { target },
    ]);
  });

  it("links to dependencies through the indexes of their docs", () => {
    const project = loadProject(
      join(fixtures, "linked"),
      { links: { dep: "https://dep.example/" } },
      new Map([
        [
          "dep",
          new Map([
            ["Tools.Tool", "https://dep.example/t"],
            ["parse", "https://dep.example/parse"],
            ["Parser.parse", "https://dep.example/p"],
          ]),
        ],
      ]),
    );
    const [signature] = project.modules[0].children!.find(
      (child) => child.name === "use",
    )!.signatures!;
    // What the index does not list is not linked.
    expect(
      signature.parameters.map((parameter) =>
        parameter.type?.type === "reference" || parameter.type?.type === "query"
          ? parameter.type.target
          : null,
      ),
    ).toStrictEqual([
      { kind: "url", url: "https://dep.example/t" },
      undefined,
      // Static members by their classes' names.
      { kind: "url", url: "https://dep.example/p" },
    ]);
  });

  it("places declarations whose sources are not on disk in their files", () => {
    const project = loadProject(join(fixtures, "remote-map"));
    expect(project.modules[0].children![0].sources).toStrictEqual([
      { file: "index.d.ts", line: 1 },
    ]);
  });

  it("documents subpaths exporting the same file as their own modules", () => {
    const [main, alias] = loadProject(join(fixtures, "aliased")).modules;
    expect([
      [main.name, main.children!.map((child) => child.kind)],
      [alias.name, alias.children!.map((child) => child.target)],
    ]).toStrictEqual([
      ["aliased", ["Variable"]],
      ["aliased/index", [main.children![0].id]],
    ]);
  });

  it("documents the entry points it is given", () => {
    const project = loadProject(join(fixtures, "package"), {
      entryPoints: ["./sub"],
      readme: false,
    });
    expect([
      project.readme,
      project.modules.map((module) => module.name),
    ]).toStrictEqual([undefined, ["pkg/sub"]]);
  });

  it("resolves entry points of packages without exports as paths", () => {
    const project = loadProject(join(fixtures, "linked"), {
      entryPoints: ["./lib/other"],
    });
    expect(
      project.modules[0].children!.map((child) => child.name),
    ).toStrictEqual(["other"]);
  });

  it("documents the packages of a monorepo, linking between them", () => {
    const project = loadProject(join(fixtures, "monorepo"), {
      packages: ["packages/*"],
    });
    const [one, two] = project.modules;
    expect([
      project.modules.map((module) => [module.name, module.readme]),
      two.children![0].signatures![0].returns,
    ]).toStrictEqual([
      [
        ["one", "# one\n"],
        ["two", "# two\n"],
      ],
      {
        type: "reference",
        name: "One",
        target: { kind: "declaration", id: one.children![0].id },
      },
    ]);
  });

  it("asks for a build when declarations are missing", () => {
    expect(() => loadProject(join(fixtures, "unbuilt"))).toThrow(
      "No declarations for unbuilt. Build the package first.",
    );
  });
});
