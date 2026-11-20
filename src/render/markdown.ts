/**
 * Markdown pages, for static site generators: one file per page, laid out as
 * TypeDoc's Markdown plugin lays them out.
 *
 * @module
 */
import type {
  Code,
  Heading,
  InlineCode,
  List,
  Paragraph,
  PhrasingContent,
  RootContent,
  Table,
  Text,
} from "mdast";
import { gfmToMarkdown } from "mdast-util-gfm";
import { toMarkdown, type Options } from "mdast-util-to-markdown";

import type {
  Declaration,
  Module,
  Part,
  Project,
  Signature,
  Source,
  Target,
  Type,
} from "../model.ts";
import { Router, topLevel, type Page } from "./router.ts";
import {
  blockTags,
  commentOf,
  inlineMarkdown,
  isDeprecated,
  kindNames,
  markdownTree,
  returnsOf,
  sections,
  type Section,
  signaturesOf,
  summaryOf,
} from "./shared.ts";
import { plain, tokens, type Token, type TypePrinter } from "./types.ts";

export interface MarkdownOptions {
  /** The path the pages are served under; links are relative without it. */
  basePath?: string;
  /**
   * Where pages are served, by their paths (`classes/Cheerio.md`), for
   * sites that serve them elsewhere; overrides `basePath`.
   */
  urlOf?: (path: string) => string;
  /**
   * Classes, interfaces and enums with at least this many members get a page
   * for each category of their members.
   */
  categoryPages?: number;
}

/** Keywords shown in italics in text, as operators. */
const operators = new Set([
  "extends",
  "keyof",
  "typeof",
  "infer",
  "is",
  "asserts",
  "readonly",
  "unique",
  "in",
  "as",
  "new",
  "abstract new",
]);

const syntax: Options = {
  bullet: "-",
  resourceLink: true,
  extensions: [gfmToMarkdown({ tablePipeAlign: false })],
};

const text = (value: string): Text => ({ type: "text", value });

const heading = (level: number, title: string): Heading => ({
  type: "heading",
  depth: level as Heading["depth"],
  children: [text(title)],
});

const inlineCode = (value: string): InlineCode => ({
  type: "inlineCode",
  value,
});

/**
 * @param url Where the label links to, if anywhere.
 * @param label The label.
 * @returns The label, linked to the URL.
 */
const linked = (
  url: string | undefined,
  label: PhrasingContent,
): PhrasingContent =>
  url === undefined ? label : { type: "link", url, children: [label] };

const paragraph = (children: PhrasingContent[]): Paragraph => ({
  type: "paragraph",
  children,
});

/**
 * @param titles The titles of the columns.
 * @param rows The rows' cells.
 * @returns A table.
 */
const table = (titles: string[], rows: PhrasingContent[][][]): Table => ({
  type: "table",
  children: [titles.map((title) => [text(title)]), ...rows].map((cells) => ({
    type: "tableRow",
    children: cells.map((children) => ({ type: "tableCell", children })),
  })),
});

/**
 * @param items The items' text.
 * @returns A bulleted list.
 */
const bullets = (items: PhrasingContent[][]): List => ({
  type: "list",
  spread: false,
  children: items.map((item) => ({
    type: "listItem",
    spread: false,
    children: [paragraph(item)],
  })),
});

/**
 * @param signatures A method's signatures.
 * @returns Their type: a function type, or the intersection of overloads'.
 */
function signaturesType(signatures: Signature[]): Type {
  const types = signatures.map((signature): Type => ({
    type: "function",
    signature,
  }));
  return types.length === 1 ? types[0] : { type: "intersection", types };
}

/**
 * @param code Code.
 * @returns A TypeScript code block.
 */
const codeBlock = (code: string): Code => ({
  type: "code",
  lang: "ts",
  value: code,
});

/**
 * @param print Prints code.
 * @returns The code as a TypeScript code block, without parameter types.
 */
