/**
 * Declaration files to the model. Some cases follow TypeDoc's behavior tests
 * (`src/test/behavior.c2.test.ts`, Apache-2.0).
 */
import { describe, expect, it } from "vitest";

import { fixture, query } from "./helpers.ts";

describe("exports", () => {
  const project = fixture(["exports"]);

  it("documents what an entry point exports, from its own and other files", () => {
    expect(
      project.modules[0].children!.map((child) => [child.kind, child.name]),
    ).toStrictEqual([
      ["Namespace", "other"],
      ["Interface", "Other"],
      ["Variable", "renamed"],
      ["Variable", "value"],
      ["Function", "fn"],
      ["Reference", "alias"],
      ["Reference", "default"],
    ]);
  });

  it("references declarations exported twice", () => {
    expect(query(project, "alias").target).toBe(query(project, "renamed").id);
  });

  it("references declarations documented outside of namespaces", () => {
    expect(query(project, "other.Other").target).toBe(
      query(project, "Other").id,
    );
  });

  it("links types to their declarations", () => {
    expect(query(project, "fn").signatures![0].returns).toStrictEqual({
      type: "reference",
      name: "Other",
      target: { kind: "declaration", id: query(project, "Other").id },
    });
  });

  it("maps sources to the files the declarations were compiled from", () => {
    expect(query(project, "fn").sources).toStrictEqual([
      { file: "exports.ts", line: 8 },
    ]);
  });

  it("references a module that exports itself as a namespace", () => {
    const self = fixture(["self"]);
    expect(query(self, "self").target).toBe(self.modules[0].id);
  });

  it.each([
    ["default-class", "Class"],
    ["default-function", "Function"],
  ])("documents the anonymous default export of %s", (name, kind) => {
    expect(query(fixture([name]), "default").kind).toBe(kind);
  });

  it.each(["tsx-entry", "jsx-entry"])(
    "follows re-exports from TSX files (%s)",
    (name) => {
      expect(query(fixture([name]), "Options").kind).toBe("Interface");
    },
  );

  it("names modules of several entry points", () => {
    expect(
      fixture(["exports", "classes"]).modules.map((module) => module.name),
    ).toStrictEqual(["exports", "classes"]);
  });
});

describe("classes and interfaces", () => {
  const project = fixture(["classes"]);

  it("documents members, but not private ones", () => {
    expect(
      query(project, "Base").children!.map((child) => [
        child.kind,
        child.name,
        child.flags,
      ]),
    ).toStrictEqual([
      ["Constructor", "constructor", {}],
      ["Property", "guarded", { protected: true }],
      ["Property", "value", {}],
      ["Accessor", "size", {}],
      ["Method", "method", {}],
      ["Method", "run", { abstract: true }],
      ["Method", "create", { static: true }],
    ]);
  });

  it("documents accessors with their getter and setter", () => {
    const size = query(project, "Base.size");
    expect([
      size.getSignature?.returns,
      size.setSignature?.parameters,
    ]).toStrictEqual([
      { type: "intrinsic", name: "number" },
      [{ name: "_", type: { type: "intrinsic", name: "number" } }],
    ]);
  });

  it("copies inherited members, and links them to the base's", () => {
    expect(query(project, "Derived.value").inheritedFrom).toStrictEqual({
      type: "reference",
      name: "Base.value",
      target: { kind: "declaration", id: query(project, "Base.value").id },
    });
  });

  it("links overriding members to the members they override", () => {
    expect(query(project, "Derived.method").overwrites).toMatchObject({
      name: "Base.method",
      target: { id: query(project, "Base.method").id },
    });
  });

  it.each([
    ["Derived.method", "Overridable."],
    ["Derived.run", "Runs."],
  ])(
    "gives %s the comment of the member it overrides or implements",
    (path, text) => {
      expect(
        query(project, path).signatures![0].comment?.summary,
      ).toStrictEqual([{ kind: "text", text }]);
    },
  );

  it("documents call, construct and index signatures", () => {
    const indexed = query(project, "Indexed");
    expect([
      indexed.signatures!.map((signature) => signature.name),
      indexed.indexSignatures![0].returns,
    ]).toStrictEqual([
      ["Indexed", "new"],
      { type: "intrinsic", name: "number" },
    ]);
  });

  it("documents the exports of modules a type alias of `typeof` a namespace import adds", () => {
    const wrapper = query(fixture(["heritage"]), "Wrapper");
    expect(
      wrapper.children!.map((child) => [child.kind, child.name]),
    ).toStrictEqual([
      ["Property", "length"],
      ["Property", "pi"],
      ["Method", "add"],
    ]);
  });
});

