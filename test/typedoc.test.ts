/** Cases follow TypeDoc's converter tests (`src/test/*.c2.test.ts`, Apache-2.0). */
import { describe, expect, it } from "vitest";

import { parseComment } from "../src/comment.ts";
import type { Declaration } from "../src/model.ts";
import { blockTags } from "../src/render/shared.ts";
import { fixture, query } from "./helpers.ts";

const parse = (raw: string) => parseComment(raw, () => undefined);

const text = (value: string) => [{ kind: "text", text: value }];

/**
 * @param declaration A declaration.
 * @returns The targets of the links in its summary.
 */
const linkTargets = (declaration: Declaration) =>
  declaration.comment!.summary.flatMap((part) =>
    part.kind === "inline-tag" ? [part.target] : [],
  );

/**
 * @param declaration A declaration.
 * @returns A link target for it.
 */
const to = (declaration: Declaration) => ({
  kind: "declaration",
  id: declaration.id,
});

/**
 * @param declaration A declaration.
 * @param name The name of a member, or of a member of its object type.
 * @returns The member.
 */
const member = (declaration: Declaration, name: string) => {
  const { type } = declaration;
  return (declaration.children ??
    (type?.type === "object" ? type.declaration.children : []))!.find(
    (child) => child.name === name,
  )!;
};

const children = (name: string) =>
  fixture([name]).modules[0].children!.map((child) => [child.kind, child.name]);

describe("default exports", () => {
  // #1903
  it.each([
    ["default-object", [["Variable", "default"]]],
    ["default-hidden", []],
  ])(
    "does not export the local that `export default` names in %s",
    (name, expected) => {
      expect(children(name)).toStrictEqual(expected);
    },
  );
});

describe("module comments", () => {
  // #1962, #1963
  it.each([
    ["module-comment", "Documented module"],
    ["package-documentation", "Package docs"],
  ])("takes the comment of %s from its first comment", (name, summary) => {
    expect(fixture([name]).modules[0].comment?.summary).toStrictEqual(
      text(summary),
    );
  });

  it("does not give a module comment to the first declaration", () => {
    expect(
      query(fixture(["module-comment"]), "foo").signatures![0].comment,
    ).toBeUndefined();
  });
});

describe("@inheritDoc", () => {
  const project = fixture(["inherit-doc"]);

  it("copies the summary and remarks it names, keeping other tags", () => {
    expect([
      query(project, "target").comment,
      query(project, "Target.someMethod").signatures![0].comment!.blockTags.map(
        (tag) => tag.tag,
      ),
    ]).toStrictEqual([
      {
        summary: text("Source"),
        blockTags: [{ tag: "@remarks", content: text("Remarks") }],
        modifierTags: [],
      },
      ["@example"],
    ]);
  });

  it("copies the descriptions of parameters and type parameters", () => {
    expect([
      query(project, "Target").typeParameters![0].comment,
      query(project, "Target.someMethod").signatures![0].parameters[0].comment,
    ]).toStrictEqual([text("Type parameter"), text("arg description")]);
  });

  it("takes the comment of the overload at the same index", () => {
    expect(
      ["test1", "test2"].flatMap((name) =>
        query(project, `SigRef.${name}`).signatures!.map(
          (signature) => signature.comment?.summary,
        ),
      ),
    ).toStrictEqual([text("A"), text("B"), text("C")]);
  });

  it("takes the comment of an accessor's getter", () => {
    expect(query(project, "Accessors.y").comment?.summary).toStrictEqual(
      text("getter"),
    );
  });

  it("inherits the base member's comment without a target", () => {
    const [signature] = query(project, "Bar.member").signatures!;
    expect([
      signature.comment?.summary,
      signature.parameters[0].comment,
    ]).toStrictEqual([text("Foo.member"), text("Foo.member.x")]);
  });

  // A class without a comment inherits its base's.
  it.each(["Bar", "Baz"])("gives %s the comment of its base class", (name) => {
    expect(query(project, name).comment?.summary).toStrictEqual(text("Foo"));
  });
});