function printedCode(print: (printer: TypePrinter) => void): Code {
  return codeBlock(plain(tokens(print, { shouldHideParameterTypes: true })));
}

/**
 * @param sources A declaration's sources.
 * @returns Where the first one is, linked to its repository if possible.
 */
function definedIn(sources: Source[] | undefined): RootContent[] {
  if (sources === undefined || sources.length === 0) return [];
  const [source] = sources;
  return [
    paragraph([
      text("Defined in: "),
      linked(source.url, text(`${source.file}:${source.line}`)),
    ]),
  ];
}

/**
 * @param declaration A declaration.
 * @returns The heading of its page.
 */
function pageTitle(declaration: Declaration): Heading {
  let { name } = declaration;
  if (
    declaration.typeParameters !== undefined &&
    declaration.typeParameters.length > 0
  ) {
    name += `<${declaration.typeParameters.map((parameter) => parameter.name).join(", ")}>`;
  }
  if (
    declaration.kind === "Function" ||
    (declaration.signatures !== undefined && declaration.signatures.length > 0)
  ) {
    name += "()";
  }
  const abstract = declaration.flags.abstract ? "Abstract " : "";
  return heading(1, `${abstract}${kindNames[declaration.kind]}: ${name}`);
}

class MarkdownWriter {
  private readonly router: Router;
  private readonly basePath: string | undefined;
  private readonly urlOf: ((path: string) => string) | undefined;
  private page = "";
  /** The members documented on the current page. */
  private readonly rendered = new Set<Declaration>();

  constructor(project: Project, options: MarkdownOptions) {
    this.router = new Router(project, ".md", options);
    // Pages' paths follow the base path's slash, given or not.
    this.basePath = options.basePath?.replace(/\/?$/u, "/");
    this.urlOf = options.urlOf;
  }

  render(project: Project): MarkdownPage[] {
    const files: MarkdownPage[] = [];
    for (const page of this.router.pages) {
      this.page = page.url;
      this.rendered.clear();
      const markdown =
        page.kind === "readme"
          ? (project.readme ?? "")
          : toMarkdown(
              {
                type: "root",
                children:
                  page.kind === "index"
                    ? this.index(project)
                    : page.kind === "category"
                      ? this.categoryPage(page.declaration!, page.section!)
                      : this.declarationPage(page.declaration!),
              },
              syntax,
            );
      // READMEs are written as they are; leading spaces start code there.
      files.push({
        page,
        markdown: page.kind === "readme" ? markdown : `${markdown.trim()}\n`,
      });
    }
    return files;
  }

  private url(to: string): string {
    if (this.urlOf) {
      const hash = to.indexOf("#");
      return hash === -1
        ? this.urlOf(to)
        : `${this.urlOf(to.slice(0, hash))}${to.slice(hash)}`;
    }
    return this.basePath === undefined
      ? Router.relative(this.page, to)
      : `${this.basePath}${to}`;
  }

  private link(target: Target): string | undefined {
    if (target.kind === "url") return target.url;
    const declaration = this.router.get(target.id);
    const url = declaration && this.router.url(declaration);
    if (url === undefined) return undefined;
    // Rows of tables have no anchors: links go to their pages.
    return this.url(
      this.router.isObjectMember(declaration!) ? url.split("#")[0] : url,
    );
  }

  private text(parts: Part[] | undefined): RootContent[] {
    return markdownTree(parts ?? [], (target) => this.link(target)).children;
  }

  /**
   * @param parts Comment text.
   * @returns The text for a table cell; `-` if there is none.
   */
  private cell(parts: Part[] | undefined): PhrasingContent[] {
    const content = inlineMarkdown(parts ?? [], (target) => this.link(target));
    return content.length === 0 ? [text("-")] : content;
  }

