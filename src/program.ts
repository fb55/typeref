/**
 * Declaration files and what their names refer to: parsing, module
 * resolution, imports and exports, and namespaces.
 *
 * @module
 */
import { existsSync, readFileSync } from "node:fs";
import { isBuiltin } from "node:module";

import { parseSync, type Node, type Program as Ast } from "oxc-parser";
import { ResolverFactory } from "oxc-resolver";

export type { Node } from "oxc-parser";

export interface SourceFile {
  /** The absolute path, with symbolic links resolved. */
  path: string;
  text: string;
  program: Ast;
  /** Doc comments (`/** … *\/`), in order. */
  docComments: { start: number; end: number; text: string }[];
}

/** What a name refers to. */
export type Symbol =
  /** One or more merged declarations (overloads, interface merging, …). */
  | {
      kind: "declaration";
      name: string;
      file: SourceFile;
      nodes: Node[];
      /** The namespaces the declarations are in, outermost first. */
      containers: Node[];
      /** Static and enum members: their class or enum. */
      owner?: Node;
    }
  /** A module, imported or re-exported as a namespace: `import * as x`. */
  | { kind: "module"; name: string; file: SourceFile }
  /** A global, such as `Map`, or a name that is not declared. */
  | { kind: "global"; name: string }
  /** An import from Node.js's modules, such as `node:stream`. */
  | { kind: "builtin"; name: string; module: string };

/** Imports, re-exports and their targets. */
interface Binding {
  source: string;
  /** The exported name, `*` for the module or `default`. */
  imported: string;
}

/** Declarations, imports and exports of a file or namespace. */
interface Scope {
  locals: Map<string, Node[]>;
  /** Names exported by declarations, and by `export { … }` without `from`. */
  exports: Map<string, string>;
  /** Imports, by local name. */
  imports: Map<string, Binding>;
  /** `export … from`, by exported name. */
  reexports: Map<string, Binding>;
  /** `export * from`. */
  stars: string[];
  /** `export { … }` and `export * as` statements, by the names they export. */
  statements: Map<string, Node>;
}

/**
 * @param node A declaration statement, possibly wrapped in `export`.
 * @returns The declaration.
 */
function unwrap(node: Node): Node {
  return (node.type === "ExportNamedDeclaration" ||
    node.type === "ExportDefaultDeclaration") &&
    node.declaration
    ? node.declaration
    : node;
}

/** Declarators of `const` statements, which know their kind only there. */
const constDeclarators = new WeakSet<Node>();

/**
 * @param node A variable's declarator.
 * @returns Whether the variable is declared `const`.
 */
export const isConst = (node: Node): boolean => constDeclarators.has(node);

/**
 * @param node A declaration.
 * @returns The names it declares, and the nodes declaring each.
 */
export function declaredNames(node: Node): [string, Node][] {
  switch (node.type) {
    case "VariableDeclaration": {
      if (node.kind === "const") {
        for (const declarator of node.declarations) {
          constDeclarators.add(declarator);
        }
      }
      return node.declarations.flatMap((declarator): [string, Node][] =>
        declarator.id.type === "Identifier"
          ? [[declarator.id.name, declarator]]
          : [],
      );
    }
    case "TSDeclareFunction":
    case "FunctionDeclaration":
    case "ClassDeclaration":
    case "TSInterfaceDeclaration":
    case "TSTypeAliasDeclaration":
    case "TSEnumDeclaration": {
      return node.id ? [[node.id.name, node]] : [];
    }
    case "TSModuleDeclaration": {
      return node.id.type === "Identifier" ? [[node.id.name, node]] : [];
    }
    default: {
      return [];
    }
  }
}

/**
 * @param node An identifier, or a string as `export { "a b" as c }` writes it.
 * @returns The name.
 */
export function nameOf(node: Node): string {
  if (node.type === "Identifier") return node.name;
  return node.type === "Literal" ? String(node.value) : "";
}

/**
 * @param specifier A module of Node.js, such as `node:fs/promises`.
 * @returns Its page in Node.js's docs: `fs`, as Node.js documents
 *   submodules with their parents, except Web Streams.
 */
