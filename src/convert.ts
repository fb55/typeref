/**
 * From declaration files to the documentation model: what each entry point
 * exports, with types, members, inherited members, comments and links.
 *
 * @module
 */
import { realpathSync } from "node:fs";
import { dirname, relative, sep } from "node:path";

import type {
  Function as FunctionNode,
  MethodDefinition,
  ParamPattern,
  TSCallSignatureDeclaration,
  TSImportType,
  TSIndexSignature,
  TSTupleElement,
  TSType,
  TSTypeAnnotation,
  TSTypeParameter,
  TSTypeParameterDeclaration,
  TSTypeParameterInstantiation,
} from "oxc-parser";

import { parseComment } from "./comment.ts";
import { globalUrl } from "./globals.ts";
import type {
  Comment,
  Declaration,
  Kind,
  Module,
  Parameter,
  Project,
  Signature,
  Source,
  Target,
  TupleElement,
  Type,
  TypeParameter,
} from "./model.ts";
import {
  declaredNames,
  isConst,
  Program,
  type Node,
  type SourceFile,
  type Symbol,
} from "./program.ts";
import { Sources } from "./source.ts";
import type { Symbols } from "./symbols.ts";

export interface EntryPoint {
  /** The module's name: the package's name, and the subpath for others. */
  name: string;
  /** The entry point's declaration file. */
  file: string;
}

export interface ConvertOptions {
  name: string;
  version?: string;
  entryPoints: EntryPoint[];
  /**
   * The directories of the documented packages: what is declared in them
   * (outside of `node_modules`) is documented, everything else is external.
   */
  roots: string[];
  /** Links to the docs of dependencies, by package name. */
  links?: Record<string, string>;
  /**
   * The indexes of the docs of dependencies, by package name. Their links
   * go to what the indexes list, and nowhere else.
   */
  symbols?: Map<string, Symbols>;
  /** Whether to document declarations that are used but not exported. */
  shouldDocumentUnexported?: boolean;
}

type Declared = Extract<Symbol, { kind: "declaration" }>;

/** Order of kinds, as TypeDoc sorts them. */
const kindOrder: Kind[] = [
  "Module",
  "Namespace",
  "Enum",
  "EnumMember",
  "Class",
  "Interface",
  "TypeAlias",
  "Constructor",
  "Property",
  "Variable",
  "Function",
  "Accessor",
  "Method",
  "Reference",
];

/** Directories of TypeDoc's sites, by kind: where a dependency's page is. */
const kindDirectories: Partial<Record<Kind, string>> = {
  Class: "classes",
  Interface: "interfaces",
  Enum: "enums",
  Namespace: "modules",
  TypeAlias: "types",
  Function: "functions",
  Variable: "variables",
};

/** What may stand between a doc comment and the declaration it is for. */
const modifiersPattern =
  /^(?:\s|export|declare|default|const|let|var|abstract|static|readonly|public|protected|override|accessor|async|function|class|interface|type|enum|namespace|module|get|set|new)*$/u;

/** What a comment describes. */
type Owner =
  | { kind: "declaration"; declaration: Declaration }
  | { kind: "signature"; signature: Signature; declaration: Declaration }
  | {
      kind: "parameter";
      parameter: Parameter;
      signature: Signature;
      declaration: Declaration;
    };

/** Members of a class or interface sharing a name, and where they are. */
interface MemberGroup {
  name: string;
  isStatic: boolean;
  file: SourceFile;
  nodes: Node[];
  /** The class or interface declaring them, for inherited members. */
  owner?: string;
  /** The namespaces and type parameters the members are written in. */
  context: Context;
  /** The members of a base these override, for comments they inherit. */
  overridden?: MemberGroup;
}

/** Where names are looked up, beyond the file. */
interface Context {
  containers: Node[];
  typeParameters: string[];
}

interface FunctionLike {
  typeParameters?: TSTypeParameterDeclaration | null | undefined;
  params: ParamPattern[];
  returnType?: TSTypeAnnotation | null | undefined;
}

/**
 * @param file A file.
 * @param node A node in it.
 * @returns The node's text.
 */
const textOf = (file: SourceFile, node: Node): string =>
  file.text.slice(node.start, node.end);

/**
 * @param left A declaration.
 * @param right Another declaration.
 * @returns Their order: by kind, instance members first, then by name.
 */
function compare(left: Declaration, right: Declaration): number {
  return (
    kindOrder.indexOf(left.kind) - kindOrder.indexOf(right.kind) ||
    Number(Boolean(left.flags.static)) - Number(Boolean(right.flags.static)) ||
    left.name.localeCompare(right.name)
  );
}

/**
 * @param file The file a member is in.
 * @param node The member's key.
 * @param computed Whether the key is computed (`[Symbol.iterator]`).
 * @returns The member's name; `undefined` for private names.
 */
function keyName(
  file: SourceFile,
  node: Node,
  computed: boolean,
): string | undefined {
  if (node.type === "PrivateIdentifier") return undefined;
  if (!computed && node.type === "Identifier") return node.name;
  // `"a"`, `1` and `["a"]` all name `a`.
  if (node.type === "Literal") return String(node.value);
  // Well-known symbols are named as TypeDoc names them: `[iterator]`.
  if (
    node.type === "MemberExpression" &&
    node.object.type === "Identifier" &&
    node.object.name === "Symbol" &&
    node.property.type === "Identifier"
  ) {
    return `[${node.property.name}]`;
  }
  return `[${textOf(file, node)}]`;
}

/**
 * @param node A type.
 * @returns The names `infer` declares in it.
 */