describe("overloads", () => {
  // #2718
  it.each(["foo", "Overloads.method"])(
    "gives the signatures of %s without a comment the first's",
    (path) => {
      expect(
        query(fixture(["overloads"]), path).signatures!.map(
          (signature) => signature.comment?.summary,
        ),
      ).toStrictEqual([text("First"), text("First"), text("Third")]);
    },
  );
});

describe("modifier tags", () => {
  const project = fixture(["modifiers"]);

  // #2693
  it("flags declarations tagged @abstract as abstract", () => {
    expect(
      ["AbstractTag", "AbstractTag.foo", "AbstractTag.x"].map(
        (path) => query(project, path).flags.abstract,
      ),
    ).toStrictEqual([true, true, true]);
  });

  it("drops the setter of an accessor tagged @readonly", () => {
    expect(query(project, "Book.title")).not.toHaveProperty("setSignature");
  });

  it("removes a hidden getter or setter on its own", () => {
    const accessors = query(project, "HiddenAccessors").children!;
    expect(
      accessors.map((child) => [child.name, Boolean(child.setSignature)]),
    ).toStrictEqual([
      ["x", false],
      ["y", false],
    ]);
  });

  it.each(["overloaded", "Callable"])(
    "removes a hidden signature of %s on its own",
    (name) => {
      expect(query(project, name).signatures).toHaveLength(1);
    },
  );
});

describe("comments on export statements", () => {
  const project = fixture(["export-comments"]);

  // #1973, #2964
  it.each([
    ["abcRef", "export abc"],
    ["foo", "export foo"],
    ["bare", "export bare"],
    ["A", "A override"],
    ["B", "Package docs"],
  ])("gives %s the comment %j", (name, summary) => {
    expect(query(project, name).comment?.summary).toStrictEqual(text(summary));
  });

  // #2207
  it("locates a namespace of a module at the module's first line", () => {
    expect(query(project, "A").sources).toStrictEqual([
      { file: "module-comment.ts", line: 1 },
    ]);
  });
});

describe("parameter comments", () => {
  const project = fixture(["parameters"]);

  // #2019
  it("describes parameters with their own comments", () => {
    expect(
      query(project, "documented").signatures![0].parameters.map(
        (parameter) => parameter.comment,
      ),
    ).toStrictEqual([text("Doc of a."), undefined]);
  });

  // #2683
  it("describes a callback's parameters with the @param tags of its comment", () => {
    const [callback] = query(project, "action").signatures![0].parameters;
    expect([
      callback.comment,
      callback.type?.type === "function" &&
        callback.type.signature.parameters[0].comment,
    ]).toStrictEqual([text("Param comment"), text("Data")]);
  });

  it("describes the parameters of a function type with @param tags", () => {
    const { type } = query(project, "Handler");
    expect(
      type?.type === "function" && type.signature.parameters[0].comment,
    ).toStrictEqual(text("The event."));
  });

  // #3111
  it("removes hidden parameters, but not those of constructors", () => {
    expect(
      ["C.constructor", "C.method"].map((path) =>
        query(project, path).signatures![0].parameters.map(
          (parameter) => parameter.name,
        ),
      ),
    ).toStrictEqual([["x", "y"], []]);
  });

  it("names destructured parameters by their tags' positions, hidden parameters included", () => {
    expect(
      query(project, "destructured").signatures![0].parameters.map(
        (parameter) => [parameter.name, parameter.comment],
      ),
    ).toStrictEqual([["options", text("The options.")]]);
  });
});