describe("comments", () => {
  const project = fixture(["comments"]);

  it("gives parameters and type parameters their tags' text", () => {
    const [signature] = query(project, "format").signatures!;
    expect([
      signature.typeParameters![0].comment,
      signature.parameters.map((parameter) => [
        parameter.name,
        parameter.comment,
      ]),
      signature.comment!.blockTags.map((tag) => tag.tag),
    ]).toStrictEqual([
      [{ kind: "text", text: "The input." }],
      [
        ["value", [{ kind: "text", text: "What to format." }]],
        ["options", [{ kind: "text", text: "How." }]],
      ],
      ["@returns"],
    ]);
  });

  it("resolves links to members, labels, globals and URLs", () => {
    const targets = query(project, "linked").comment!.summary.flatMap((part) =>
      part.kind === "inline-tag" ? [[part.text, part.target]] : [],
    );
    expect(targets).toStrictEqual([
      [
        "Target.member",
        { kind: "declaration", id: query(project, "Target.member").id },
      ],
      ["the target", { kind: "declaration", id: query(project, "Target").id }],
      [
        "Map",
        {
          kind: "url",
          url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map",
        },
      ],
      ["https://example.com", { kind: "url", url: "https://example.com" }],
    ]);
  });

  it("resolves links to siblings", () => {
    expect(query(project, "Target.other").comment!.summary[1]).toMatchObject({
      target: { id: query(project, "Target.member").id },
    });
  });

  it("leaves out hidden declarations", () => {
    expect(() => query(project, "hidden")).toThrow("no hidden");
  });

  it("gives each overload its comment", () => {
    expect(
      query(project, "over").signatures!.map(
        (signature) => signature.comment?.summary,
      ),
    ).toStrictEqual([
      [{ kind: "text", text: "First." }],
      [{ kind: "text", text: "Second." }],
    ]);
  });
});

describe("enums and tags", () => {
  const project = fixture(["enums"]);

  it("keeps enum members in order, with their values", () => {
    expect(
      query(project, "Color").children!.map((child) => [
        child.name,
        child.defaultValue,
      ]),
    ).toStrictEqual([
      ["Red", '"red"'],
      ["Green", "1"],
    ]);
  });

  it("documents objects of literals tagged @enum as enums", () => {
    expect([
      query(project, "Like").kind,
      query(project, "NotLike").kind,
    ]).toStrictEqual(["Enum", "Variable"]);
  });

  it("hides constructors of classes tagged @hideconstructor", () => {
    expect(
      query(project, "StaticOnly").children!.map((child) => child.name),
    ).toStrictEqual(["foo"]);
  });
});

describe("namespaces", () => {
  const project = fixture(["namespaces"]);

  it("resolves names in namespaces", () => {
    expect(query(project, "Outer.Inner.a").type).toMatchObject({
      target: { id: query(project, "Outer.Shared").id },
    });
  });

  it("adds the members of namespaces merged into other declarations", () => {
    expect(query(project, "merged.extra").kind).toBe("Variable");
  });
});

const names = (shouldDocumentUnexported: boolean) =>
  fixture(["heritage"], {
    shouldDocumentUnexported,
  }).modules[0].children!.map((child) => child.name);

describe("dependencies", () => {
  it("documents declarations used but not exported, if asked to", () => {
    expect([names(false), names(true)]).toStrictEqual([
      ["Wrapper"],
      ["Wrapper", "Methods"],
    ]);
  });
});

describe("inheritance chains", () => {
  const project = fixture(["inherit-chain"]);

  it("gives declarations the comment of their nearest documented base", () => {
    expect(query(project, "A").comment?.summary).toStrictEqual([
      { kind: "text", text: "C docs." },
    ]);
  });

  it("gives @inheritDoc the comment its target inherits", () => {
    expect(query(project, "Named").comment?.summary).toStrictEqual([
      { kind: "text", text: "C docs." },
    ]);
  });

  it("keeps index signatures of bases for other types of keys", () => {
    expect(
      query(project, "Numbered").indexSignatures!.map(
        (signature) => signature.parameters[0].type,
      ),
    ).toStrictEqual([
      { type: "intrinsic", name: "number" },
      { type: "intrinsic", name: "string" },
    ]);
  });

  it("flags every declarator of a const statement", () => {
    expect(
      [query(project, "first"), query(project, "second")].map(
        (declaration) => declaration.flags.const,
      ),
    ).toStrictEqual([true, true]);
  });
});