  /**
   * @param list Tokens of a type.
   * @returns The type as inline Markdown, each name as code.
   */
  private inline(list: Token[]): PhrasingContent[] {
    return list.map((token): PhrasingContent => {
      if (token.kind === "punctuation") return text(token.text);
      if (token.kind === "keyword" && operators.has(token.text)) {
        return { type: "emphasis", children: [text(token.text)] };
      }
      return linked(
        token.target && this.link(token.target),
        inlineCode(token.text),
      );
    });
  }

  private type(type: Type): PhrasingContent[] {
    return this.inline(
      tokens(
        (printer) => {
          printer.type(type);
        },
        { shouldHideParameterTypes: true },
      ),
    );
  }

  private index(project: Project): RootContent[] {
    const out: RootContent[] = [heading(1, project.name)];
    // With one entry point, the index is the module's page.
    if (project.modules.length === 1) {
      out.push(...this.comment(project.modules[0], 2));
    }
    for (const section of sections(
      topLevel(project),
      project.modules.length === 1 ? project.modules[0].comment : undefined,
    )) {
      out.push(...this.sectionHeading(section), this.table(section.members));
    }
    return out;
  }

  /**
   * @param section A section of members.
   * @param url The page it has, if any.
   * @returns Its heading, linked to its page, and description.
   */
  private sectionHeading(section: Section, url?: string): RootContent[] {
    const title = heading(2, section.title);
    if (url !== undefined) {
      title.children = [linked(this.url(url), text(section.title))];
    }
    return [title, ...this.text(section.description)];
  }

  /**
   * @param declaration A class, interface or enum.
   * @param section A category of its members.
   * @returns The page of the category.
   */
  private categoryPage(
    declaration: Declaration,
    section: Section,
  ): RootContent[] {
    const out: RootContent[] = [
      heading(1, `${declaration.name}: ${section.title}`),
      paragraph([
        text("Members of "),
        linked(
          this.url(this.router.url(declaration)!),
          inlineCode(declaration.name),
        ),
        text("."),
      ]),
      ...this.text(section.description),
    ];
    for (const [index, member] of section.members.entries()) {
      if (index > 0) out.push({ type: "thematicBreak" });
      out.push(...this.member(member, 2));
    }
    return out;
  }

  private table(members: Declaration[]): Table {
    const kinds = new Set(members.map((member) => member.kind));
    const title = kinds.size === 1 ? kindNames[members[0].kind] : "Name";
    const rows = members.map((member) => {
      // Re-exports of dependencies link to the dependency's docs.
      const external =
        member.kind === "Reference" && member.type?.type === "reference"
          ? member.type.target
          : undefined;
      const url = external
        ? this.link(external)
        : this.router.url(member) === undefined
          ? undefined
          : this.url(this.router.url(member)!);
      const label = linked(url, text(member.name));
      // Links to the member from before its declaration's page was split.
      const anchor = this.router.indexAnchor(member);
      const isFirst = !this.rendered.has(member);
      this.rendered.add(member);
      const name: PhrasingContent[] =
        anchor !== undefined && isFirst
          ? [{ type: "html", value: `<a id="${anchor}"></a>` }, label]
          : [label];
      return [
        name,
        external ? [text("Re-exports "), label] : this.cell(summaryOf(member)),
      ];
    });
    return table([title, "Description"], rows);
  }