describe("links", () => {
  const project = fixture(["links"]);

  it("looks names up in namespaces before the members of interfaces", () => {
    expect(
      [query(project, "Scoping.Bar"), query(project, "Scoping.Bar.abc")].map(
        (declaration) => linkTargets(declaration),
      ),
    ).toStrictEqual([
      [to(query(project, "Scoping.abc"))],
      [to(query(project, "Scoping.abc"))],
    ]);
  });

  it("looks `module!name` and `!name` up from the top level", () => {
    expect(linkTargets(query(project, "Globals.A"))).toStrictEqual([
      to(query(project, "URLS")),
      to(query(project, "A")),
      to(query(project, "Globals.A")),
    ]);
  });

  // #1771
  it("follows references", () => {
    expect(linkTargets(query(project, "check"))).toStrictEqual([
      to(query(project, "Test.method")),
    ]);
  });

  // #2524
  it.each([
    ["Alias", ["default"], ["other"]],
    ["Nested", [], ["prop", "nested", "here"]],
  ])("links to members of object types from %s", (name, from, path) => {
    const walk = (names: string[]) =>
      names.reduce(
        (declaration, step) => member(declaration, step),
        query(project, name),
      );
    expect(linkTargets(walk(from))).toStrictEqual([to(walk(path))]);
  });
});

describe("comment parsing", () => {
  // #1967
  it.each(["@default", "@example"])(
    "writes an empty %s as an empty code block",
    (tag) => {
      expect(parse(`/**\n * ${tag}\n */`).blockTags[0].content).toStrictEqual([
        { kind: "code", text: "```ts\n\n```" },
      ]);
    },
  );

  it("titles an example with its caption", () => {
    expect(
      parse("/**\n * @example <caption>Caption</caption>\n * codeHere();\n */")
        .blockTags[0].content,
    ).toStrictEqual([
      { kind: "text", text: "Caption\n" },
      { kind: "code", text: "```ts\ncodeHere();\n```" },
    ]);
  });

  it("shows several @see tags as one list", () => {
    expect(
      blockTags(parse("/**\n * @see First\n * @see Second\n */")),
    ).toStrictEqual([
      {
        title: "See",
        content: [
          { kind: "text", text: " - " },
          { kind: "text", text: "First" },
          { kind: "text", text: "\n" },
          { kind: "text", text: " - " },
          { kind: "text", text: "Second" },
          { kind: "text", text: "\n" },
        ],
      },
    ]);
  });
});

describe("type queries", () => {
  const project = fixture(["typeof"]);

  it("links `typeof` to the value it names, not to a type of that name", () => {
    expect(query(project, "Inner.Query").type).toMatchObject({
      target: { id: query(project, "value").id },
    });
  });

  // #2150
  it("looks up the value a `typeof` names, not a type of that name", () => {
    expect(
      query(project, "FileInt").children?.map((child) => [
        child.kind,
        child.name,
      ]),
    ).toStrictEqual([
      ["Property", "intVar"],
      ["Method", "intFn"],
    ]);
  });

  it("names members inherited through a type alias after the alias", () => {
    expect(query(project, "FileInt.intVar").inheritedFrom).toMatchObject({
      name: "Int.intVar",
    });
  });
});

describe("@enum", () => {
  it.each([
    ["NumExpr", "Enum"],
    ["Bool", "Variable"],
  ])("documents %s as %s", (name, kind) => {
    expect(query(fixture(["enum-like"]), name).kind).toBe(kind);
  });
});

describe("heritage and members", () => {
  const project = fixture(["heritage-clauses"]);

  it("lists each base once", () => {
    expect(
      ["B", "D"].map((name) => query(project, name).extends?.length),
    ).toStrictEqual([1, 2]);
  });

  it("leaves out hidden bases", () => {
    expect([
      query(project, "NotHidden").extends,
      query(project, "NotHiddenImpl").implements,
    ]).toStrictEqual([undefined, undefined]);
  });

  // #941
  it("sorts the members of object types, leaving out hidden ones", () => {
    const { type } = query(project, "Obj");
    expect(
      type?.type === "object" &&
        type.declaration.children!.map((child) => child.name),
    ).toStrictEqual(["a", "b"]);
  });

  it("gives constructors the type parameters of their class", () => {
    expect(
      query(project, "Generic.constructor").signatures!.map(
        (signature) => signature.typeParameters?.[0].comment,
      ),
    ).toStrictEqual([text("ctor docs"), text("class docs")]);
  });
});