export function builtinPage(specifier: string): string {
  const module = specifier.replace(/^node:/u, "");
  return module === "stream/web" || module === "stream/consumers"
    ? "webstreams"
    : module.split("/")[0];
}

export class Program {
  private readonly files = new Map<string, SourceFile>();
  private readonly scopes = new Map<Node | SourceFile, Scope>();
  private readonly resolver = new ResolverFactory({
    conditionNames: ["types", "import", "require", "default"],
  });

  /**
   * Resolves a module specifier, as TypeScript resolves it for types.
   *
   * @param file The importing file, or a package's `package.json`.
   * @param specifier The specifier.
   * @returns The declaration file's path, or `undefined` if there is none.
   */
  resolve(file: string, specifier: string): string | undefined {
    const { path } = this.resolver.resolveDtsSync(file, specifier);
    // Without `types` in `exports`, the declarations are next to the script.
    const declarations = path?.replace(/\.(?<type>[mc]?)js$/u, ".d.$<type>ts");
    return declarations !== undefined &&
      declarations !== path &&
      existsSync(declarations)
      ? declarations
      : path;
  }

  /**
   * @returns The absolute paths of the declaration files read.
   */
  paths(): string[] {
    return [...this.files.keys()];
  }

  /**
   * @param path The absolute path of a declaration file.
   * @returns The file, parsed.
   */
  getFile(path: string): SourceFile {
    let file = this.files.get(path);
    if (!file) {
      const text = readFileSync(path, "utf8");
      const result = parseSync(path, text, { preserveParens: false });
      file = {
        path,
        text,
        program: result.program,
        docComments: result.comments.flatMap((comment) =>
          comment.type === "Block" && comment.value.startsWith("*")
            ? [
                {
                  start: comment.start,
                  end: comment.end,
                  text: `/*${comment.value}*/`,
                },
              ]
            : [],
        ),
      };
      this.files.set(path, file);
    }
    return file;
  }

  /**
   * @param file The file a specifier is written in.
   * @param specifier The specifier.
   * @returns The file it resolves to.
   */
  importedFile(file: SourceFile, specifier: string): SourceFile | undefined {
    const path = this.resolve(file.path, specifier);
    return path === undefined ? undefined : this.getFile(path);
  }