  private declarationPage(declaration: Declaration): RootContent[] {
    const out: RootContent[] = [pageTitle(declaration)];
    switch (declaration.kind) {
      case "Function": {
        out.push(...this.signatures(declaration, 2, "function "));
        break;
      }
      case "Variable":
      case "TypeAlias": {
        out.push(
          printedCode((printer) => {
            printer
              .keyword(
                declaration.kind === "Variable"
                  ? declaration.flags.const
                    ? "const"
                    : "let"
                  : "type",
              )
              .punctuation(" ")
              .name(declaration.name);
            if (declaration.kind === "TypeAlias") {
              printer
                .typeParameters(declaration.typeParameters)
                .punctuation(" = ");
            } else {
              printer.punctuation(": ");
            }
            if (declaration.type) printer.type(declaration.type);
            printer.punctuation(";");
          }),
          ...definedIn(declaration.sources),
          // The signature's details show the tags of function types.
          ...(declaration.type?.type === "function"
            ? this.text(declaration.comment?.summary)
            : this.comment(declaration, 2)),
          ...this.typeParameterTable(declaration, 2),
        );
        if (declaration.type?.type === "function") {
          out.push(
            ...this.signatureDetails(
              declaration.type.signature,
              2,
              declaration,
            ),
          );
        }
        if (declaration.type?.type === "object") {
          const object = declaration.type.declaration;
          const { children } = object;
          out.push(...this.indexable(object));
          if (object.signatures) out.push(...this.signatures(object, 2, ""));
          if (children && children.length > 0) {
            out.push(
              heading(2, "Type Declaration"),
              this.memberTable(children),
            );
          }
        }
        break;
      }
      case "Module":
      case "Namespace": {
        out.push(...this.comment(declaration, 2));
        for (const section of sections(
          declaration.children ?? [],
          declaration.comment,
        )) {
          out.push(
            ...this.sectionHeading(section),
            this.table(section.members),
          );
        }
        // Packages' READMEs, as they are written.
        const { readme } = declaration as Module;
        if (readme !== undefined) out.push({ type: "html", value: readme });
        break;
      }
      default: {
        out.push(
          ...definedIn(declaration.sources),
          ...this.comment(declaration, 2),
        );
        if (declaration.extends) {
          out.push(
            heading(2, "Extends"),
            bullets(declaration.extends.map((type) => this.type(type))),
          );
        }
        out.push(...this.typeParameterTable(declaration, 2));
        if (declaration.implements) {
          out.push(
            heading(2, "Implements"),
            bullets(declaration.implements.map((type) => this.type(type))),
          );
        }
        out.push(...this.indexable(declaration));
        if (declaration.signatures) {
          out.push(...this.signatures(declaration, 2, ""));
        }
        const categories = this.router.categoryPages(declaration);
        if (categories) {
          // The members are on the categories' pages; this is their index.
          for (const { url, section } of categories) {
            out.push(
              ...this.sectionHeading(section!, url),
              this.table(section!.members),
            );
          }
          break;
        }
        for (const section of sections(
          declaration.children ?? [],
          declaration.comment,
        )) {
          out.push(...this.sectionHeading(section));
          for (const [index, member] of section.members.entries()) {
            if (index > 0) out.push({ type: "thematicBreak" });
            out.push(...this.member(member, 3));
          }
        }
      }
    }
    return out;
  }

  private indexable(declaration: Declaration): RootContent[] {
    const out: RootContent[] = [];
    for (const signature of declaration.indexSignatures ?? []) {
      const code = plain(
        tokens((printer) => {
          printer.indexSignature(signature);
        }),
      );
      out.push(
        heading(2, "Indexable"),
        codeBlock(code),
        ...this.text(signature.comment?.summary),
        ...this.text(returnsOf(signature.comment)),
        ...this.tags(blockTags(signature.comment), 3),
      );
    }
    return out;
  }

  private comment(declaration: Declaration, level: number): RootContent[] {
    const { comment } = declaration;
    if (!comment) return [];
    return [
      ...this.text(comment.summary),
      ...this.tags(blockTags(comment), level),
    ];
  }

  private tags(
    tags: { title: string; content: Part[] }[],
    level: number,
  ): RootContent[] {
    return tags.flatMap(({ title, content }) => [
      heading(level, title),
      ...this.text(content),
    ]);
  }