describe("members", () => {
  const project = fixture(["members"]);

  it("keeps members named like signatures apart from signatures", () => {
    const keyed = query(project, "Keyed");
    expect([
      keyed.children!.map((child) => child.name),
      keyed.indexSignatures!.length,
    ]).toStrictEqual([["TSIndexSignature"], 1]);
  });

  it("names members with computed literal keys by the literal", () => {
    expect(
      query(project, "Plain").children!.map((child) => child.name),
    ).toStrictEqual(["foo"]);
  });

  it("inherits comments through members that override without one", () => {
    expect(query(project, "Leaf.value").comment?.summary).toStrictEqual([
      { kind: "text", text: "The value." },
    ]);
  });

  it("documents the members of merged enums", () => {
    expect(
      query(project, "Merged").children!.map((child) => child.name),
    ).toStrictEqual(["A", "B"]);
  });

  it("hides re-exports of hidden declarations", () => {
    expect(() => query(project, "alias")).toThrow("no alias");
  });

  it("keeps typeof on imported types", () => {
    expect(query(project, "query").type).toMatchObject({
      type: "query",
      name: "renamed",
    });
  });
});

describe("chains across files", () => {
  const project = fixture(["chain-derived"]);

  it("converts inherited signatures in the files they are written in", () => {
    expect(
      query(project, "C").signatures!.map(
        (signature) => signature.parameters[0].type,
      ),
    ).toStrictEqual([
      { type: "intrinsic", name: "number" },
      {
        type: "reference",
        name: "Input",
        target: { kind: "declaration", id: query(project, "Input").id },
      },
    ]);
  });

  it("gives inherited accessors the comments of their kind", () => {
    const value = query(project, "Override.value");
    expect([
      value.getSignature?.comment?.summary,
      value.setSignature?.comment?.summary,
    ]).toStrictEqual([
      [{ kind: "text", text: "Gets." }],
      [{ kind: "text", text: "Sets." }],
    ]);
  });

  it("exports only what files with export statements export", () => {
    expect(() => query(project, "Internal")).toThrow("no Internal");
  });
});

describe("diamonds", () => {
  const project = fixture(["diamond"]);

  it("inherits signatures reached through several bases once", () => {
    expect(query(project, "Both").signatures).toHaveLength(1);
  });

  it("gives setters the docs of the setters they inherit from", () => {
    expect(
      query(project, "Other.value").setSignature?.comment?.summary,
    ).toStrictEqual([{ kind: "text", text: "Sets." }]);
  });
});

describe("overrides", () => {
  const project = fixture(["overrides", "overrides-base"]);
  const find = (path: string) => {
    const [module, ...rest] = path.split(".");
    return query(
      {
        ...project,
        modules: project.modules.filter((entry) => entry.name === module),
      },
      rest.join("."),
    );
  };

  it("extends the instances of classes in interfaces", () => {
    expect(
      find("overrides.Specialized").children!.map((child) => child.name),
    ).toStrictEqual(["value"]);
  });

  it("inherits members two bases declare from the first", () => {
    const method = find("overrides.Both.f");
    expect([
      method.inheritedFrom?.type === "reference" && method.inheritedFrom.name,
      method.overwrites,
    ]).toStrictEqual(["A.f", undefined]);
  });

  it("overrides members two bases declare from the first", () => {
    expect(find("overrides.Own.f").overwrites).toMatchObject({ name: "A.f" });
  });

  it("links inherited comments from where they are written", () => {
    expect(
      find("overrides.Derived.m").signatures![0].comment!.summary[1],
    ).toMatchObject({
      target: { id: find("overrides-base.Helper").id },
    });
  });
});