  /**
   * Collects a file's or namespace's declarations, imports and exports.
   *
   * @param file The file.
   * @param container A namespace declaration, or `undefined` for the file.
   * @returns The scope.
   */
  private scopeOf(file: SourceFile, container: Node | undefined): Scope {
    const key = container ?? file;
    let scope = this.scopes.get(key);
    if (scope) return scope;
    scope = {
      locals: new Map(),
      exports: new Map(),
      imports: new Map(),
      reexports: new Map(),
      stars: [],
      statements: new Map(),
    };
    this.scopes.set(key, scope);
    const body: Node[] =
      container?.type === "TSModuleDeclaration"
        ? container.body?.type === "TSModuleBlock"
          ? container.body.body
          : []
        : file.program.body;
    /*
     * In declaration files and namespaces, declarations are exported unless
     * the file exports names explicitly (as `export {}` and `export default x`
     * do).
     */
    const isAmbient =
      (container !== undefined || /\.d\.[mc]?ts$/u.test(file.path)) &&
      !body.some(
        (statement) =>
          (statement.type === "ExportNamedDeclaration" &&
            !statement.declaration) ||
          statement.type === "TSExportAssignment" ||
          statement.type === "ExportAllDeclaration" ||
          (statement.type === "ExportDefaultDeclaration" &&
            statement.declaration.type === "Identifier"),
      );
    for (const statement of body) {
      const isExported =
        isAmbient || statement.type === "ExportNamedDeclaration";
      for (const [name, node] of declaredNames(unwrap(statement))) {
        const nodes = scope.locals.get(name);
        if (nodes) nodes.push(node);
        else scope.locals.set(name, [node]);
        if (isExported && statement.type !== "ExportDefaultDeclaration") {
          scope.exports.set(name, name);
        }
      }
      switch (statement.type) {
        case "ImportDeclaration": {
          for (const specifier of statement.specifiers) {
            scope.imports.set(specifier.local.name, {
              source: statement.source.value,
              imported:
                specifier.type === "ImportNamespaceSpecifier"
                  ? "*"
                  : specifier.type === "ImportDefaultSpecifier"
                    ? "default"
                    : nameOf(specifier.imported),
            });
          }
          break;
        }
        case "ExportNamedDeclaration": {
          for (const specifier of statement.specifiers) {
            const exported = nameOf(specifier.exported);
            const local = nameOf(specifier.local);
            scope.statements.set(exported, statement);
            if (statement.source) {
              scope.reexports.set(exported, {
                source: statement.source.value,
                imported: local,
              });
            } else {
              scope.exports.set(exported, local);
            }
          }
          break;
        }
        case "ExportAllDeclaration": {
          if (statement.exported) {
            scope.reexports.set(nameOf(statement.exported), {
              source: statement.source.value,
              imported: "*",
            });
            scope.statements.set(nameOf(statement.exported), statement);
          } else {
            scope.stars.push(statement.source.value);
          }
          break;
        }
        case "ExportDefaultDeclaration": {
          const { declaration } = statement;
          const [name] = declaredNames(declaration)[0] ?? [];
          if (name !== undefined) {
            scope.exports.set("default", name);
          } else if (
            declaration.type === "ClassDeclaration" ||
            declaration.type === "FunctionDeclaration" ||
            declaration.type === "TSDeclareFunction"
          ) {
            // Anonymous: `export default class {}`, a statement per overload.
            scope.locals.set("default", [
              ...(scope.locals.get("default") ?? []),
              declaration,
            ]);
            scope.exports.set("default", "default");
          } else if (declaration.type === "Identifier") {
            scope.exports.set("default", declaration.name);
          }
          break;
        }
        default:
      }
    }
    return scope;
  }

  /**
   * @param file The file.
   * @param containers The namespaces to list the exports of the innermost
   *   of, outermost first; none for the file.
   * @returns The names the file or namespace exports, in order.
   */
  exportNames(file: SourceFile, containers: Node[] = []): string[] {
    return this.collectExportNames(file, containers, new Set());
  }

  private collectExportNames(
    file: SourceFile,
    containers: Node[],
    seen: Set<SourceFile>,
  ): string[] {
    if (containers.length === 0) {
      if (seen.has(file)) return [];
      seen.add(file);
    }
    const scope = this.scopeOf(file, containers.at(-1));
    const names = new Set([...scope.exports.keys(), ...scope.reexports.keys()]);
    for (const source of scope.stars) {
      const target = this.importedFile(file, source);
      if (!target) continue;
      for (const name of this.collectExportNames(target, [], seen)) {
        if (name !== "default") names.add(name);
      }
    }
    return [...names];
  }

  /**
   * @param file The file.
   * @param name An exported name.
   * @param containers The namespaces to look in the innermost of, outermost
   *   first; none for the file.
   * @returns The `export { … }` or `export * as` statement exporting the
   *   name, if one does.
   */
  exportStatement(
    file: SourceFile,
    name: string,
    containers: Node[] = [],
  ): Node | undefined {
    return this.scopeOf(file, containers.at(-1)).statements.get(name);
  }

  /**
   * Finds what a file or namespace exports under a name.
   *
   * @param file The file.
   * @param name The exported name.
   * @param containers The namespaces to look in the innermost of, outermost
   *   first; none for the file.
   * @returns The symbol, or `undefined` if nothing is exported under the name.
   */
  getExport(
    file: SourceFile,
    name: string,
    containers: Node[] = [],
  ): Symbol | undefined {
    return this.findExport(file, name, containers, new Set());
  }