  private typeParameterTable(
    owner: { typeParameters?: Declaration["typeParameters"] },
    level: number,
  ): RootContent[] {
    const parameters = owner.typeParameters;
    if (parameters === undefined || parameters.length === 0) return [];
    const hasDescriptions = parameters.some((parameter) => parameter.comment);
    const rows = parameters.map((parameter) => {
      const cell: PhrasingContent[] = [inlineCode(parameter.name)];
      if (parameter.constraint) {
        cell.push(
          text(" "),
          { type: "emphasis", children: [text("extends")] },
          text(" "),
          ...this.type(parameter.constraint),
        );
      }
      if (parameter.default) {
        cell.push(text(" = "), ...this.type(parameter.default));
      }
      return hasDescriptions ? [cell, this.cell(parameter.comment)] : [cell];
    });
    return [
      heading(level, "Type Parameters"),
      table(
        hasDescriptions
          ? ["Type Parameter", "Description"]
          : ["Type Parameter"],
        rows,
      ),
    ];
  }

  private memberTable(members: Declaration[]): Table {
    const rows = members.map((member) => {
      // Accessors show the type they read, or else the type they write.
      const type =
        member.type ??
        (member.signatures && signaturesType(member.signatures)) ??
        member.getSignature?.returns ??
        member.setSignature?.parameters[0]?.type;
      return [
        [inlineCode(`${member.name}${member.flags.optional ? "?" : ""}`)],
        type ? this.type(type) : [text("-")],
        this.cell(commentOf(member)?.summary),
      ];
    });
    return table(["Name", "Type", "Description"], rows);
  }

  private signatures(
    declaration: Declaration,
    level: number,
    prefix: string,
  ): RootContent[] {
    const signatures = signaturesOf(declaration);
    if (signatures.length === 1) {
      return this.signature(signatures[0], level, prefix, declaration);
    }
    const out: RootContent[] = [];
    for (const signature of signatures) {
      out.push(
        heading(level, "Call Signature"),
        ...this.signature(signature, level + 1, prefix, declaration),
      );
    }
    return out;
  }

  private signature(
    signature: Signature,
    level: number,
    prefix: string,
    declaration: Declaration,
  ): RootContent[] {
    // Construct signatures are named `new`, methods may be too.
    const name =
      signature.name === "new" && declaration.kind !== "Method"
        ? "new "
        : signature.name;
    const code = printedCode((printer) => {
      if (prefix) printer.keyword(prefix.trim()).punctuation(" ");
      printer.modifiers(declaration.flags);
      if (declaration.kind === "Method") {
        printer.property(name);
        if (declaration.flags.optional) printer.punctuation("?");
        printer.signature(signature, "");
      } else {
        printer.signature(signature, name);
      }
      printer.punctuation(";");
    });
    return [
      code,
      ...definedIn(signature.sources),
      ...this.text(signature.comment?.summary),
      ...this.signatureDetails(signature, level, declaration),
    ];
  }

  private signatureDetails(
    signature: Signature,
    level: number,
    declaration: Declaration,
  ): RootContent[] {
    const out = this.typeParameterTable(signature, level);
    if (signature.parameters.length > 0) {
      const hasDescriptions = signature.parameters.some(
        (parameter) => parameter.comment,
      );
      const rows = signature.parameters.map((parameter) => {
        const name = [
          inlineCode(
            `${parameter.rest ? "..." : ""}${parameter.name}${parameter.optional ? "?" : ""}`,
          ),
        ];
        const type = parameter.type ? this.type(parameter.type) : [text("-")];
        return hasDescriptions
          ? [name, type, this.cell(parameter.comment)]
          : [name, type];
      });
      out.push(
        heading(level, "Parameters"),
        table(
          hasDescriptions
            ? ["Parameter", "Type", "Description"]
            : ["Parameter", "Type"],
          rows,
        ),
      );
    }
    // Variables and properties of function types describe the function.
    const comment =
      signature.comment ??
      (declaration.type?.type === "function" ? declaration.comment : undefined);
    if (signature.returns) {
      out.push(
        heading(level, "Returns"),
        paragraph(this.type(signature.returns)),
        ...this.text(returnsOf(comment)),
      );
    }
    out.push(
      ...this.tags(blockTags(comment), level),
      ...this.relations(declaration, level),
    );
    return out;
  }