describe("undocumented bases", () => {
  const project = fixture(["undocumented-derived"]);

  it("links inherited comments in the files they are written in", () => {
    expect(
      query(project, "Derived.m").signatures![0].comment!.summary[1],
    ).toMatchObject({
      target: { id: query(project, "BaseHelper").id },
    });
  });

  it("extends properties named constructor", () => {
    expect(
      query(project, "FromInterface").children!.map((child) => child.name),
    ).toStrictEqual(["constructor"]);
  });

  it("hides hidden index signatures", () => {
    expect(query(project, "Indexed").indexSignatures).toStrictEqual([]);
  });
});

describe("round 8", () => {
  const project = fixture(["round8"]);

  it("hides hidden index signatures of object types", () => {
    const { type } = query(project, "Dictionary");
    expect(
      type?.type === "object" && type.declaration.indexSignatures,
    ).toStrictEqual([]);
  });

  it("links typeof to static members", () => {
    expect(query(project, "parse").type).toMatchObject({
      target: { id: query(project, "Parser.parse").id },
    });
  });

  it("links comments of copied members from where they are written", () => {
    expect(
      query(project, "B.Child.run").signatures![0].comment!.summary[1],
    ).toMatchObject({
      target: { id: query(project, "A.Options").id },
    });
  });
});

describe("round 9", () => {
  it("keeps undocumented overloads after a hidden one", () => {
    expect(
      query(fixture(["round9"]), "Parser.parse").signatures!.map(
        (signature) => signature.parameters[0].type,
      ),
    ).toStrictEqual([{ type: "intrinsic", name: "string" }]);
  });

  it("documents what namespaces use in the module exporting them", () => {
    const project = fixture(["round9-entry", "exports"], {
      shouldDocumentUnexported: true,
    });
    expect(
      project.modules[0].children!.map((child) => child.name),
    ).toStrictEqual(["helpers", "Options"]);
  });
});

describe("round 10", () => {
  it.each([
    [["round10-root", "round10-helpers"]],
    [["round10-helpers", "round10-root"]],
  ])(
    "references entry points exported as namespaces, in any order (%j)",
    (entryPoints) => {
      const project = fixture(entryPoints);
      const root = project.modules.find(
        (module) => module.name === "round10-root",
      )!;
      const helpers = project.modules.find(
        (module) => module.name === "round10-helpers",
      )!;
      expect(
        root.children!.find((child) => child.name === "helpers")!.target,
      ).toBe(helpers.id);
    },
  );

  it("links through references to entry points", () => {
    const [root, helpers] = fixture([
      "round10-root",
      "round10-helpers",
    ]).modules;
    expect(
      root.children!.find((child) => child.name === "linked")!.comment!
        .summary[1],
    ).toMatchObject({ target: { id: helpers.children![0].id } });
  });

  it("keeps re-exports of interfaces with hidden call signatures", () => {
    const project = fixture(["round10-root"]);
    expect(query(project, "OtherFactory").target).toBe(
      query(project, "Factory").id,
    );
  });
});

describe("round 12", () => {
  const project = fixture(["round12"]);

  it("documents destructured parameters with defaults as optional", () => {
    expect(
      query(project, "configure").signatures![0].parameters[0].optional,
    ).toBe(true);
  });

  it("links to enum members", () => {
    expect(query(project, "TextToken.type").type).toMatchObject({
      target: { id: query(project, "TokenType.Text").id },
    });
  });
});

describe("round 13", () => {
  const project = fixture(["round13"]);

  it("keeps readonly on index signatures", () => {
    const { type } = query(project, "Config");
    expect(
      type?.type === "object" && type.declaration.indexSignatures![0].readonly,
    ).toBe(true);
  });

  it("hides hidden call signatures of object types", () => {
    const { type } = query(project, "Callable");
    expect(type?.type === "object" && type.declaration.signatures).toHaveLength(
      1,
    );
  });
});

describe("round 16", () => {
  it("gives inherited copies of undocumented overrides the overridden comment", () => {
    expect(
      query(fixture(["round16"]), "Leaf.run").signatures![0].comment?.summary,
    ).toStrictEqual([{ kind: "text", text: "Runs." }]);
  });
});

