/**
 * Declarations printed from the model match the declaration files they were
 * read from, up to formatting.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parseSync } from "oxc-parser";
import { describe, expect, inject, it } from "vitest";

import { convert } from "../src/convert.ts";
import type { Declaration } from "../src/model.ts";
import { declaredNames, type Node, Program } from "../src/program.ts";
import { plain, tokens, type TypePrinter } from "../src/render/types.ts";

const names = readdirSync(join(import.meta.dirname, "fixtures")).flatMap(
  (name) => /^(?<base>.+)\.tsx?$/u.exec(name)?.groups?.["base"] ?? [],
);

// Tags that change what is documented are left out: the declarations decide.
const directory = join(inject("fixtures"), "roundtrip");
mkdirSync(directory, { recursive: true });
for (const file of readdirSync(inject("fixtures"))) {
  if (!file.endsWith(".d.ts")) continue;
  writeFileSync(
    join(directory, file),
    readFileSync(join(inject("fixtures"), file), "utf8").replaceAll(
      /@(?=hidden|ignore|private|enum|abstract|readonly|protected|hideconstructor|param)/gu,
      "@_",
    ),
  );
}

const print = (write: (printer: TypePrinter) => unknown): string =>
  plain(
    tokens((printer) => {
      write(printer);
    }),
  );

/**
 * @param text Declarations as a declaration file writes them.
 * @returns The text, as the model keeps it.
 */