  private relations(declaration: Declaration, level: number): RootContent[] {
    if (declaration.inheritedFrom) {
      return [
        heading(level, "Inherited from"),
        paragraph(this.type(declaration.inheritedFrom)),
      ];
    }
    if (declaration.overwrites) {
      return [
        heading(level, "Overrides"),
        paragraph(this.type(declaration.overwrites)),
      ];
    }
    return [];
  }

  private member(member: Declaration, level: number): RootContent[] {
    // Members in several categories are documented in the first.
    const url = this.router.url(member);
    if (
      this.rendered.has(member) ||
      (url !== undefined && url.split("#")[0] !== this.page)
    ) {
      return url === undefined
        ? []
        : [
            paragraph([
              text("See "),
              linked(this.url(url), text(member.name)),
              text("."),
            ]),
          ];
    }
    this.rendered.add(member);
    const name = heading(
      level,
      `${member.name}${member.signatures ? "()" : member.flags.optional ? "?" : ""}`,
    );
    if (isDeprecated(member)) {
      name.children = [{ type: "delete", children: name.children }];
    }
    const out: RootContent[] = [name];
    switch (member.kind) {
      case "Constructor":
      case "Method": {
        out.push(...this.signatures(member, level + 1, ""));
        break;
      }
      case "Accessor": {
        for (const [title, signature, keyword] of [
          ["Get Signature", member.getSignature, "get"],
          ["Set Signature", member.setSignature, "set"],
        ] as const) {
          if (!signature) continue;
          out.push(
            heading(level + 1, title),
            printedCode((printer) => {
              printer
                .modifiers(member.flags)
                .keyword(keyword)
                .punctuation(" ")
                .signature(signature, member.name)
                .punctuation(";");
            }),
            ...definedIn(signature.sources),
            ...this.text(signature.comment?.summary),
            ...this.signatureDetails(signature, level + 2, member),
          );
        }
        break;
      }
      default: {
        out.push(
          printedCode((printer) => {
            printer.modifiers(member.flags);
            if (member.flags.optional) {
              printer.keyword("optional").punctuation(" ");
            }
            printer.property(member.name);
            if (member.flags.optional) printer.punctuation("?");
            if (member.type) printer.punctuation(": ").type(member.type);
            else if (member.defaultValue !== undefined) {
              printer.punctuation(": ").name(member.defaultValue);
            }
            printer.punctuation(";");
          }),
          ...definedIn(member.sources),
          // Members of function types are described as functions.
          ...(member.type?.type === "function"
            ? [
                ...this.text(member.comment?.summary),
                ...this.signatureDetails(
                  member.type.signature,
                  level + 1,
                  member,
                ),
              ]
            : [
                ...this.comment(member, level + 1),
                ...this.relations(member, level + 1),
              ]),
        );
      }
    }
    return out;
  }
}

/**
 * Renders a project as Markdown.
 *
 * @param project The project.
 * @param options How to render it.
 * @returns The files, by path.
 */
export function renderMarkdown(
  project: Project,
  options: MarkdownOptions = {},
): Map<string, string> {
  return new Map(
    renderMarkdownPages(project, options).map(({ page, markdown }) => [
      page.url,
      markdown,
    ]),
  );
}

export interface MarkdownPage {
  /** The page: its path, and what it documents. */
  page: Page;
  markdown: string;
}

/**
 * Renders a project as Markdown, for tools that need to know what each page
 * documents.
 *
 * @param project The project.
 * @param options How to render it.
 * @returns The pages, in order.
 */
export function renderMarkdownPages(
  project: Project,
  options: MarkdownOptions = {},
): MarkdownPage[] {
  return new MarkdownWriter(project, options).render(project);
}