function inferredNames(node: unknown): string[] {
  if (node === null || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((child) => inferredNames(child));
  const value = node as { type?: string; typeParameter?: TSTypeParameter };
  const own =
    value.type === "TSInferType" && value.typeParameter
      ? [value.typeParameter.name.name]
      : [];
  return [
    ...own,
    ...Object.entries(node).flatMap(([key, child]) =>
      key === "parent" ? [] : inferredNames(child),
    ),
  ];
}

/**
 * @param nodes Merged declarations.
 * @returns The kind they are documented as.
 */
function kindOf(nodes: Node[]): Kind | undefined {
  const types = new Set<string>(nodes.map((node) => node.type));
  if (types.has("ClassDeclaration")) return "Class";
  if (types.has("TSInterfaceDeclaration")) return "Interface";
  if (types.has("TSEnumDeclaration")) return "Enum";
  if (types.has("TSDeclareFunction") || types.has("FunctionDeclaration")) {
    return "Function";
  }
  if (types.has("VariableDeclarator")) return "Variable";
  if (types.has("TSTypeAliasDeclaration")) return "TypeAlias";
  if (types.has("TSModuleDeclaration")) return "Namespace";
  return undefined;
}

/**
 * Groups members by name: overloads, and an accessor's getter and setter.
 * Signatures (call, construct, index) are grouped by their kind.
 *
 * @param groups The groups, by name.
 * @param file The file the members are in.
 * @param members The members.
 * @param context Where the members' names are looked up.
 * @param owner The class or interface, for inherited members.
 */
function groupMembers(
  groups: Map<string, MemberGroup>,
  file: SourceFile,
  members: Node[],
  context: Context,
  owner?: string,
): void {
  for (const member of members) {
    let name: string | undefined;
    let isStatic = false;
    if (
      member.type === "TSIndexSignature" ||
      member.type === "TSCallSignatureDeclaration" ||
      member.type === "TSConstructSignatureDeclaration"
    ) {
      name = member.type;
    } else if ("key" in member && "computed" in member) {
      if ("accessibility" in member && member.accessibility === "private") {
        continue;
      }
      name = keyName(file, member.key, member.computed);
      isStatic = "static" in member && member.static;
    }
    if (name === undefined) continue;
    const key = memberKey(member, name, isStatic);
    const group = groups.get(key);
    if (group) {
      group.nodes.push(member);
    } else {
      const created: MemberGroup = {
        name,
        isStatic,
        file,
        nodes: [member],
        context,
      };
      if (owner !== undefined) created.owner = owner;
      groups.set(key, created);
    }
  }
}

/**
 * @param signature An index signature.
 * @returns The type of its key, to compare signatures by.
 */
const indexKey = (signature: Signature): string =>
  JSON.stringify(signature.parameters[0]?.type);

/**
 * @param node A member.
 * @param name Its name.
 * @param isStatic Whether it is static.
 * @returns The key of the group it belongs in: signatures of a kind, static
 *   or instance members of a name.
 */
const memberKey = (node: Node, name: string, isStatic: boolean): string =>
  node.type === "TSIndexSignature" ||
  node.type === "TSCallSignatureDeclaration" ||
  node.type === "TSConstructSignatureDeclaration"
    ? `signature ${node.type}`
    : `${isStatic ? "static" : "instance"} ${name}`;

/**
 * @param node A member.
 * @returns The kind it is documented as.
 */
function memberKind(node: Node): Kind | undefined {
  switch (node.type) {
    case "MethodDefinition":
    case "TSAbstractMethodDefinition":
    case "TSMethodSignature": {
      if (node.kind === "constructor") return "Constructor";
      if (node.kind === "get" || node.kind === "set") return "Accessor";
      return "Method";
    }
    case "TSDeclareFunction":
    case "FunctionDeclaration": {
      return "Method";
    }
    case "PropertyDefinition":
    case "TSAbstractPropertyDefinition":
    case "AccessorProperty":
    case "TSAbstractAccessorProperty":
    case "TSPropertySignature":
    case "VariableDeclarator": {
      return "Property";
    }
    default: {
      return undefined;
    }
  }
}

/**
 * @param file A file.
 * @param node A declaration, or the file's program for the file's comment.
 * @returns The doc comment right before the declaration.
 */
function findComment(file: SourceFile, node: Node): string | undefined {
  const { docComments } = file;
  if (node.type === "Program") {
    // The file's comment is its first, if no statement comes before it.
    const first = docComments.at(0);
    return first !== undefined &&
      first.end <= (node.body[0]?.start ?? first.end)
      ? first.text
      : undefined;
  }
  let low = 0;
  let high = docComments.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (docComments[middle].end <= node.start) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return undefined;
  const comment = docComments[low - 1];
  const between = file.text.slice(comment.end, node.start);
  return modifiersPattern.test(between) ? comment.text : undefined;
}

/**
 * @param comment A comment.
 * @returns Whether it hides what it describes.
 */
/** Tags that leave what they are on out of the docs. */
const hidingTags = new Set(["@hidden", "@ignore", "@internal", "@private"]);

const isHidden = (comment: Comment | undefined): boolean =>
  comment?.modifierTags.some((tag) => hidingTags.has(tag)) === true;

/**
 * Describes type parameters with a comment's `@typeParam` tags.
 *
 * @param comment The comment.
 * @param parameters The type parameters.
 */
function describeTypeParameters(
  comment: Comment,
  parameters: TypeParameter[] | undefined,
): void {
  for (const tag of comment.blockTags) {
    if (tag.tag !== "@typeParam" || tag.content.length === 0) continue;
    const parameter = parameters?.find(
      (candidate) => candidate.name === tag.name,
    );
    if (parameter) parameter.comment = tag.content;
  }
}

/**
 * Describes a signature's parameters and type parameters with a comment's
 * `@param` and `@typeParam` tags. Destructured parameters take the names of
 * the tags at their positions.
 *
 * @param comment The comment.
 * @param signature The signature.
 */
function describeParameters(comment: Comment, signature: Signature): void {
  const named = comment.blockTags.filter((tag) => tag.tag === "@param");
  for (const [index, parameter] of signature.parameters.entries()) {
    const tag =
      named.find((candidate) => candidate.name === parameter.name) ??
      (parameter.name === "__namedParameters" ? named[index] : undefined);
    if (!tag) continue;
    if (
      parameter.name === "__namedParameters" &&
      tag.name !== undefined &&
      tag.name !== ""
    ) {
      parameter.name = tag.name;
    }
    if (tag.content.length > 0) parameter.comment = tag.content;
  }
  describeTypeParameters(comment, signature.typeParameters);
}

/**
 * Makes the sources' paths relative to the directory the project's own
 * sources share.
 *
 * @param modules The modules.
 */
function relativizeSources(modules: Module[]): void {
  const all: Source[] = [];
  const visit = (declaration: Declaration): void => {
    all.push(...(declaration.sources ?? []));
    for (const signature of [
      ...(declaration.signatures ?? []),
      ...(declaration.indexSignatures ?? []),
      declaration.getSignature,
      declaration.setSignature,
    ]) {
      all.push(...(signature?.sources ?? []));
    }
    for (const child of declaration.children ?? []) visit(child);
  };
  for (const module of modules) visit(module);
  // Inherited members may come from dependencies, which do not count.
  const own = all.filter(
    ({ file }) => !file.includes(`${sep}node_modules${sep}`),
  );
  if (own.length === 0) return;
  let base = dirname(own[0].file);
  for (const { file } of own) {
    while (!file.startsWith(base + sep) && base !== dirname(base)) {
      base = dirname(base);
    }
  }
  for (const source of all) {
    source.file = relative(base, source.file).replaceAll("\\", "/");
  }
}

class Converter {
  private readonly options: ConvertOptions;
  private readonly program = new Program();
  private readonly sources = new Sources();
  private nextId = 0;
  /** The documented declaration of each declaration node. */
  private readonly declarations = new Map<Node, Declaration>();
  private readonly parents = new Map<Declaration, Declaration>();
  /** Declarations by name, for links that are not in scope. */
  private readonly byName = new Map<string, Declaration>();
  /** Declarations by ID, for links through references and `@inheritDoc`. */
  private readonly byId = new Map<number, Declaration>();
  /** Targets to fill in once every declaration is converted. */
  private readonly pending: {
    holder: { target?: Target };
    symbol: Symbol;
    module: Module;
    /** Whether to document the symbol if it is used but not exported. */
    shouldDocument: boolean;
  }[] = [];
  /**
   * Comments to parse once every declaration is converted, by what they
   * describe: where to look for them, in order.
   */
  private readonly comments = new Map<
    Declaration | Signature | Parameter,
    {
      owner: Owner;
      candidates: {
        file: SourceFile;
        node: Node;
        /** The first overload's, for overloads without a comment. */
        isOverload?: boolean;
      }[];
    }
  >();
  /** The declarations comments with `@inheritDoc` name. */
  private readonly inheritDocs = new Map<Comment, Declaration>();
  /** The members of bases each member overrides, implements or copies. */
  private readonly bases = new Map<Declaration, MemberGroup[]>();
  /** Parameters tagged to be hidden. */
  private readonly hiddenParameters = new Set<Parameter>();
  private readonly lineStarts = new Map<SourceFile, number[]>();
  private readonly roots: string[];
  private module!: Module;
  /** The entry points' modules, for links to `module!name`. */
  private modules: Module[] = [];
  /** Members copied from bases, which keep their bases' visibility. */
  private readonly copies = new Set<Declaration>();
  /** Namespaces of modules, converted after the modules' other exports. */
  private readonly later: (() => void)[] = [];
  /** The module or namespace documenting each file exported as one. */
  private readonly namespaces = new Map<SourceFile, Declaration>();
  /** Where names are looked up, for what is being converted. */
  private context: Context = { containers: [], typeParameters: [] };

  constructor(options: ConvertOptions) {
    this.options = options;
    this.roots = options.roots.map((root) => realpathSync(root) + sep);
  }

  convert(): Project {
    // Every entry point is known first, as other modules' namespaces.
    const entries = this.options.entryPoints.map((entry) => {
      const file = this.program.getFile(realpathSync(entry.file));
      const module: Module = Object.assign(this.create("Module", entry.name), {
        kind: "Module" as const,
        children: [],
      });
      this.comment(
        { kind: "declaration", declaration: module },
        file,
        file.program,
      );
      // Subpaths of one file are referenced as the first.
      if (!this.namespaces.has(file)) this.namespaces.set(file, module);
      return { file, module };
    });
    this.modules = entries.map(({ file, module }) => {
      this.module = module;
      this.addExports(module, file, []);
      return module;
    });
    // Namespaces, once what they export more directly is documented.
    for (const convertLater of this.later) convertLater();
    // Linking may document declarations that are used but not exported.
    while (this.pending.length > 0) {
      for (const {
        holder,
        symbol,
        module,
        shouldDocument,
      } of this.pending.splice(0)) {
        this.module = module;
        const target = this.targetOf(symbol, shouldDocument);
        if (target) holder.target = target;
      }
    }
    for (const { owner, candidates } of this.comments.values()) {
      for (const { file, node, isOverload } of candidates) {
        const raw = findComment(file, node);
        // Comments of members copied from bases link from where they are
        // written: from their bases, or their files for bases outside the model.
        const context =
          this.declarations.get(node) ??
          (this.copies.has(owner.declaration) ? undefined : owner.declaration);
        if (
          raw !== undefined &&
          this.addComment(owner, file, raw, node.type === "Program", context)
        ) {
          // Overloads are hidden by their own comments only.
          if (
            isOverload &&
            owner.kind === "signature" &&
            owner.signature.comment
          ) {
            owner.signature.comment.modifierTags =
              owner.signature.comment.modifierTags.filter(
                (tag) => !hidingTags.has(tag),
              );
          }
          break;
        }
      }
    }
    const done = new Set<Declaration>();
    for (const declaration of this.byId.values()) {
      this.inherit(declaration, done);
    }
    const kept = new Set<number>();
    for (const module of this.modules) this.hide(module, kept);
    // References and bases left without what they refer to are left out.
    const isKept = (type: Type): boolean =>
      type.type !== "reference" ||
      type.target?.kind !== "declaration" ||
      kept.has(type.target.id);
    for (const id of kept) {
      const declaration = this.byId.get(id)!;
      if (declaration.children) {
        declaration.children = declaration.children.filter(
          (child) => child.target === undefined || kept.has(child.target),
        );
      }
      if (declaration.extends) {
        declaration.extends = declaration.extends.filter(isKept);
        if (declaration.extends.length === 0) delete declaration.extends;
      }
      if (declaration.implements) {
        declaration.implements = declaration.implements.filter(isKept);
        if (declaration.implements.length === 0) delete declaration.implements;
      }
      if (declaration.overwrites && !isKept(declaration.overwrites)) {
        delete declaration.overwrites;
      }
    }
    for (const declaration of this.byId.values()) this.applyTags(declaration);
    // Members of object types once `@enum` has read them in order.
    for (const declaration of this.byId.values()) {
      if (declaration.kind !== "Enum") declaration.children?.sort(compare);
    }
    relativizeSources(this.modules);
    const project: Project = { name: this.options.name, modules: this.modules };
    if (this.options.version !== undefined && this.options.version !== "") {
      project.version = this.options.version;
    }
    return project;
  }

  private create(kind: Kind, name: string): Declaration {
    const declaration: Declaration = {
      id: this.nextId++,
      kind,
      name,
      flags: {},
    };
    this.byId.set(declaration.id, declaration);
    return declaration;
  }

  private adopt(parent: Declaration, child: Declaration): void {
    (parent.children ??= []).push(child);
    this.parents.set(child, parent);
  }

  /**
   * Converts in a context, and restores the current one afterwards.
   *
   * @param context Where names are looked up.
   * @param conversion The conversion.
   * @returns What the conversion returns.
   */
  private within<Result>(context: Context, conversion: () => Result): Result {
    const saved = this.context;
    this.context = context;
    try {
      return conversion();
    } finally {
      this.context = saved;
    }
  }

  /**
   * Converts with more type parameters in scope.
   *
   * @param names The type parameters' names.
   * @param conversion The conversion.
   * @returns What the conversion returns.
   */
  private withTypeParameters<Result>(
    names: string[] | TSTypeParameterDeclaration | null | undefined,
    conversion: () => Result,
  ): Result {
    const list = Array.isArray(names)
      ? names
      : (names?.params.map((parameter) => parameter.name.name) ?? []);
    if (list.length === 0) return conversion();
    return this.within(
      {
        containers: this.context.containers,
        typeParameters: [...this.context.typeParameters, ...list],
      },
      conversion,
    );
  }

  /**
   * @param path A file's path.
   * @returns Whether the file belongs to a documented package.
   */
  private isDocumented(path: string): boolean {
    return (
      !path.includes(`${sep}node_modules${sep}`) &&
      this.roots.some((root) => path.startsWith(root))
    );
  }

  private addExports(
    parent: Declaration,
    file: SourceFile,
    containers: Node[],
  ): void {
    const symbols = this.program
      .exportNames(file, containers)
      .map(
        (name) =>
          [name, this.program.getExport(file, name, containers)] as const,
      );
    // Declarations are documented where they are exported most directly.
    for (const [name, symbol] of symbols) {
      if (symbol?.kind !== "module") continue;
      // A file exported as a namespace again, even by itself, is referenced.
      const documented = this.namespaces.get(symbol.file);
      if (documented) {
        const reference = this.create("Reference", name);
        reference.target = documented.id;
        this.adopt(parent, reference);
        continue;
      }
      const namespace = this.create("Namespace", name);
      this.namespaces.set(symbol.file, namespace);
      const owner: Owner = { kind: "declaration", declaration: namespace };
      // The comment of the export statement, or else the module's.
      const statement = this.program.exportStatement(file, name, containers);
      if (statement) this.comment(owner, file, statement);
      this.comment(owner, symbol.file, symbol.file.program);
      this.addSource(namespace, symbol.file, symbol.file.program);
      this.adopt(parent, namespace);
      const { module } = this;
      this.later.push(() => {
        this.module = module;
        this.addExports(namespace, symbol.file, []);
      });
    }
    // A declaration exported under several names is documented under its own.
    const declared = symbols.toSorted(
      ([nameA, symbolA], [nameB, symbolB]) =>
        Number(symbolB?.name === nameB) - Number(symbolA?.name === nameA),
    );
    for (const [name, symbol] of declared) {
      if (symbol?.kind !== "declaration") continue;
      const statement = this.program.exportStatement(file, name, containers);
      const existing = this.declarations.get(symbol.nodes[0]);
      if (existing || !this.isDocumented(symbol.file.path)) {
        // Exported twice, or exported from a dependency.
        const reference = this.create("Reference", name);
        if (existing) {
          reference.target = existing.id;
        } else {
          const target = this.targetOf(symbol, false);
          if (target) reference.type = { type: "reference", name, target };
        }
        if (statement) {
          this.comment(
            { kind: "declaration", declaration: reference },
            file,
            statement,
          );
        }
        this.adopt(parent, reference);
        continue;
      }
      const declaration = this.convertSymbol(symbol, name);
      if (!declaration) continue;
      // The export statement's comment is for declarations without their own,
      // and comes first for namespaces.
      if (statement && declaration.kind === "Namespace") {
        this.comments
          .get(declaration)
          ?.candidates.unshift({ file, node: statement });
      } else if (statement) {
        this.comment({ kind: "declaration", declaration }, file, statement);
      }
      this.adopt(parent, declaration);
    }
  }

  /**
   * Finds where a link to a symbol goes.
   *
   * @param symbol The symbol.
   * @param shouldDocument Whether to document a top-level declaration of the
   *   project that is not exported (in the current module).
   * @returns The target, or `undefined` if there is nothing to link to.
   */
  private targetOf(
    symbol: Symbol,
    shouldDocument: boolean,
  ): Target | undefined {
    if (symbol.kind === "global") {
      const url = globalUrl(symbol.name);
      return url === undefined ? undefined : { kind: "url", url };
    }
    if (symbol.kind === "module") {
      const namespace = this.namespaces.get(symbol.file);
      return namespace && { kind: "declaration", id: namespace.id };
    }
    const existing = this.declarations.get(symbol.nodes[0]);
    if (existing) return { kind: "declaration", id: existing.id };
    if (!this.isDocumented(symbol.file.path)) {
      return this.externalTarget(symbol);
    }
    // Members of classes and interfaces are documented with them.
    const [node] = symbol.nodes as [Node];
    const isTopLevel =
      declaredNames(node).length > 0 || node.type === "VariableDeclarator";
    if (!shouldDocument || !isTopLevel) return undefined;
    const declaration = this.convertSymbol(symbol, symbol.name);
    if (!declaration) return undefined;
    this.adopt(this.module, declaration);
    return { kind: "declaration", id: declaration.id };
  }

  /**
   * @param symbol A declaration of a dependency.
   * @returns A link to the dependency's docs, if they are configured.
   */
  private externalTarget(symbol: Declared): Target | undefined {
    // The last `node_modules`: package managers nest them (`.pnpm/…`).
    const packageName = /.*node_modules[/\\](?<name>(?:@[^/\\]+[/\\])?[^/\\]+)/u
      .exec(symbol.file.path)
      ?.groups?.["name"]?.replaceAll("\\", "/");
    if (packageName === undefined) return undefined;
    const index = this.options.symbols?.get(packageName);
    if (index) {
      // Members of namespaces, classes and enums by their qualified names.
      const name = [
        ...[...symbol.containers, ...(symbol.owner ? [symbol.owner] : [])]
          .flatMap((container) => declaredNames(container))
          .map(([part]) => part),
        symbol.name,
      ].join(".");
      const url = index.get(name);
      return url === undefined ? undefined : { kind: "url", url };
    }
    const base = this.options.links?.[packageName];
    const kind = kindOf(symbol.nodes);
    const directory = kind && kindDirectories[kind];
    if (base === undefined || base === "" || directory === undefined) {
      return undefined;
    }
    const url = base.includes("{")
      ? base.replace("{kind}", directory).replace("{name}", symbol.name)
      : `${base.replace(/\/?$/u, "/")}${directory}/${symbol.name}.html`;
    return { kind: "url", url };
  }

  private convertSymbol(
    symbol: Declared,
    name: string,
  ): Declaration | undefined {
    const kind = kindOf(symbol.nodes);
    if (!kind) return undefined;
    const declaration = this.create(kind, name);
    for (const node of symbol.nodes) this.declarations.set(node, declaration);
    if (!this.byName.has(name)) this.byName.set(name, declaration);
    this.within({ containers: symbol.containers, typeParameters: [] }, () =>
      this.convertNodes(declaration, symbol),
    );
    return declaration;
  }

  private convertNodes(declaration: Declaration, symbol: Declared): void {
    const { file, nodes } = symbol;
    const main = nodes.find((node) => kindOf([node]) === declaration.kind)!;
    this.addSource(declaration, file, main);
    switch (main.type) {
      case "ClassDeclaration":
      case "TSInterfaceDeclaration": {
        this.convertClassLike(declaration, file, nodes);
        break;
      }
      case "TSEnumDeclaration": {
        this.comment({ kind: "declaration", declaration }, file, main);
        if (main.const) declaration.flags.const = true;
        const members = nodes.flatMap((node) =>
          node.type === "TSEnumDeclaration" ? node.body.members : [],
        );
        for (const member of members) {
          const child = this.create(
            "EnumMember",
            keyName(file, member.id, false)!,
          );
          this.declarations.set(member, child);
          this.addSource(child, file, member);
          this.comment(
            { kind: "declaration", declaration: child },
            file,
            member,
          );
          if (member.initializer) {
            child.defaultValue = textOf(file, member.initializer);
          }
          this.adopt(declaration, child);
        }
        break;
      }
      case "TSDeclareFunction":
      case "FunctionDeclaration": {
        declaration.signatures = nodes
          .filter((node) => node.type === main.type)
          // Signatures are named as exported: `export { impl as name }`.
          .map((node) =>
            this.signature(
              file,
              node as FunctionNode,
              declaration.name,
              declaration,
              node,
            ),
          );
        // Overloads without a comment have the first's.
        for (const signature of declaration.signatures.slice(1)) {
          this.comment(
            { kind: "signature", signature, declaration },
            file,
            main,
            true,
          );
        }
        break;
      }
      case "VariableDeclarator": {
        this.comment({ kind: "declaration", declaration }, file, main);
        const annotation =
          main.id.type === "Identifier" ? main.id.typeAnnotation : undefined;
        if (annotation) {
          declaration.type = this.type(file, annotation.typeAnnotation);
        }
        if (main.init) declaration.defaultValue = textOf(file, main.init);
        if (isConst(main)) declaration.flags.const = true;
        break;
      }
      case "TSTypeAliasDeclaration": {
        this.comment({ kind: "declaration", declaration }, file, main);
        this.typeParameters(declaration, file, main.typeParameters);
        declaration.type = this.withTypeParameters(main.typeParameters, () =>
          this.type(file, main.typeAnnotation),
        );
        break;
      }
      case "TSModuleDeclaration": {
        this.comment({ kind: "declaration", declaration }, file, main);
        break;
      }
      default:
    }
    // Namespaces merged into other declarations add their members.
    for (const node of nodes) {
      if (node.type === "TSModuleDeclaration") {
        this.addExports(declaration, file, [...this.context.containers, node]);
      }
    }
  }

  private convertClassLike(
    declaration: Declaration,
    file: SourceFile,
    nodes: Node[],
  ): void {
    const groups = new Map<string, MemberGroup>();
    const heritage: {
      expression: Node;
      typeArguments: TSTypeParameterInstantiation | null | undefined;
      isExtends: boolean;
      /** Interfaces merged into a class add their bases' members as its own. */
      isMerged?: boolean;
    }[] = [];
    let typeParameterNames: string[] = [];
    for (const node of nodes) {
      if (
        node.type !== "ClassDeclaration" &&
        node.type !== "TSInterfaceDeclaration"
      ) {
        continue;
      }
      this.comment({ kind: "declaration", declaration }, file, node);
      if (!declaration.typeParameters) {
        this.typeParameters(declaration, file, node.typeParameters);
        typeParameterNames =
          node.typeParameters?.params.map((parameter) => parameter.name.name) ??
          [];
      }
      if (node.type === "ClassDeclaration") {
        if (node.abstract) declaration.flags.abstract = true;
        if (node.superClass) {
          heritage.push({
            expression: node.superClass,
            typeArguments: node.superTypeArguments,
            isExtends: true,
          });
        }
        for (const clause of node.implements ?? []) {
          heritage.push({
            expression: clause.expression,
            typeArguments: clause.typeArguments,
            isExtends: false,
          });
        }
      } else if (node.type === "TSInterfaceDeclaration") {
        for (const clause of node.extends) {
          heritage.push({
            expression: clause.expression,
            typeArguments: clause.typeArguments,
            isExtends: true,
            isMerged: declaration.kind === "Class",
          });
        }
      }
    }
    // Extended bases document members before implemented ones.
    heritage.sort(
      (left, right) => Number(right.isExtends) - Number(left.isExtends),
    );
    const context: Context = {
      containers: this.context.containers,
      typeParameters: typeParameterNames,
    };
    for (const node of nodes) {
      if (node.type === "ClassDeclaration") {
        groupMembers(groups, file, node.body.body, context);
      } else if (node.type === "TSInterfaceDeclaration") {
        groupMembers(groups, file, node.body.body, context);
      }
    }
    for (const group of groups.values()) {
      this.addMember(declaration, group, true);
    }
    const seen = new Set<string>();
    const reached = new Set<Node>();
    const declared = [...(declaration.children ?? [])];
    // Private constructors are left out, yet replace their bases' too.
    const hasConstructor = nodes.some(
      (node) =>
        node.type === "ClassDeclaration" &&
        node.body.body.some(
          (member) =>
            member.type === "MethodDefinition" && member.kind === "constructor",
        ),
    );
    for (const clause of heritage) {
      // Merged declarations may repeat a base.
      const { end } = clause.typeArguments ?? clause.expression;
      const key = `${clause.isExtends} ${file.text.slice(clause.expression.start, end)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const type = this.within(context, () =>
        this.heritageType(file, clause.expression, clause.typeArguments),
      );
      if (clause.isExtends) (declaration.extends ??= []).push(type);
      else (declaration.implements ??= []).push(type);
      const bases = this.within(context, () =>
        this.baseMembers(file, clause.expression, new Set()),
      );
      for (const base of bases) {
        // Bases reached through several clauses are inherited once.
        if (base.nodes.some((node) => reached.has(node))) continue;
        const isConstructor = isConstructorGroup(base);
        // Interfaces extending classes extend their instances, also where
        // they merge into classes.
        if (
          (declaration.kind === "Interface" || clause.isMerged) &&
          (base.isStatic || isConstructor)
        ) {
          continue;
        }
        // Implemented members are not inherited, so extended ones still are.
        if (clause.isExtends) for (const node of base.nodes) reached.add(node);
        // Members of other bases with the name are not overridden here.
        const own = declared.find(
          (child) =>
            child.name === base.name &&
            Boolean(child.flags.static) === base.isStatic,
        );
        if (
          !own &&
          ((hasConstructor && isConstructor) ||
            declaration.children?.some(
              (child) =>
                child.name === base.name &&
                Boolean(child.flags.static) === base.isStatic,
            ))
        ) {
          continue;
        }
        if (own) {
          // Members two bases declare override the first's.
          if (clause.isExtends && base.owner !== undefined) {
            own.overwrites ??= this.memberReference(base);
          }
          // Constructors take parameters of their own, so their own docs.
          if (own.kind !== "Constructor") {
            this.bases.set(own, [...(this.bases.get(own) ?? []), base]);
          }
        } else if (clause.isExtends) {
          const inherited = this.addMember(declaration, base, false);
          if (inherited) this.copies.add(inherited);
          if (inherited) this.bases.set(inherited, [base]);
          if (inherited && base.owner !== undefined && !clause.isMerged) {
            inherited.inheritedFrom = this.memberReference(base);
          }
        }
      }
    }
  }

  /**
   * @param base Members of a base type.
   * @returns A reference to them.
   */
  private memberReference(base: MemberGroup): Type {
    const reference: Type = {
      type: "reference",
      name: `${base.owner}.${base.name}`,
    };
    this.pending.push({
      holder: reference,
      symbol: {
        kind: "declaration",
        name: base.name,
        file: base.file,
        nodes: base.nodes,
        containers: base.context.containers,
      },
      module: this.module,
      // Members of bases are linked, not documented on their own.
      shouldDocument: false,
    });
    return reference;
  }

  /**
   * Finds the members a class or interface inherits through a heritage
   * clause: from classes, interfaces, type aliases of object types and
   * intersections, and modules (`typeof Namespace`).
   *
   * @param file The file the clause is in.
   * @param node The clause's expression or type.
   * @param seen Declarations already visited, against cycles.
   * @returns The members, grouped by name.
   */
  private baseMembers(
    file: SourceFile,
    node: Node,
    seen: Set<Node>,
  ): MemberGroup[] {
    switch (node.type) {
      case "TSIntersectionType": {
        return node.types.flatMap((type) => this.baseMembers(file, type, seen));
      }
      case "TSTypeLiteral": {
        const groups = new Map<string, MemberGroup>();
        groupMembers(groups, file, node.members, this.context);
        return [...groups.values()];
      }
      case "TSTypeReference": {
        return this.baseMembers(file, node.typeName, seen);
      }
      case "TSTypeQuery": {
        const symbol = this.resolveName(file, node.exprName, true);
        return symbol ? this.symbolMembers(symbol, seen) : [];
      }
      case "Identifier":
      case "MemberExpression":
      case "TSQualifiedName": {
        const symbol = this.resolveName(file, node);
        return symbol ? this.symbolMembers(symbol, seen) : [];
      }
      default: {
        return [];
      }
    }
  }

  /**
   * @param file The file the type is in.
   * @param type The type of a class value, as declarations type mixins.
   * @param seen Declarations already visited, against cycles.
   * @returns The members of its instances: what its construct signatures
   *   return, and those of the classes it is the type of.
   */
  private constructed(
    file: SourceFile,
    type: Node,
    seen: Set<Node>,
  ): MemberGroup[] {
    switch (type.type) {
      case "TSIntersectionType": {
        // Each part is read on its own: `(new () => A) & typeof A` gives A's
        // instance members, then its statics.
        const nodes = new Set<Node>();
        return type.types
          .flatMap((inner) => this.constructed(file, inner, new Set(seen)))
          .filter((group) => {
            const [first] = group.nodes;
            if (nodes.has(first)) return false;
            nodes.add(first);
            return true;
          });
      }
      case "TSTypeLiteral": {
        // Its named members are the statics of the classes it types.
        const groups = new Map<string, MemberGroup>();
        groupMembers(groups, file, type.members, this.context);
        const statics = [...groups].flatMap(([key, group]) => {
          if (key.startsWith("signature")) return [];
          group.isStatic = true;
          return [group];
        });
        return [
          ...type.members.flatMap((member) =>
            member.type === "TSConstructSignatureDeclaration" &&
            member.returnType
              ? instanceMembers(
                  this.baseMembers(
                    file,
                    member.returnType.typeAnnotation,
                    seen,
                  ),
                )
              : [],
          ),
          ...statics,
        ];
      }
      case "TSConstructorType": {
        return instanceMembers(
          this.baseMembers(file, type.returnType.typeAnnotation, seen),
        );
      }
      case "TSTypeQuery": {
        return this.baseMembers(file, type, seen);
      }
      default: {
        return [];
      }
    }
  }

  private symbolMembers(symbol: Symbol, seen: Set<Node>): MemberGroup[] {
    if (symbol.kind === "module") {
      return this.program.exportNames(symbol.file).flatMap((name) => {
        const member = this.program.getExport(symbol.file, name);
        return member?.kind === "declaration"
          ? [
              {
                name,
                isStatic: false,
                file: member.file,
                nodes: member.nodes,
                context: { containers: member.containers, typeParameters: [] },
              },
            ]
          : [];
      });
    }
    if (symbol.kind !== "declaration" || seen.has(symbol.nodes[0])) return [];
    seen.add(symbol.nodes[0]);
    const groups = new Map<string, MemberGroup>();
    const inherited: MemberGroup[] = [];
    const implemented: [MemberGroup, MemberGroup][] = [];
    for (const node of symbol.nodes) {
      // Classes extending mixins extend what their variables' types construct.
      if (node.type === "VariableDeclarator" && node.id.typeAnnotation) {
        const { typeAnnotation } = node.id.typeAnnotation;
        const context = { containers: symbol.containers, typeParameters: [] };
        inherited.push(
          ...this.within(context, () =>
            this.constructed(symbol.file, typeAnnotation, seen),
          ),
        );
      }
      if (
        node.type !== "ClassDeclaration" &&
        node.type !== "TSInterfaceDeclaration" &&
        node.type !== "TSTypeAliasDeclaration"
      ) {
        continue;
      }
      const context: Context = {
        containers: symbol.containers,
        typeParameters:
          node.typeParameters?.params.map((parameter) => parameter.name.name) ??
          [],
      };
      this.within(context, () => {
        if (node.type === "ClassDeclaration") {
          groupMembers(
            groups,
            symbol.file,
            node.body.body,
            context,
            symbol.name,
          );
          if (node.superClass) {
            inherited.push(
              ...this.baseMembers(symbol.file, node.superClass, seen),
            );
          }
          // Implemented members only document those declared here.
          for (const clause of node.implements ?? []) {
            // A traversal of its own leaves bases to inherit from.
            for (const group of this.baseMembers(
              symbol.file,
              clause.expression,
              new Set(seen),
            )) {
              const own = groups.get(
                memberKey(group.nodes[0], group.name, group.isStatic),
              );
              if (own) implemented.push([own, group]);
            }
          }
        } else if (node.type === "TSInterfaceDeclaration") {
          groupMembers(
            groups,
            symbol.file,
            node.body.body,
            context,
            symbol.name,
          );
          for (const clause of node.extends) {
            inherited.push(
              ...instanceMembers(
                this.baseMembers(symbol.file, clause.expression, seen),
              ),
            );
          }
        } else if (node.type === "TSTypeAliasDeclaration") {
          // Members of object types and modules are named after the alias.
          for (const group of this.baseMembers(
            symbol.file,
            node.typeAnnotation,
            seen,
          )) {
            group.owner ??= symbol.name;
            inherited.push(group);
          }
        }
      });
    }
    for (const group of inherited) {
      const key = memberKey(group.nodes[0], group.name, group.isStatic);
      const own = groups.get(key);
      // Signatures of bases add to those declared here, members override;
      // constructors take parameters of their own, so their own docs.
      if (own && !key.startsWith("signature")) {
        if (!isConstructorGroup(own)) appendBase(own, group);
      } else groups.set(own ? `${key} ${groups.size}` : key, group);
    }
    // Implemented members document after those of superclasses.
    for (const [own, group] of implemented) appendBase(own, group);
    return [...groups.values()];
  }

  /**
   * Converts members sharing a name.
   *
   * @param parent The class, interface or object type.
   * @param group The members.
   * @param isOwn Whether they are the parent's own (not inherited).
   * @returns The member; `undefined` for signatures, which the parent keeps.
   */
  private addMember(
    parent: Declaration,
    group: MemberGroup,
    isOwn: boolean,
  ): Declaration | undefined {
    return this.within(group.context, () =>
      this.convertMember(parent, group, isOwn),
    );
  }

  private convertMember(
    parent: Declaration,
    group: MemberGroup,
    isOwn: boolean,
  ): Declaration | undefined {
    const { file, nodes, name } = group;
    const [first] = nodes as [Node];
    if (first.type === "TSIndexSignature") {
      // Index signatures replace those of bases for the same type of key.
      const keys = new Set(parent.indexSignatures?.map(indexKey));
      for (const node of nodes as TSIndexSignature[]) {
        const signature: Signature = {
          name: "__index",
          parameters: node.parameters.map((parameter) =>
            this.parameter(file, parameter),
          ),
          returns: this.type(file, node.typeAnnotation.typeAnnotation),
        };
        if (node.readonly) signature.readonly = true;
        if (node.static) signature.static = true;
        if (keys.has(indexKey(signature))) continue;
        (parent.indexSignatures ??= []).push(signature);
        this.comment(
          { kind: "signature", signature, declaration: parent },
          file,
          node,
        );
      }
      return undefined;
    }
    if (
      first.type === "TSCallSignatureDeclaration" ||
      first.type === "TSConstructSignatureDeclaration"
    ) {
      const signatures = nodes.map((node) =>
        this.signature(
          file,
          node as TSCallSignatureDeclaration,
          // Call signatures of object types are anonymous.
          node.type === "TSConstructSignatureDeclaration"
            ? "new"
            : parent.kind === "TypeLiteral"
              ? ""
              : parent.name,
          parent,
          node,
        ),
      );
      parent.signatures = [...(parent.signatures ?? []), ...signatures];
      return undefined;
    }
    const kind = memberKind(first);
    if (!kind) return undefined;
    const member = this.create(kind, name);
    if (isOwn) {
      for (const node of nodes) this.declarations.set(node, member);
    }
    if (group.isStatic) member.flags.static = true;
    for (const node of nodes) {
      if ("optional" in node && node.optional === true) {
        member.flags.optional = true;
      }
      if ("readonly" in node && node.readonly === true) {
        member.flags.readonly = true;
      }
      if ("accessibility" in node && node.accessibility === "protected") {
        member.flags.protected = true;
      }
      if (node.type.startsWith("TSAbstract")) member.flags.abstract = true;
    }
    // Members of object types are shown with their types, not on their own.
    if (parent.kind !== "TypeLiteral") this.addSource(member, file, first);
    switch (kind) {
      case "Constructor": {
        member.name = "constructor";
        member.signatures = (nodes as MethodDefinition[]).map((node) => {
          const signature = this.signature(
            file,
            node.value,
            `new ${parent.name}`,
            member,
            node,
          );
          const returns: Type = {
            type: "reference",
            name: parent.name,
            target: { kind: "declaration", id: parent.id },
          };
          if (parent.typeParameters) {
            signature.typeParameters = parent.typeParameters.map(
              (parameter) => ({ ...parameter }),
            );
            returns.typeArguments = parent.typeParameters.map((parameter) => ({
              type: "reference",
              name: parameter.name,
              typeParameter: true,
            }));
          }
          signature.returns = returns;
          return signature;
        });
        break;
      }
      case "Method": {
        member.signatures = nodes.map((node) =>
          this.signature(
            file,
            ("value" in node ? node.value : node) as FunctionLike,
            name,
            member,
            node,
          ),
        );
        // Overloads of class methods without a comment have the first's.
        const overloads =
          first.type === "TSMethodSignature" ? [] : member.signatures.slice(1);
        for (const signature of overloads) {
          this.comment(
            { kind: "signature", signature, declaration: member },
            file,
            first,
            true,
          );
        }
        break;
      }
      case "Accessor": {
        for (const node of nodes) {
          const signature = this.signature(
            file,
            ("value" in node ? node.value : node) as FunctionLike,
            name,
            member,
            node,
          );
          if ("kind" in node && node.kind === "get") {
            member.getSignature = signature;
          } else {
            member.setSignature = signature;
          }
        }
        break;
      }
      default: {
        this.comment({ kind: "declaration", declaration: member }, file, first);
        const annotation =
          first.type === "VariableDeclarator"
            ? first.id.type === "Identifier"
              ? first.id.typeAnnotation
              : null
            : "typeAnnotation" in first
              ? (first.typeAnnotation as TSTypeAnnotation | null | undefined)
              : null;
        if (annotation) {
          member.type = this.type(file, annotation.typeAnnotation);
        }
      }
    }
    this.adopt(parent, member);
    return member;
  }

  /**
   * @param file The file the signature is in.
   * @param node The function, method or signature.
   * @param name The signature's name.
   * @param declaration The declaration the signature belongs to.
   * @param commentNode The node the signature's comment is before; none for
   *   signatures without comments of their own.
   * @returns The signature.
   */
  private signature(
    file: SourceFile,
    node: FunctionLike,
    name: string,
    declaration: Declaration,
    commentNode: Node | undefined,
  ): Signature {
    return this.withTypeParameters(node.typeParameters, () => {
      const signature: Signature = {
        name,
        parameters: node.params.map((parameter) =>
          this.parameter(file, parameter),
        ),
      };
      for (const [index, parameter] of signature.parameters.entries()) {
        this.comment(
          { kind: "parameter", parameter, signature, declaration },
          file,
          node.params[index],
        );
      }
      const typeParameters = this.typeParameterList(file, node.typeParameters);
      if (typeParameters) signature.typeParameters = typeParameters;
      if (node.returnType) {
        signature.returns = this.type(file, node.returnType.typeAnnotation);
      }
      if (commentNode) {
        // Signatures of function types are not shown on their own.
        if (declaration.kind !== "TypeLiteral") {
          signature.sources = [this.locate(file, commentNode)];
        }
        this.comment(
          { kind: "signature", signature, declaration },
          file,
          commentNode,
        );
      }
      return signature;
    });
  }

  private parameter(file: SourceFile, node: Node): Parameter {
    switch (node.type) {
      case "Identifier": {
        const parameter: Parameter = { name: node.name };
        if (node.optional) parameter.optional = true;
        if (node.typeAnnotation) {
          parameter.type = this.type(file, node.typeAnnotation.typeAnnotation);
        }
        return parameter;
      }
      case "RestElement": {
        const parameter = this.parameter(file, node.argument);
        parameter.rest = true;
        if (node.typeAnnotation) {
          parameter.type = this.type(file, node.typeAnnotation.typeAnnotation);
        }
        return parameter;
      }
      case "AssignmentPattern": {
        const parameter = this.parameter(file, node.left);
        parameter.optional = true;
        return parameter;
      }
      case "TSParameterProperty": {
        return this.parameter(file, node.parameter);
      }
      default: {
        // Destructured, named as TypeDoc names them (unless `@param` renames).
        const parameter: Parameter = { name: "__namedParameters" };
        // Defaults make them optional: `{ name }?: Options`.
        if ("optional" in node && node.optional === true) {
          parameter.optional = true;
        }
        if ("typeAnnotation" in node && node.typeAnnotation) {
          parameter.type = this.type(
            file,
            (node.typeAnnotation as TSTypeAnnotation).typeAnnotation,
          );
        }
        return parameter;
      }
    }
  }

  private typeParameterList(
    file: SourceFile,
    node: TSTypeParameterDeclaration | null | undefined,
  ): TypeParameter[] | undefined {
    return node?.params.map((parameter) => {
      const result: TypeParameter = { name: parameter.name.name };
      const modifiers = (["const", "in", "out"] as const).filter(
        (modifier) => parameter[modifier],
      );
      if (modifiers.length > 0) result.modifiers = modifiers;
      if (parameter.constraint) {
        result.constraint = this.type(file, parameter.constraint);
      }
      if (parameter.default) {
        result.default = this.type(file, parameter.default);
      }
      return result;
    });
  }

  private typeParameters(
    declaration: Declaration,
    file: SourceFile,
    node: TSTypeParameterDeclaration | null | undefined,
  ): void {
    const parameters = this.withTypeParameters(node, () =>
      this.typeParameterList(file, node),
    );
    if (parameters) declaration.typeParameters = parameters;
  }

  private heritageType(
    file: SourceFile,
    expression: Node,
    typeArguments: TSTypeParameterInstantiation | null | undefined,
  ): Type {
    const reference: Type = {
      type: "reference",
      name: textOf(file, expression),
    };
    const symbol = this.resolveName(file, expression);
    if (symbol) this.link(reference, symbol);
    if (typeArguments) {
      reference.typeArguments = typeArguments.params.map((type) =>
        this.type(file, type),
      );
    }
    return reference;
  }

  /**
   * @param file The file a name is in.
   * @param node An identifier, or a qualified name (`A.B`, `a.b`).
   * @param isValue Whether the name is a value's, as in `typeof a.b`.
   * @returns What the name refers to; `undefined` for type parameters and
   *   members that cannot be found.
   */
  private resolveName(
    file: SourceFile,
    node: Node,
    isValue = false,
  ): Symbol | undefined {
    switch (node.type) {
      case "Identifier": {
        return this.context.typeParameters.includes(node.name)
          ? undefined
          : this.program.getLocal(
              file,
              node.name,
              this.context.containers,
              isValue,
            );
      }
      case "TSQualifiedName": {
        const left = this.resolveName(file, node.left, isValue);
        return left && this.program.getMember(left, node.right.name);
      }
      case "MemberExpression": {
        const left = this.resolveName(file, node.object, isValue);
        return left && node.property.type === "Identifier"
          ? this.program.getMember(left, node.property.name)
          : undefined;
      }
      default: {
        return undefined;
      }
    }
  }

  /**
   * Links a reference to a symbol, once every declaration is converted.
   *
   * @param holder The reference.
   * @param symbol The symbol.
   */
  private link(holder: { target?: Target }, symbol: Symbol): void {
    if (symbol.kind === "global") {
      const target = this.targetOf(symbol, false);
      if (target) holder.target = target;
    } else {
      this.pending.push({
        holder,
        symbol,
        module: this.module,
        shouldDocument: this.options.shouldDocumentUnexported === true,
      });
    }
  }

  private type(file: SourceFile, node: TSType): Type {
    switch (node.type) {
      case "TSAnyKeyword":
      case "TSUnknownKeyword":
      case "TSNumberKeyword":
      case "TSStringKeyword":
      case "TSBooleanKeyword":
      case "TSBigIntKeyword":
      case "TSSymbolKeyword":
      case "TSObjectKeyword":
      case "TSNeverKeyword":
      case "TSVoidKeyword":
      case "TSUndefinedKeyword":
      case "TSNullKeyword":
      case "TSIntrinsicKeyword":
      case "TSThisType": {
        return { type: "intrinsic", name: textOf(file, node) };
      }
      case "TSLiteralType": {
        return { type: "literal", value: textOf(file, node) };
      }
      case "TSTypeReference": {
        const reference: Type = {
          type: "reference",
          name: textOf(file, node.typeName),
        };
        if (
          node.typeName.type === "Identifier" &&
          this.context.typeParameters.includes(node.typeName.name)
        ) {
          reference.typeParameter = true;
        } else {
          const symbol = this.resolveName(file, node.typeName);
          if (symbol) this.link(reference, symbol);
        }
        if (node.typeArguments) {
          reference.typeArguments = node.typeArguments.params.map((type) =>
            this.type(file, type),
          );
        }
        return reference;
      }
      case "TSUnionType":
      case "TSIntersectionType": {
        return {
          type: node.type === "TSUnionType" ? "union" : "intersection",
          types: node.types.map((type) => this.type(file, type)),
        };
      }
      case "TSArrayType": {
        return {
          type: "array",
          elementType: this.type(file, node.elementType),
        };
      }
      case "TSTupleType": {
        return {
          type: "tuple",
          elements: node.elementTypes.map((element) =>
            this.tupleElement(file, element),
          ),
        };
      }
      case "TSTypeLiteral": {
        const declaration = this.create("TypeLiteral", "__type");
        const groups = new Map<string, MemberGroup>();
        groupMembers(groups, file, node.members, this.context);
        for (const group of groups.values()) {
          this.addMember(declaration, group, true);
        }
        return { type: "object", declaration };
      }
      case "TSFunctionType":
      case "TSConstructorType": {
        const holder = this.create("TypeLiteral", "__type");
        const result: Type = {
          type: "function",
          signature: this.signature(file, node, "__type", holder, undefined),
        };
        if (node.type === "TSConstructorType") {
          result.construct = node.abstract ? "abstract new" : "new";
        }
        return result;
      }
      case "TSTypeOperator": {
        return {
          type: "operator",
          operator: node.operator,
          target: this.type(file, node.typeAnnotation),
        };
      }
      case "TSIndexedAccessType": {
        return {
          type: "indexedAccess",
          objectType: this.type(file, node.objectType),
          indexType: this.type(file, node.indexType),
        };
      }
      case "TSConditionalType": {
        // `infer` declares type parameters for the true branch.
        const inferred = inferredNames(node.extendsType);
        return {
          type: "conditional",
          checkType: this.type(file, node.checkType),
          extendsType: this.withTypeParameters(inferred, () =>
            this.type(file, node.extendsType),
          ),
          trueType: this.withTypeParameters(inferred, () =>
            this.type(file, node.trueType),
          ),
          falseType: this.type(file, node.falseType),
        };
      }
      case "TSInferType": {
        const result: Type = {
          type: "infer",
          name: node.typeParameter.name.name,
        };
        if (node.typeParameter.constraint) {
          result.constraint = this.type(file, node.typeParameter.constraint);
        }
        return result;
      }
      case "TSMappedType": {
        const result: Type = {
          type: "mapped",
          parameter: node.key.name,
          constraint: this.type(file, node.constraint),
        };
        this.withTypeParameters([node.key.name], () => {
          if (node.nameType) result.nameType = this.type(file, node.nameType);
          if (node.typeAnnotation) {
            result.templateType = this.type(file, node.typeAnnotation);
          }
        });
        if (node.readonly !== null) result.readonly = node.readonly;
        if (node.optional !== false) result.optional = node.optional;
        return result;
      }
      case "TSTypeQuery": {
        if (node.exprName.type === "TSImportType") {
          return this.importType(file, node.exprName, "query");
        }
        const result: Type = {
          type: "query",
          name: textOf(file, node.exprName),
        };
        const symbol = this.resolveName(file, node.exprName, true);
        if (symbol) this.link(result, symbol);
        if (node.typeArguments) {
          result.typeArguments = node.typeArguments.params.map((type) =>
            this.type(file, type),
          );
        }
        return result;
      }
      case "TSTemplateLiteralType": {
        return {
          type: "templateLiteral",
          head: node.quasis[0].value.raw,
          tail: node.types.map((type, index) => [
            this.type(file, type),
            node.quasis[index + 1].value.raw,
          ]),
        };
      }
      case "TSTypePredicate": {
        const result: Type = {
          type: "predicate",
          name: textOf(file, node.parameterName),
        };
        if (node.asserts) result.asserts = true;
        if (node.typeAnnotation) {
          result.targetType = this.type(
            file,
            node.typeAnnotation.typeAnnotation,
          );
        }
        return result;
      }
      case "TSImportType": {
        return this.importType(file, node);
      }
      default: {
        return { type: "intrinsic", name: textOf(file, node) };
      }
    }
  }

  /**
   * @param file The file the type is in.
   * @param node `import("./module").Name<Arguments>`.
   * @param kind A reference to the name, or `typeof` it.
   * @returns The reference or query.
   */
  private importType(
    file: SourceFile,
    node: TSImportType,
    kind: "reference" | "query" = "reference",
  ): Type {
    const text = textOf(file, node.qualifier ?? node);
    const reference: Type =
      kind === "query"
        ? { type: "query", name: text }
        : { type: "reference", name: text };
    const target = this.program.importedFile(file, node.source.value);
    if (target && node.qualifier) {
      const names: string[] = [];
      let name: Node = node.qualifier;
      while (name.type === "TSQualifiedName") {
        names.unshift(name.right.name);
        name = name.left;
      }
      if (name.type === "Identifier") names.unshift(name.name);
      let symbol: Symbol | undefined = {
        kind: "module",
        name: "",
        file: target,
      };
      for (const part of names) {
        symbol &&= this.program.getMember(symbol, part);
      }
      if (symbol) this.link(reference, symbol);
    }
    if (node.typeArguments) {
      reference.typeArguments = node.typeArguments.params.map((type) =>
        this.type(file, type),
      );
    }
    return reference;
  }

  private tupleElement(file: SourceFile, node: TSTupleElement): TupleElement {
    switch (node.type) {
      case "TSNamedTupleMember": {
        const element = this.tupleElement(file, node.elementType);
        element.name = node.label.name;
        if (node.optional) element.optional = true;
        return element;
      }
      case "TSOptionalType": {
        return { type: this.type(file, node.typeAnnotation), optional: true };
      }
      case "TSRestType": {
        return { ...this.tupleElement(file, node.typeAnnotation), rest: true };
      }
      default: {
        return { type: this.type(file, node) };
      }
    }
  }

  /**
   * @param file A declaration file.
   * @param node A declaration in it.
   * @returns Where the declaration is written, in the sources the file maps
   *   to.
   */
  private locate(file: SourceFile, node: Node): Source {
    let starts = this.lineStarts.get(file);
    if (!starts) {
      starts = [0];
      for (let index = 0; index < file.text.length; index++) {
        if (file.text[index] === "\n") starts.push(index + 1);
      }
      this.lineStarts.set(file, starts);
    }
    const lines = starts;
    const lineOf = (offset: number): number => {
      let low = 0;
      let high = lines.length - 1;
      while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (lines[middle] <= offset) low = middle;
        else high = middle - 1;
      }
      return low;
    };
    // Declaration maps map names: the position of the name, if there is one.
    const named = node as { id?: Node | null; key?: Node };
    const position = (named.id ?? named.key ?? node).start;
    const line = lineOf(position);
    const located = this.sources.locate(
      file.path,
      line,
      position - lines[line],
      lineOf(node.end),
    );
    // A file is located at its first line.
    if (node.type === "Program") located.line = 1;
    const source: Source = { file: located.file, line: located.line };
    const url = this.sources.url(located.file, located.line);
    if (url !== undefined) source.url = url;
    return source;
  }

  private addSource(
    declaration: Declaration,
    file: SourceFile,
    node: Node,
  ): void {
    (declaration.sources ??= []).push(this.locate(file, node));
  }

  private comment(
    owner: Owner,
    file: SourceFile,
    node: Node,
    isOverload = false,
  ): void {
    const key =
      owner.kind === "signature"
        ? owner.signature
        : owner.kind === "parameter"
          ? owner.parameter
          : owner.declaration;
    const entry = this.comments.get(key);
    const candidate = { file, node, isOverload };
    if (entry) entry.candidates.push(candidate);
    else this.comments.set(key, { owner, candidates: [candidate] });
  }

  /**
   * @param owner What the comment describes.
   * @param file The file the comment is in.
   * @param raw The comment.
   * @param isFileComment Whether it is a file's first comment, which
   *   describes a module only if tagged `@module` or `@packageDocumentation`.
   *   Comments so tagged describe nothing else.
   * @param context The declaration links are resolved from.
   * @returns Whether the comment describes the owner; if not, the next
   *   candidate's may.
   */
  private addComment(
    owner: Owner,
    file: SourceFile,
    raw: string,
    isFileComment: boolean,
    context: Declaration | undefined,
  ): boolean {
    const comment = parseComment(raw, (reference) =>
      this.resolveLink(reference, context, file),
    );
    const isModuleComment =
      comment.modifierTags.includes("@packageDocumentation") ||
      comment.blockTags.some((tag) => tag.tag === "@module");
    if (isModuleComment !== isFileComment) return false;
    if (owner.kind === "parameter") {
      const { parameter } = owner;
      if (isHidden(comment)) this.hiddenParameters.add(parameter);
      if (comment.summary.length > 0) parameter.comment = comment.summary;
      if (parameter.type?.type === "function") {
        describeParameters(comment, parameter.type.signature);
      }
      return true;
    }
    const inheritDoc = comment.blockTags.find(
      (tag) => tag.tag === "@inheritDoc",
    );
    // Without a target, it inherits the base's comment, the next candidate.
    if (inheritDoc && inheritDoc.name === undefined) return false;
    const reference =
      inheritDoc?.name ??
      comment.summary.find(
        (part) => part.kind === "inline-tag" && part.tag === "@inheritDoc",
      )?.text;
    const target =
      reference === undefined
        ? undefined
        : this.resolveLink(reference, context, file);
    if (target?.kind === "declaration") {
      this.inheritDocs.set(comment, this.byId.get(target.id)!);
    }
    if (owner.kind === "signature") {
      owner.signature.comment = comment;
      describeParameters(comment, owner.signature);
    } else {
      const { declaration } = owner;
      declaration.comment = comment;
      describeTypeParameters(comment, declaration.typeParameters);
      // Constructors have their class's type parameters, and descriptions
      // unless their own comments describe them.
      const constructor = declaration.children?.find(
        (child) => child.kind === "Constructor",
      );
      for (const signature of constructor?.signatures ?? []) {
        describeTypeParameters(comment, signature.typeParameters);
      }
      if (declaration.type?.type === "function") {
        describeParameters(comment, declaration.type.signature);
      }
    }
    comment.blockTags = comment.blockTags.filter(
      (tag) => tag.tag !== "@param" && tag.tag !== "@typeParam",
    );
    const { flags } = owner.declaration;
    if (comment.modifierTags.includes("@readonly")) {
      // A read-only accessor has no setter.
      if (owner.declaration.kind === "Accessor") {
        delete owner.declaration.setSignature;
      } else {
        flags.readonly = true;
      }
    }
    if (comment.modifierTags.includes("@protected")) flags.protected = true;
    if (comment.modifierTags.includes("@abstract")) flags.abstract = true;
    return true;
  }

  /**
   * Gives a declaration the comments it inherits: what has no comment takes
   * the comment of what it overrides, implements or copies (a class or
   * interface: its first documented base's), and a comment with `@inheritDoc`
   * the summary, `@remarks`, `@returns` and parameter descriptions of the
   * declaration it names.
   *
   * @param declaration The declaration.
   * @param done The declarations already given theirs, against cycles.
   */
  private inherit(declaration: Declaration, done: Set<Declaration>): void {
    if (done.has(declaration)) return;
    done.add(declaration);
    // The declaration, then its signatures by index.
    const holders = [
      declaration,
      ...(declaration.signatures ?? []),
      declaration.getSignature,
      declaration.setSignature,
    ];
    for (const [position, holder] of holders.entries()) {
      const own = holder?.comment;
      const named = own && this.inheritDocs.get(own);
      if (!holder || (own && !named)) continue;
      const isSetter = holder === declaration.setSignature;
      // An overload inherits from the overload at its index, a setter from a
      // setter, anything else from a getter first.
      const find = (base: Declaration): Declaration | Signature | undefined => {
        this.inherit(base, done);
        const signatures =
          base.signatures ??
          (base.type?.type === "function"
            ? [base.type.signature]
            : [
                isSetter
                  ? (base.setSignature ?? base.getSignature)
                  : (base.getSignature ?? base.setSignature),
              ]);
        return [signatures[position - 1], base, signatures[0]].find(
          (candidate) => candidate?.comment,
        );
      };
      let source = named && find(named);
      if (
        !named &&
        holder === declaration &&
        (declaration.kind === "Class" || declaration.kind === "Interface")
      ) {
        for (const type of [
          ...(declaration.extends ?? []),
          ...(declaration.implements ?? []),
        ]) {
          const base =
            type.type === "reference" && type.target?.kind === "declaration"
              ? this.byId.get(type.target.id)
              : undefined;
          if (base) this.inherit(base, done);
          source ??=
            base?.comment && !isHidden(base.comment) ? base : undefined;
        }
      }
      // Methods and accessors have their comments on their signatures.
      const groups =
        named ||
        (holder === declaration &&
          (declaration.signatures || declaration.kind === "Accessor"))
          ? []
          : (this.bases.get(declaration) ?? []);
      for (const first of groups) {
        for (
          let group: MemberGroup | undefined = first;
          group && !source && !holder.comment;
          group = group.overridden
        ) {
          const base = this.declarations.get(group.nodes[0]);
          if (base) {
            source = find(base);
            continue;
          }
          // Bases outside the model: their comments, where they are written.
          const node =
            declaration.kind === "Accessor"
              ? group.nodes.find(
                  (candidate) =>
                    "kind" in candidate &&
                    candidate.kind === (isSetter ? "set" : "get"),
                )
              : (group.nodes[position - 1] ?? group.nodes[0]);
          const raw = node && findComment(group.file, node);
          const owner = this.comments.get(holder)?.owner;
          if (raw !== undefined && owner) {
            this.addComment(owner, group.file, raw, false, undefined);
          }
        }
      }
      // Comments of bases outside the model are already on the holder.
      const inherited = source?.comment ?? (own ? undefined : holder.comment);
      if (!inherited) continue;
      const { summary, blockTags } = inherited;
      holder.comment = own
        ? {
            ...own,
            summary,
            blockTags: [
              ...blockTags.filter((tag) => tag.tag === "@remarks"),
              ...own.blockTags.filter(
                (tag) =>
                  tag.tag !== "@inheritDoc" &&
                  tag.tag !== "@remarks" &&
                  tag.tag !== "@returns",
              ),
              ...blockTags.filter((tag) => tag.tag === "@returns"),
            ],
          }
        : // Declarations of their own are hidden only by their own comments.
          this.copies.has(declaration)
          ? inherited
          : {
              ...inherited,
              modifierTags: inherited.modifierTags.filter(
                (tag) => !hidingTags.has(tag) && tag !== "@hideconstructor",
              ),
            };
      const origin = source && signatureOf(source);
      const target = signatureOf(holder);
      const pairs = [
        [origin?.typeParameters, target.typeParameters],
        [
          origin && "parameters" in origin ? origin.parameters : undefined,
          "parameters" in target ? target.parameters : undefined,
        ],
      ] as const;
      for (const [from, to] of pairs) {
        for (const [index, parameter] of (from ?? []).entries()) {
          const into = to?.[index];
          if (into && parameter.comment) into.comment ??= parameter.comment;
        }
      }
    }
  }

  /**
   * Resolves the target of a `{@link}`: a URL, or a name as TypeDoc's
   * declaration references write it (`Foo.bar`, `Foo#bar`, `module!Foo`).
   *
   * @param reference The link's target.
   * @param context The declaration the comment is on; none for comments of
   *   undocumented bases, whose links resolve in their file.
   * @param file The file the comment is in.
   * @returns The target.
   */
  private resolveLink(
    reference: string,
    context: Declaration | undefined,
    file: SourceFile,
  ): Target | undefined {
    if (/^[A-Za-z][\w+.-]*:|^\.{0,2}\/|^#/u.test(reference)) {
      return { kind: "url", url: reference };
    }
    // `module!name` starts at a module, `!name` at the top level.
    const bang = reference.indexOf("!");
    const source = bang === -1 ? undefined : reference.slice(0, bang);
    const path = reference.slice(bang + 1).replace(/\(.*\)$/u, "");
    const [first, ...rest] = path.split(/[.#~]/u) as [string, ...string[]];
    // `.` reaches static members first, `#` and `~` instance members.
    const separators = path.match(/[.#~]/gu) ?? [];
    const top =
      this.modules.length === 1
        ? (this.modules[0].children ?? [])
        : this.modules;
    // Where the first name is looked up, in order, as TypeDoc looks it up.
    const scopes: Declaration[][] = [];
    if (source === undefined) {
      // Comments of undocumented bases have no declaration to start from.
      if (context !== undefined) {
        for (
          let scope: Declaration | undefined = context;
          scope;
          scope = this.parents.get(scope)
        ) {
          if (scope.kind === "Module" || scope.kind === "Namespace") {
            scopes.push(scope.children ?? []);
          }
        }
        // Then the members of the class or interface, or of the declaration.
        const parent = this.parents.get(context);
        const isMember =
          parent !== undefined &&
          parent.kind !== "Module" &&
          parent.kind !== "Namespace";
        scopes.push((isMember ? parent : context).children ?? []);
      }
    } else if (source === "") {
      scopes.push(top);
    } else {
      const modules = [...top, ...this.modules].filter(
        (candidate) =>
          (candidate.kind === "Module" || candidate.kind === "Namespace") &&
          candidate.name === source,
      );
      if (first === "") {
        const module = modules.at(0);
        return module && { kind: "declaration", id: module.id };
      }
      scopes.push(...modules.map((module) => module.children ?? []));
    }
    // The names after the first, as far as they are left to look up.
    const names = [...rest];
    let found: Declaration | undefined;
    for (const children of scopes) {
      found ??= children.find((child) => child.name === first);
    }
    if (!found && source === undefined) {
      const symbol = this.program.getLocal(file, first);
      if (symbol.kind === "declaration") {
        found = this.declarations.get(symbol.nodes[0]);
      }
      if (!found && rest.length === 0) {
        const target = this.targetOf(symbol, false);
        if (target) return target;
      }
      // Members of namespace imports (`api.Parser#parse`), as types link
      // them, up to a documented declaration whose members are looked up.
      if (symbol.kind === "module" && rest.length > 0) {
        let member: Symbol | undefined = symbol;
        while (member && !found && names.length > 0) {
          member = this.program.getMember(member, names.shift()!);
          if (member?.kind === "declaration") {
            found = this.declarations.get(member.nodes[0]);
          }
        }
        const target =
          found === undefined && member !== undefined
            ? this.targetOf(member, false)
            : undefined;
        if (target) return target;
      }
      // Names not declared where the comment is are looked up anywhere.
      if (symbol.kind === "global") found ??= this.byName.get(first);
    }
    const skipped = rest.length - names.length;
    for (const [index, name] of names.entries()) {
      // Through references, and into object types.
      const scope =
        found?.kind === "Reference" && found.target !== undefined
          ? this.byId.get(found.target)
          : found;
      const children = scope && (scope.children ?? objectMembers(scope));
      const isStatic = separators[skipped + index] === ".";
      const candidates = children?.filter((child) => child.name === name) ?? [];
      found =
        candidates.find((child) => Boolean(child.flags.static) === isStatic) ??
        candidates[0];
    }
    if (found?.kind === "Reference" && found.target !== undefined) {
      return { kind: "declaration", id: found.target };
    }
    // Re-exports of dependencies link to their docs.
    if (found?.kind === "Reference" && found.type?.type === "reference") {
      return found.type.target;
    }
    return found && { kind: "declaration", id: found.id };
  }

  /**
   * Removes what a hiding tag marks, then what that leaves empty: functions
   * and methods without signatures, and accessors without get and set.
   *
   * @param declaration A declaration whose contents to hide.
   * @param kept Collects the IDs of the declarations kept.
   */
  private hide(declaration: Declaration, kept: Set<number>): void {
    kept.add(declaration.id);
    const isShown = (holder: { comment?: Comment }): boolean =>
      !isHidden(holder.comment);
    if (declaration.signatures) {
      declaration.signatures = declaration.signatures.filter(isShown);
    }
    if (declaration.indexSignatures) {
      declaration.indexSignatures = declaration.indexSignatures.filter(isShown);
    }
    if (isHidden(declaration.getSignature?.comment)) {
      delete declaration.getSignature;
    }
    if (isHidden(declaration.setSignature?.comment)) {
      delete declaration.setSignature;
    }
    for (const signature of [
      ...(declaration.signatures ?? []),
      ...(declaration.indexSignatures ?? []),
      declaration.getSignature,
      declaration.setSignature,
    ]) {
      // Parameters of constructors may be properties, which `@hidden` is for.
      if (signature) {
        this.hideSignature(signature, kept, declaration.kind === "Constructor");
      }
    }
    this.hideInTypes(
      [
        declaration.type,
        declaration.typeParameters,
        declaration.extends,
        declaration.implements,
      ],
      kept,
    );
    if (!declaration.children) return;
    const hidesConstructor =
      declaration.comment?.modifierTags.includes("@hideconstructor") === true;
    declaration.children = declaration.children.filter((child) => {
      if (
        isHidden(child.comment) ||
        (child.kind === "Constructor" &&
          (hidesConstructor ||
            child.signatures?.some(
              (signature) =>
                signature.comment?.modifierTags.includes("@hideconstructor") ===
                true,
            ) === true))
      ) {
        return false;
      }
      this.hide(child, kept);
      // Classes and interfaces keep their members without call signatures.
      const survives =
        child.kind === "Accessor"
          ? child.getSignature !== undefined || child.setSignature !== undefined
          : child.signatures?.length !== 0 ||
            child.kind === "Class" ||
            child.kind === "Interface";
      if (!survives) kept.delete(child.id);
      return survives;
    });
  }

  /**
   * @param signature A signature whose parameters and types to hide in.
   * @param kept Collects the IDs of the declarations kept.
   * @param shouldKeepParameters Whether to keep hidden parameters.
   */
  private hideSignature(
    signature: Signature,
    kept: Set<number>,
    shouldKeepParameters = false,
  ): void {
    if (!shouldKeepParameters) {
      signature.parameters = signature.parameters.filter(
        (parameter) => !this.hiddenParameters.has(parameter),
      );
    }
    this.hideInTypes(
      [signature.parameters, signature.typeParameters, signature.returns],
      kept,
    );
  }

  /**
   * Hides in the object and function types nested in types.
   *
   * @param value Types, or what holds them (parameters, lists).
   * @param kept Collects the IDs of the declarations kept.
   */
  private hideInTypes(value: unknown, kept: Set<number>): void {
    if (typeof value !== "object" || value === null) return;
    const type = value as Type;
    if (type.type === "object") {
      this.hide(type.declaration, kept);
    } else if (type.type === "function") {
      this.hideSignature(type.signature, kept);
    } else {
      for (const child of Object.values(value)) this.hideInTypes(child, kept);
    }
  }

  /**
   * Documents a variable tagged `@enum`, whose type is an object of strings
   * and numbers (`{ readonly a: "a" }`, `Readonly<{ a: 0 }>`, `{ a: number }`),
   * as an enum.
   *
   * @param declaration A declaration.
   */
  private applyTags(declaration: Declaration): void {
    if (
      declaration.kind !== "Variable" ||
      !declaration.comment?.modifierTags.includes("@enum")
    ) {
      return;
    }
    const members = objectMembers(declaration);
    if (
      members === undefined ||
      members.length === 0 ||
      !members.every(
        (member) =>
          (member.type?.type === "intrinsic" &&
            (member.type.name === "string" || member.type.name === "number")) ||
          // Literals other than booleans, `null` and bigints.
          (member.type?.type === "literal" &&
            !/^(?:true|false|null)$|n$/u.test(member.type.value)),
      )
    ) {
      return;
    }
    declaration.kind = "Enum";
    delete declaration.type;
    delete declaration.defaultValue;
    // Members keep their IDs, which links already point to.
    for (const member of members) {
      member.kind = "EnumMember";
      member.flags = {};
      if (member.type?.type === "literal") {
        member.defaultValue = member.type.value;
      }
      delete member.type;
      this.parents.set(member, declaration);
    }
    // Its own array: the object type's members are sorted later.
    declaration.children = [...members];
  }
}

/**
 * @param declaration A variable or property.
 * @returns The members of its object type, also as `Readonly<…>`, which
 *   `Object.freeze` returns.
 */
function objectMembers(declaration: Declaration): Declaration[] | undefined {
  let { type } = declaration;
  if (type?.type === "reference" && type.name === "Readonly") {
    [type] = type.typeArguments ?? [];
  }
  return type?.type === "object" ? type.declaration.children : undefined;
}

/**
 * @param group Members sharing a name.
 * @returns Whether they are a class's constructor.
 */
function isConstructorGroup(group: MemberGroup): boolean {
  const [node] = group.nodes;
  return node.type === "MethodDefinition" && node.kind === "constructor";
}

/**
 * Adds a base to the members a group overrides, after those it has: comments
 * are looked up in order.
 *
 * @param group Members.
 * @param base Members of a base type with their name.
 */
function appendBase(group: MemberGroup, base: MemberGroup): void {
  let last = group;
  while (last.overridden) last = last.overridden;
  last.overridden = base;
}

/**
 * @param groups Members of a class or another type.
 * @returns Those of its instances: neither static nor constructors.
 */
const instanceMembers = (groups: MemberGroup[]): MemberGroup[] =>
  groups.filter((group) => !group.isStatic && !isConstructorGroup(group));

/**
 * @param item A declaration or signature.
 * @returns Where its parameters are: properties of function types describe
 *   them on their types.
 */
function signatureOf(item: Declaration | Signature): Declaration | Signature {
  return "type" in item && item.type?.type === "function"
    ? item.type.signature
    : item;
}

/**
 * Documents what entry points export.
 *
 * @param options The entry points, and how to document them.
 * @returns The project.
 */
export function convert(options: ConvertOptions): Project {
  return new Converter(options).convert();
}