const normalize = (text: string): string =>
  text
    // Comments are not part of declarations.
    .replaceAll(/\/\*[\s\S]*?\*\/|\/\/.*/gu, "")
    .replace(/^declare /u, "")
    // The model tells `const` from `let` and `var` only.
    .replace(/^var /u, "let ")
    // Auto-accessors are documented as the properties they act as.
    .replace(/^(?<modifiers>(?:\w+ )*)accessor /u, "$<modifiers>")
    .replaceAll(/\s+/gu, " ")
    .replaceAll(/[;,] \}/gu, " }")
    .replaceAll(/(?<=[[(]) | (?=\])/gu, "")
    .replace(/;$/u, "")
    .trim()
    // Computed keys are named as TypeDoc names them: `[iterator]`, `a`.
    .replaceAll(/\[Symbol\.(?<name>\w+)\]/gu, "[$<name>]")
    .replace(
      /^(?<modifiers>(?:\w+ )*)\["(?<name>\w+)"\]/u,
      "$<modifiers>$<name>",
    )
    // Destructured parameters are named as TypeDoc names them.
    .replaceAll(/(?<=[(,] ?)\{[^{}]*\}(?=\??:)/gu, "__namedParameters")
    // Import types are shown by the names they import, linked.
    .replaceAll(/import\("[^"]*"\)\./gu, "")
    // The members of object types are sorted (each innermost one here).
    .replaceAll(
      /\{ [^{}]* \}/gu,
      (members) =>
        `{ ${members.slice(2, -2).split("; ").toSorted().join("; ")} }`,
    );

describe("round trip", () => {
  it.each(names)(
    "prints the declarations of %s as they are written",
    (file) => {
      const path = join(directory, `${file}.d.ts`);
      const text = readFileSync(path, "utf8");
      const project = convert({
        name: file,
        entryPoints: [{ name: file, file: path }],
        roots: [directory],
      });
      const printed: string[] = [];
      const written: string[] = [];
      const add = (
        write: (printer: TypePrinter) => unknown,
        node: Node,
        end = node.end,
        prefix = "",
      ): void => {
        printed.push(normalize(print(write)));
        written.push(normalize(prefix + text.slice(node.start, end)));
      };
      const aliases = new Map<string, string[]>();
      // How many signatures of each kind of each declaration were compared.
      const counts = new Map<string, number>();
      const take = <Item>(
        key: string,
        items: Item[] = [],
      ): Item | undefined => {
        const index = counts.get(key) ?? 0;
        counts.set(key, index + 1);
        return items[index];
      };

      /**
       * @param nodes Statements, or members of a class or interface.
       * @param children The model's declarations for them.
       * @param parent The class or interface, for its members.
       * @param areExported Whether all of them are exported, as in
       *   namespaces of declaration files.
       */
      const compare = (
        nodes: Node[],
        children: Declaration[],
        parent?: Declaration,
        areExported = false,
      ): void => {
        for (const statement of nodes) {
          const node =
            (statement.type === "ExportNamedDeclaration" ||
              statement.type === "ExportDefaultDeclaration") &&
            statement.declaration
              ? statement.declaration
              : statement;
          if (parent) {
            member(node, parent);
            continue;
          }
          const declared = declaredNames(node);
          // Anonymous default exports.
          if (declared.length === 0 && "id" in node && node.id === null) {
            declared.push(["default", node]);
          }
          for (const [name, inner] of declared) {
            // Default exports are documented as `default`, others under the
            // names they are exported as; all are printed by name.
            const exportedNames =
              statement.type === "ExportDefaultDeclaration"
                ? ["default"]
                : [name, ...(aliases.get(name) ?? [])];
            const declaration = children.find(
              (child) =>
                exportedNames.includes(child.name) &&
                child.kind !== "Reference",
            );
            if (declaration) top(inner, node, declaration, name);
            else if (statement !== node || areExported) written.push(name);
          }
        }
      };

      const top = (
        node: Node,
        statement: Node,
        declaration: Declaration,
        name: string,
      ): void => {
        switch (node.type) {
          case "VariableDeclarator": {
            add(
              (printer) => {
                printer.keyword(declaration.flags.const ? "const" : "let");
                printer.punctuation(" ").name(name);
                if (declaration.type) {
                  printer.punctuation(": ").type(declaration.type);
                }
                if (declaration.defaultValue !== undefined) {
                  printer.punctuation(` = ${declaration.defaultValue}`);
                }
              },
              node,
              node.end,
              statement.type === "VariableDeclaration"
                ? `${statement.kind} `
                : "",
            );
            break;
          }
          case "TSTypeAliasDeclaration": {
            add(
              (printer) =>
                printer
                  .keyword("type")
                  .punctuation(" ")
                  .name(name)
                  .typeParameters(declaration.typeParameters, true)
                  .punctuation(" = ")
                  .type(declaration.type!),
              node,
            );
            break;
          }
          case "TSDeclareFunction": {
            const value = take(`${declaration.id}`, declaration.signatures);
            if (value) {
              add((printer) => {
                printer.keyword("function").punctuation(" ");
                printer.signature(value, node.id ? name : "", true);
              }, node);
            } else written.push(name);
            break;
          }
          case "TSEnumDeclaration": {
            add(
              (printer) =>
                printer
                  .keyword(declaration.flags.const ? "const enum" : "enum")
                  .punctuation(" ")
                  .name(name),
              node,
              node.body.start,
            );
            for (const member of node.body.members) {
              const memberName = text
                .slice(member.id.start, member.id.end)
                .replaceAll('"', "");
              const child = declaration.children?.find(
                (candidate) => candidate.name === memberName,
              );
              if (!child) {
                written.push(memberName);
                continue;
              }
              add((printer) => {
                printer.property(child.name);
                if (child.defaultValue !== undefined) {
                  printer.punctuation(` = ${child.defaultValue}`);
                }
              }, member);
            }
            break;
          }
          case "TSModuleDeclaration": {
            if (node.body?.type === "TSModuleBlock") {
              // Namespaces of declaration files export all their declarations,
              // unless they export some explicitly, as `export {}` does.
              const { body } = node.body;
              compare(
                body,
                declaration.children ?? [],
                undefined,
                !body.some(
                  (inner) =>
                    inner.type === "ExportNamedDeclaration" &&
                    !inner.declaration,
                ),
              );
            }
            break;
          }
          case "ClassDeclaration":
          case "TSInterfaceDeclaration": {
            add(
              (printer) => {
                if (declaration.flags.abstract) {
                  printer.keyword("abstract").punctuation(" ");
                }
                printer.keyword(
                  node.type === "ClassDeclaration" ? "class" : "interface",
                );
                if (node.id) printer.punctuation(" ").name(name);
                printer.typeParameters(declaration.typeParameters, true);
              },
              node,
              node.typeParameters?.end ?? node.id?.end ?? node.body.start,
            );
            // Each clause, with the bases of its kind.
            const clauses =
              node.type === "TSInterfaceDeclaration"
                ? node.extends.map(
                    (clause) => [clause, declaration.extends] as const,
                  )
                : [
                    ...(node.superClass
                      ? [
                          [
                            {
                              expression: node.superClass,
                              typeArguments: node.superTypeArguments,
                            },
                            declaration.extends,
                          ] as const,
                        ]
                      : []),
                    ...(node.implements ?? []).map(
                      (clause) => [clause, declaration.implements] as const,
                    ),
                  ];
            for (const [clause, bases = []] of clauses) {
              const end = clause.typeArguments?.end ?? clause.expression.end;
              const original = normalize(
                text.slice(clause.expression.start, end),
              );
              // Merged declarations repeat bases.
              const base =
                bases.find(
                  (type) =>
                    normalize(print((printer) => printer.type(type))) ===
                    original,
                ) ??
                bases.find(
                  (type) =>
                    type.type === "reference" && original.startsWith(type.name),
                );
              if (base) {
                add((printer) => printer.type(base), clause.expression, end);
              } else written.push(original);
            }
            compare(node.body.body, [], declaration);
            break;
          }
          default:
        }
      };

      const member = (node: Node, parent: Declaration): void => {
        switch (node.type) {
          case "TSIndexSignature": {
            const value = take(`${parent.id} index`, parent.indexSignatures);
            if (value) add((printer) => printer.indexSignature(value), node);
            else written.push(node.type);
            return;
          }
          case "TSCallSignatureDeclaration":
          case "TSConstructSignatureDeclaration": {
            const isNew = node.type === "TSConstructSignatureDeclaration";
            const value = take(
              `${parent.id} ${node.type}`,
              parent.signatures?.filter(
                (candidate) => (candidate.name === "new") === isNew,
              ),
            );
            if (value) {
              add(
                (printer) =>
                  printer.signature(value, isNew ? "new " : "", true),
                node,
              );
            } else written.push(node.type);
            return;
          }
          default:
        }
        if (!("key" in node) || !("computed" in node)) return;
        const key = text.slice(node.key.start, node.key.end);
        const name = node.computed
          ? normalize(`[${key}]`)
          : key.replace(/^(?<quote>["'])(?<key>.*)\k<quote>$/u, "$<key>");
        const isStatic = "static" in node && node.static;
        const child = parent.children?.find(
          (candidate) =>
            candidate.name === name &&
            Boolean(candidate.flags.static) === isStatic &&
            candidate.inheritedFrom === undefined,
        );
        // Private members are not documented; all others are.
        if (!child) {
          const isPrivate =
            node.key.type === "PrivateIdentifier" ||
            ("accessibility" in node && node.accessibility === "private");
          if (!isPrivate) written.push(name);
          return;
        }
        const kind = "kind" in node ? node.kind : undefined;
        const value =
          kind === "get"
            ? child.getSignature
            : kind === "set"
              ? child.setSignature
              : take(`${child.id}`, child.signatures);
        add((printer) => {
          for (const flag of ["protected", "static", "abstract"] as const) {
            if (child.flags[flag]) printer.keyword(flag).punctuation(" ");
          }
          if (child.kind === "Property" && child.flags.readonly) {
            printer.keyword("readonly").punctuation(" ");
          }
          if (kind === "get" || kind === "set") {
            printer.keyword(kind).punctuation(" ");
          }
          if (child.kind === "Constructor") {
            printer.name("constructor").parameters(value!.parameters);
            return;
          }
          printer.property(child.name);
          if (child.flags.optional) printer.punctuation("?");
          if (value) printer.signature(value, "", true);
          else if (child.type) printer.punctuation(": ").type(child.type);
        }, node);
      };

      const children = project.modules[0].children ?? [];
      const { body } = parseSync(path, text).program;
      // Names local declarations are exported as: `export { a as b }`,
      // `export default a`.
      for (const statement of body) {
        if (
          statement.type === "ExportDefaultDeclaration" &&
          statement.declaration.type === "Identifier"
        ) {
          const { name } = statement.declaration;
          aliases.set(name, [...(aliases.get(name) ?? []), "default"]);
        }
        if (statement.type !== "ExportNamedDeclaration" || statement.source) {
          continue;
        }
        for (const { local, exported } of statement.specifiers) {
          const localName = local.type === "Literal" ? local.value : local.name;
          aliases.set(localName, [
            ...(aliases.get(localName) ?? []),
            exported.type === "Literal" ? exported.value : exported.name,
          ]);
        }
      }
      compare(body, children);
      // Every name the file exports, `export *` included, is documented:
      // hiding tags are disabled above.
      const program = new Program();
      for (const name of program.exportNames(program.getFile(path))) {
        if (!children.some((child) => child.name === name)) {
          written.push(name);
        }
      }
      expect(printed).toStrictEqual(written);
    },
  );
});