describe("round 17", () => {
  const project = fixture(["round17"]);

  it("documents copies of members with the interfaces their class implements", () => {
    expect(
      query(project, "Child.run").signatures![0].comment?.summary,
    ).toStrictEqual([{ kind: "text", text: "Runs the contract." }]);
  });

  it("describes parameters of overrides by the overridden's at their positions", () => {
    expect(
      query(project, "Renamed.read").signatures![0].parameters[0].comment,
    ).toStrictEqual([{ kind: "text", text: "The input." }]);
  });

  it("keeps constructors' own docs", () => {
    expect(
      query(project, "Kid.constructor").signatures![0].comment,
    ).toBeUndefined();
  });
});

describe("classes merged with interfaces", () => {
  it("documents what the interface adds as the class's own", () => {
    expect(
      query(fixture(["merged-class"]), "Wrapped.add").inheritedFrom,
    ).toBeUndefined();
  });
});

describe("round 18", () => {
  const project = fixture(["round18"]);

  it("keeps overrides whose base's docs are hidden", () => {
    expect(query(project, "Child.run").signatures).toHaveLength(1);
  });

  it("hides re-exports of functions hidden entirely", () => {
    expect(() => query(project, "alias")).toThrow("no alias");
  });
});

describe("round 19", () => {
  it("keeps overrides of hidden members of bases outside the model", () => {
    expect(query(fixture(["round19"]), "Child.run").signatures).toHaveLength(1);
  });
});

describe("round 20", () => {
  it("links to members of objects tagged @enum", () => {
    const project = fixture(["round20"]);
    expect(
      query(project, "open").signatures![0].comment!.summary[1],
    ).toMatchObject({
      target: { kind: "declaration", id: query(project, "Mode.Read").id },
    });
  });
});

describe("round 21", () => {
  it("leaves out overridden members that are hidden", () => {
    expect(query(fixture(["round21"]), "Child.run").overwrites).toBeUndefined();
  });
});

describe("round 24", () => {
  it.each(["ArrowParser.parse", "ArrowHandler.handle"])(
    "describes the parameters of function-typed properties like %s",
    (name) => {
      const { type } = query(fixture(["round24"]), name);
      expect(
        type?.type === "function" && type.signature.parameters[0].comment,
      ).toStrictEqual([{ kind: "text", text: "The input." }]);
    },
  );
});

describe("round 27", () => {
  it("does not inherit constructors where private ones replace them", () => {
    expect(
      query(fixture(["round27"]), "Singleton").children!.map(
        (child) => child.name,
      ),
    ).toStrictEqual(["create"]);
  });
});

describe("round 29", () => {
  it.each([
    ["Client", ["read", "reset"]],
    ["Tagged", ["tag"]],
    ["Merged", ["value"]],
    ["SubMerged", ["value"]],
    ["Product", ["result"]],
    ["MixedClient", ["read", "configure"]],
    ["Item", ["build", "read", "create"]],
  ])("gives %s the members of its bases", (name, members) => {
    expect(
      query(fixture(["round29"]), name).children!.map((child) => child.name),
    ).toStrictEqual(members);
  });
});

describe("round 33", () => {
  it.each(["Service", "Child"])(
    "gives %s members its merged interface extends from what it implements",
    (name) => {
      expect(
        query(fixture(["round33"]), name).children!.map((child) => child.name),
      ).toStrictEqual(["optional"]);
    },
  );
});

describe("round 36", () => {
  it("links type queries of namespaces to them", () => {
    const project = fixture(["round36"]);
    expect(query(project, "Tools").type).toMatchObject({
      type: "query",
      target: { kind: "declaration", id: query(project, "tools").id },
    });
  });

  it.each([
    ["Sprinter.run", "Runs."],
    ["Parser.run", "Runs second."],
  ])(
    "documents %s from the first documented base, superclasses first",
    (name, text) => {
      expect(
        query(fixture(["round36"]), name).signatures![0].comment,
      ).toMatchObject({ summary: [{ kind: "text", text }] });
    },
  );
});

describe("round 39", () => {
  it("documents members from extended bases before implemented ones", () => {
    expect(
      query(fixture(["round39"]), "Parser.run").signatures![0].comment,
    ).toMatchObject({ summary: [{ kind: "text", text: "Runs extra." }] });
  });
});

describe("round 40", () => {
  it("resolves links of comments copied from bases where they are written", () => {
    const project = fixture(["round40"]);
    expect(
      query(project, "Child.run").signatures![0].comment!.summary[1],
    ).not.toMatchObject({
      target: { kind: "declaration", id: query(project, "Options").id },
    });
  });
});