  private findExport(
    file: SourceFile,
    name: string,
    containers: Node[],
    seen: Set<SourceFile>,
  ): Symbol | undefined {
    if (containers.length === 0) {
      if (seen.has(file)) return undefined;
      seen.add(file);
    }
    const scope = this.scopeOf(file, containers.at(-1));
    const local = scope.exports.get(name);
    if (local !== undefined) return this.getLocal(file, local, containers);
    const reexport = scope.reexports.get(name);
    if (reexport) return this.follow(file, reexport, name);
    if (name === "default") return undefined;
    for (const source of scope.stars) {
      const target = this.importedFile(file, source);
      const symbol = target && this.findExport(target, name, [], seen);
      if (symbol) return symbol;
    }
    return undefined;
  }

  /**
   * @param file The file a binding is in.
   * @param binding An import or re-export.
   * @param name The name the binding has in the file.
   * @returns What the binding refers to.
   */
  private follow(
    file: SourceFile,
    binding: Binding,
    name: string,
  ): Symbol | undefined {
    const target = this.importedFile(file, binding.source);
    const symbol =
      target &&
      (binding.imported === "*"
        ? { kind: "module" as const, name, file: target }
        : this.getExport(target, binding.imported));
    if (symbol) return symbol;
    // Node.js's modules, imported or re-exported, have no files.
    return isBuiltin(binding.source)
      ? {
          kind: "builtin",
          name: binding.imported === "*" ? name : binding.imported,
          module: builtinPage(binding.source),
        }
      : undefined;
  }

  /**
   * Finds what a name refers to where it is written: in the namespaces it is
   * in, innermost first, then in the file, then among globals.
   *
   * @param file The file.
   * @param name The name.
   * @param containers The namespaces the name is written in, outermost first.
   * @param isValue Whether the name is a value's, as in `typeof name`, which
   *   interfaces and type aliases are not.
   * @returns The symbol.
   */
  getLocal(
    file: SourceFile,
    name: string,
    containers: Node[] = [],
    isValue = false,
  ): Symbol {
    for (let depth = containers.length; depth >= 0; depth--) {
      const chain = containers.slice(0, depth);
      const scope = this.scopeOf(file, chain.at(-1));
      const nodes = scope.locals.get(name);
      if (
        nodes?.some(
          (node) =>
            !isValue ||
            (node.type !== "TSInterfaceDeclaration" &&
              node.type !== "TSTypeAliasDeclaration"),
        )
      ) {
        return { kind: "declaration", name, file, nodes, containers: chain };
      }
      const binding = scope.imports.get(name);
      if (binding) {
        return this.follow(file, binding, name) ?? { kind: "global", name };
      }
    }
    return { kind: "global", name };
  }

  /**
   * Finds a member of a module or namespace, as `A.B` refers to it.
   *
   * @param symbol The module or namespace.
   * @param name The member's name.
   * @returns The member, or `undefined` if there is none.
   */
  getMember(symbol: Symbol, name: string): Symbol | undefined {
    if (symbol.kind === "module") return this.getExport(symbol.file, name);
    // `stream.Transform`, of `import * as stream from "node:stream"`.
    if (symbol.kind === "builtin") return { ...symbol, name };
    if (symbol.kind !== "declaration") return undefined;
    for (const node of symbol.nodes) {
      if (node.type === "TSModuleDeclaration") {
        const member = this.getExport(symbol.file, name, [
          ...symbol.containers,
          node,
        ]);
        if (member) return member;
      } else if (node.type === "TSEnumDeclaration") {
        // Members, as `TokenType.Text` refers to them.
        const member = node.body.members.find(
          (candidate) => nameOf(candidate.id) === name,
        );
        if (member) {
          return {
            kind: "declaration",
            name,
            file: symbol.file,
            nodes: [member],
            containers: symbol.containers,
            owner: node,
          };
        }
      } else if (node.type === "ClassDeclaration") {
        // Static members, as `typeof Parser.parse` refers to them.
        const nodes = node.body.body.filter(
          (member) =>
            "key" in member &&
            member.static &&
            member.key.type === "Identifier" &&
            member.key.name === name,
        );
        if (nodes.length > 0) {
          return {
            kind: "declaration",
            name,
            file: symbol.file,
            nodes,
            containers: symbol.containers,
            owner: node,
          };
        }
      }
    }
    return undefined;
  }
}