describe("round 42", () => {
  it("links members of namespace imports in comments as in types", () => {
    const project = fixture(["round42", "round42-values"]);
    const [signature] = query(project, "round42.parse").signatures!;
    expect(signature.comment!.summary[1]).toMatchObject({
      target: (signature.parameters[0].type as { target: unknown }).target,
    });
  });
});

describe("round 43", () => {
  it("links members of documented declarations through namespace imports", () => {
    const project = fixture(["round43"]);
    expect(
      query(project, "use").signatures![0].comment!.summary[1],
    ).toMatchObject({
      target: { kind: "declaration", id: query(project, "Parser.parse").id },
    });
  });
});

describe("round 44", () => {
  it("does not document constructors with their bases' constructors", () => {
    expect(
      query(fixture(["round44"]), "Final.constructor").signatures![0].comment,
    ).toBeUndefined();
  });
});

describe("round 45", () => {
  it("links static members with `.` and instance members with `#`", () => {
    const project = fixture(["round45"]);
    const parser = query(project, "Parser");
    const ids = ["static", "instance"].map(
      (kind) =>
        parser.children!.find(
          (child) => Boolean(child.flags.static) === (kind === "static"),
        )!.id,
    );
    expect(
      query(project, "use").signatures![0].comment!.summary.flatMap((part) =>
        part.kind === "inline-tag" && part.target?.kind === "declaration"
          ? [part.target.id]
          : [],
      ),
    ).toStrictEqual(ids);
  });
});

describe("round 47", () => {
  const project = fixture(["round47"]);

  it("keeps constructors of subclasses of classes hiding theirs", () => {
    expect(query(project, "Shown.constructor").signatures).toHaveLength(1);
  });

  it("links to members of frozen objects tagged @enum", () => {
    expect(
      query(project, "use").signatures![0].comment!.summary[1],
    ).toMatchObject({
      target: { kind: "declaration", id: query(project, "Status.Active").id },
    });
  });
});

describe("round 49", () => {
  it("keeps the order of members of objects tagged @enum", () => {
    expect(
      query(fixture(["round47"]), "Phase").children!.map((child) => child.name),
    ).toStrictEqual(["Ready", "Busy"]);
  });
});

describe("round 61", () => {
  it("leaves links through imports to undocumented declarations unresolved", () => {
    const project = fixture(["round61", "round61-other"]);
    expect(
      query(project, "round61.use").signatures![0].comment!.summary[1],
    ).not.toHaveProperty("target");
  });
});

describe("round 64", () => {
  it("names signatures of functions as they are exported", () => {
    expect(query(fixture(["round64"]), "parse").signatures![0].name).toBe(
      "parse",
    );
  });
});

describe("Node.js modules", () => {
  it("links imports from them to their pages, without their members", () => {
    const project = fixture(["builtins"]);
    const stream = query(project, "Stream");
    const [parameter] = query(project, "close").signatures![0].parameters;
    const [source, web] = query(project, "pipe").signatures![0].parameters;
    const [streams] = query(project, "streams").signatures!;
    expect([
      stream.extends?.[0],
      stream.children ?? [],
      parameter.type,
      source.type,
      web.type,
      query(project, "readable").signatures![0].returns,
      streams.returns,
      streams.comment?.summary[1],
    ]).toMatchObject([
      {
        name: "Transform",
        target: { kind: "url", url: "https://nodejs.org/api/stream.html" },
      },
      [],
      // Their submodules are documented with them.
      {
        name: "FileHandle",
        target: { kind: "url", url: "https://nodejs.org/api/fs.html" },
      },
      // Members of namespace imports.
      {
        name: "stream.Readable",
        target: { kind: "url", url: "https://nodejs.org/api/stream.html" },
      },
      // Documented on a page of their own.
      {
        name: "ReadableStream",
        target: { kind: "url", url: "https://nodejs.org/api/webstreams.html" },
      },
      // Inline import types, of members and of modules.
      {
        name: "Readable",
        target: { kind: "url", url: "https://nodejs.org/api/stream.html" },
      },
      {
        type: "query",
        target: { kind: "url", url: "https://nodejs.org/api/stream.html" },
      },
      // Links in comments.
      {
        text: "stream.Readable",
        target: { kind: "url", url: "https://nodejs.org/api/stream.html" },
      },
    ]);
  });
});
