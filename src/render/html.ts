/**
 * HTML pages: a static site with navigation, a table of contents per page,
 * search, and highlighted code.
 *
 * @module
 */
import { readFileSync } from "node:fs";

import { toHtml } from "hast-util-to-html";
import { h, type Child, type Result } from "hastscript";
import {
  defaultHandlers,
  toHast,
  type Options as ToHastOptions,
} from "mdast-util-to-hast";
import { toString } from "mdast-util-to-string";
import { createHighlighter, type Highlighter } from "shiki";

import type {
  Declaration,
  Module,
  Parameter,
  Part,
  Project,
  Signature,
  Source,
  Target,
  Type,
  TypeParameter,
} from "../model.ts";
import {
  indexUrl,
  objectMembers,
  Router,
  topLevel,
  type Page,
} from "./router.ts";
import {
  blockTags,
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
import { tokens, type Token, type TypePrinter } from "./types.ts";

const languages = [
  "bash",
  "css",
  "html",
  "javascript",
  "json",
  "jsx",
  "shellscript",
  "tsx",
  "typescript",
  "xml",
  "yaml",
];

const assets = new URL("../../assets/", import.meta.url);

/**
 * @param sources A declaration's sources.
 * @returns Where the first one is, linked to its repository if possible.
 */
function definedIn(sources: Source[] | undefined): Result | undefined {
  if (sources === undefined || sources.length === 0) return undefined;
  const [source] = sources;
  const label = `${source.file}:${source.line}`;
  return h(
    "p.source",
    "Defined in ",
    source.url === undefined ? label : h("a", { href: source.url }, label),
  );
}

/**
 * @param declaration A declaration.
 * @returns The header of its page: its kind, name and badges.
 */
function pageHeading(declaration: Declaration): Result {
  const badges = [
    declaration.flags.abstract && "abstract",
    isDeprecated(declaration) && "deprecated",
  ].filter((badge) => typeof badge === "string");
  return h(
    "header.page-header",
    h("p.kind", kindNames[declaration.kind]),
    h(
      "h1",
      declaration.name,
      declaration.typeParameters !== undefined &&
        declaration.typeParameters.length > 0
        ? h(
            "span.type-parameters",
            `<${declaration.typeParameters.map((parameter) => parameter.name).join(", ")}>`,
          )
        : undefined,
    ),
    badges.flatMap((badge) => [" ", h("span.badge", badge)]),
  );
}

export interface HtmlOptions {
  /**
   * Classes, interfaces and enums with at least this many members get a page
   * for each category of their members.
   */
  categoryPages?: number;
}

class HtmlWriter {
  private readonly router: Router;
  private readonly project: Project;
  /** How comments' Markdown becomes HTML. */
  private readonly markdown: ToHastOptions;
  private page = "";
  /** The members documented on the current page. */
  private readonly rendered = new Set<Declaration>();

  constructor(
    project: Project,
    highlighter: Highlighter,
    options: HtmlOptions,
  ) {
    this.project = project;
    this.router = new Router(project, ".html", options);
    const loaded = new Set(highlighter.getLoadedLanguages());
    this.markdown = {
      allowDangerousHtml: true,
      handlers: {
        code: (state, node) => {
          const lang = node.lang ?? "typescript";
          const [child] = loaded.has(lang)
            ? highlighter.codeToHast(node.value, {
                lang,
                // Their colors contrast 4.5:1 with the code's background.
                themes: {
                  light: "github-light-high-contrast",
                  dark: "github-dark-default",
                },
                defaultColor: false,
              }).children
            : [];
          return child?.type === "element"
            ? child
            : defaultHandlers.code(state, node);
        },
        // Wide tables scroll in a region keyboards can reach (Safari's cannot).
        table: (state, node) =>
          h(
            "div",
            { class: "table", tabIndex: 0, role: "region", ariaLabel: "Table" },
            defaultHandlers.table(state, node),
          ),
        // Headings get IDs, unique on their page, for the links to them.
        heading: (state, node) =>
          h(
            `h${node.depth}`,
            {
              id: this.router.anchor(
                this.page,
                toString(node, {
                  includeHtml: false,
                  includeImageAlt: false,
                }).trim(),
              ),
            },
            state.all(node),
          ),
      } satisfies Partial<typeof defaultHandlers>,
    };
  }

  render(): Map<string, string> {
    const files = new Map<string, string>();
    for (const page of this.router.pages) {
      this.page = page.url;
      this.rendered.clear();
      let title: string;
      let content: Result;
      if (page.kind === "readme") {
        title = "Overview";
        content = h(
          "article.readme",
          this.text(
            [{ kind: "text", text: this.project.readme ?? "" }],
            this.project.readmeUrl,
          ),
        );
      } else if (page.kind === "index") {
        // The index is the home page unless there is a README.
        title =
          this.router.pages[0].kind === "readme"
            ? "API reference"
            : this.project.name;
        content = this.index(this.project);
      } else if (page.kind === "category") {
        const { declaration, section } = page as Required<Page>;
        title = `${declaration.name}: ${section.title}`;
        content = this.categoryPage(declaration, section);
      } else {
        const declaration = page.declaration!;
        title = declaration.name;
        content = this.declarationPage(declaration);
      }
      files.set(page.url, this.layout(title, content, page));
    }
    files.set("assets/search.json", JSON.stringify(this.searchIndex()));
    // For the docs of other packages, to link here.
    files.set(indexUrl, JSON.stringify(this.router.symbolIndex()));
    for (const asset of ["style.css", "main.js"]) {
      files.set(
        `assets/${asset}`,
        readFileSync(new URL(asset, assets), "utf8"),
      );
    }
    return files;
  }

  private url(to: string): string {
    return Router.relative(this.page, to);
  }

  private link(target: Target): string | undefined {
    if (target.kind === "url") return target.url;
    const declaration = this.router.get(target.id);
    const url = declaration && this.router.url(declaration);
    return url === undefined ? undefined : this.url(url);
  }

  /**
   * @param member A declaration in an index.
   * @returns Where it is documented: for re-exports of dependencies, in
   *   their docs.
   */
  private memberUrl(member: Declaration): string | undefined {
    if (member.kind === "Reference" && member.type?.type === "reference") {
      return member.type.target && this.link(member.type.target);
    }
    const url = this.router.url(member);
    return url === undefined ? undefined : this.url(url);
  }

  private anchorOf(declaration: Declaration): string | undefined {
    return this.router.url(declaration)?.split("#")[1];
  }

  private text(parts: Part[] | undefined, readmeUrl?: string): Child {
    return toHast(
      markdownTree(parts ?? [], (target) => this.link(target), readmeUrl),
      this.markdown,
    );
  }

  private inlineText(parts: Part[] | undefined): Child {
    return toHast(
      {
        type: "root",
        children: inlineMarkdown(parts ?? [], (target) => this.link(target)),
      },
      this.markdown,
    );
  }

  private tokens(list: Token[]): (Result | string)[] {
    return list.map((token) => {
      if (token.kind === "punctuation") return token.text;
      const url = token.target && this.link(token.target);
      const className = {
        keyword: "k",
        name: "n",
        literal: "l",
        parameter: "p",
      }[token.kind];
      return url === undefined
        ? h("span", { class: className }, token.text)
        : h("a", { class: className, href: url }, token.text);
    });
  }

  private type(type: Type): (Result | string)[] {
    return this.tokens(
      tokens((printer) => {
        printer.type(type);
      }),
    );
  }

  private code(print: (printer: TypePrinter) => void): Result {
    return h("pre.signature", h("code", this.tokens(tokens(print))));
  }

  private layout(title: string, content: Result, page: Page): string {
    const { project } = this;
    const current = page.declaration;
    const description = current
      ? toString(markdownTree(summaryOf(current), () => undefined))
          .replaceAll(/\s+/gu, " ")
          .trim()
      : "";
    const base = this.url("");
    return toHtml(
      {
        type: "root",
        children: [
          { type: "doctype" },
          h(
            "html",
            { lang: "en" },
            h(
              "head",
              {},
              // HTML spells the encoding `utf-8`; the rule is for Node's names.
              // oxlint-disable-next-line unicorn/text-encoding-identifier-case
              h("meta", { charSet: "utf-8" }),
              h("meta", {
                name: "viewport",
                content: "width=device-width, initial-scale=1",
              }),
              h("meta", { name: "color-scheme", content: "light dark" }),
              h(
                "title",
                title === project.name ? title : `${title} | ${project.name}`,
              ),
              description
                ? h("meta", { name: "description", content: description })
                : undefined,
              h("link", { rel: "stylesheet", href: `${base}assets/style.css` }),
              h("script", { type: "module", src: `${base}assets/main.js` }),
            ),
            h(
              "body",
              { "data-base": base },
              h("a.skip", { href: "#Main" }, "Skip to content"),
              h(
                "header.top",
                h(
                  "a.project",
                  { href: this.url(this.router.pages[0].url) },
                  project.name,
                  project.version !== undefined && project.version !== ""
                    ? [" ", h("span.version", project.version)]
                    : undefined,
                ),
                h(
                  "button",
                  {
                    type: "button",
                    class: "search-button",
                    command: "show-modal",
                    commandfor: "Search",
                    "aria-keyshortcuts": "Control+K Meta+K",
                  },
                  "Search ",
                  h("kbd", "Ctrl K"),
                ),
              ),
              h(
                "div.layout",
                h("main#Main", { tabindex: "-1" }, content),
                this.toc(page),
                h("nav.site", { "aria-label": "API" }, this.navigation(page)),
              ),
              h(
                "dialog#Search",
                { closedby: "any", "aria-label": "Search" },
                h(
                  "form",
                  { method: "dialog", class: "search-bar" },
                  h("button", { type: "submit" }, "Close"),
                ),
                h("input", {
                  type: "search",
                  placeholder: "Search the API",
                  "aria-label": "Search the API",
                  autocomplete: "off",
                  autofocus: true,
                }),
                h("ul.results", { "aria-live": "polite" }),
              ),
            ),
          ),
        ],
      },
      { allowDangerousHtml: true },
    );
  }

  private navigation(page: Page): Result {
    return h(
      null,
      this.project.readme !== undefined && this.project.readme !== ""
        ? h("p", [
            h("a", { href: this.url(this.router.pages[0].url) }, "Overview"),
            h("a", { href: this.url(this.router.indexUrl) }, "API reference"),
          ])
        : undefined,
      sections(topLevel(this.project)).flatMap((section) => [
        h("h2", section.title),
        h(
          "ul",
          section.members.map((declaration) => {
            const url = this.memberUrl(declaration);
            const categories = this.router.categoryPages(declaration);
            return h(
              "li",
              url === undefined
                ? declaration.name
                : h(
                    "a",
                    {
                      href: url,
                      // On the pages of its categories, it is the parent.
                      "aria-current":
                        declaration === page.declaration
                          ? page.kind === "category"
                            ? "true"
                            : "page"
                          : undefined,
                      class: isDeprecated(declaration)
                        ? "deprecated"
                        : undefined,
                    },
                    declaration.name,
                  ),
              categories &&
                h(
                  "ul",
                  categories.map((category) =>
                    h(
                      "li",
                      h(
                        "a",
                        {
                          href: this.url(category.url),
                          "aria-current":
                            category === page ? "page" : undefined,
                        },
                        category.section!.title,
                      ),
                    ),
                  ),
                ),
            );
          }),
        ),
      ]),
    );
  }

  private toc(page: Page): Result | undefined {
    const current = page.declaration;
    if (
      !current ||
      current.kind === "Module" ||
      current.kind === "Namespace" ||
      (current.children ?? []).length === 0
    ) {
      return undefined;
    }
    const categories = page.section
      ? undefined
      : this.router.categoryPages(current);
    const list = page.section
      ? [
          {
            ...page.section,
            // Members of several categories are on their first one's page.
            members: page.section.members.filter(
              (member) => this.router.url(member)?.split("#")[0] === page.url,
            ),
          },
        ]
      : (categories?.map((category) => category.section!) ??
        sections(current.children ?? []));
    if (list.every((section) => section.members.length === 0)) {
      return undefined;
    }
    // The index of categories' pages links to members on those pages.
    const label = categories ? "Members" : "On this page";
    return h(
      "nav.toc",
      { "aria-label": label },
      h("h2", label),
      list.flatMap((section) => [
        h("h3", section.title),
        h(
          "ul",
          section.members.map((member) => {
            const url = this.memberUrl(member);
            return url === undefined
              ? undefined
              : h("li", h("a", { href: url }, member.name));
          }),
        ),
      ]),
    );
  }

  private index(project: Project): Result {
    // With one entry point, the index is the module's page.
    return h(
      null,
      h("h1", project.name),
      project.modules.length === 1
        ? this.comment(project.modules[0], 2)
        : undefined,
      sections(
        topLevel(project),
        project.modules.length === 1 ? project.modules[0].comment : undefined,
      ).map((section) => this.sectionIndex(section)),
    );
  }

  /**
   * @param declaration A class, interface or enum.
   * @param section A category of its members.
   * @returns The page of the category.
   */
  private categoryPage(declaration: Declaration, section: Section): Result {
    return h(
      "article",
      h(
        "header.page-header",
        h(
          "p.kind",
          `${kindNames[declaration.kind]} `,
          h("a", { href: this.memberUrl(declaration) }, declaration.name),
        ),
        h("h1", section.title),
      ),
      this.text(section.description),
      this.members(section.members, 2),
    );
  }

  /**
   * @param section A section of members.
   * @param url The page it has, if any.
   * @returns An index of the section's members.
   */
  private sectionIndex(section: Section, url?: string): Result {
    return h(
      "section",
      h(
        "h2",
        url === undefined
          ? section.title
          : h("a", { href: this.url(url) }, section.title),
      ),
      this.text(section.description),
      h(
        "dl.index",
        section.members.flatMap((member) => {
          const href = this.memberUrl(member);
          const external =
            member.kind === "Reference" && member.type?.type === "reference";
          const name = h("code", member.name);
          // Links to the member from before its declaration's page was split.
          const anchor = this.rendered.has(member)
            ? undefined
            : this.router.indexAnchor(member);
          this.rendered.add(member);
          return [
            h(
              "dt",
              {
                id: anchor,
                class: isDeprecated(member) ? "deprecated" : undefined,
              },
              href === undefined ? name : h("a", { href }, name),
            ),
            h(
              "dd",
              external
                ? "Re-exported from a dependency."
                : this.inlineText(summaryOf(member)),
            ),
          ];
        }),
      ),
    );
  }

  private declarationPage(declaration: Declaration): Result {
    const parts: Child[] = [pageHeading(declaration)];
    switch (declaration.kind) {
      case "Function": {
        parts.push(this.signatures(declaration, 2, "function"));
        break;
      }
      case "Variable":
      case "TypeAlias": {
        parts.push(
          this.code((printer) => {
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
                .typeParameters(declaration.typeParameters, true)
                .punctuation(" = ");
            } else {
              printer.punctuation(": ");
            }
            if (declaration.type) printer.type(declaration.type);
          }),
          definedIn(declaration.sources),
          // The signature's details show the tags of function types.
          declaration.type?.type === "function"
            ? this.text(declaration.comment?.summary)
            : this.comment(declaration, 2),
          this.typeParameterList(declaration.typeParameters, 2),
        );
        if (declaration.type?.type === "function") {
          parts.push(
            this.signatureDetails(declaration.type.signature, 2, declaration),
          );
        }
        if (declaration.type?.type === "object") {
          const object = declaration.type.declaration;
          const { children } = object;
          parts.push(...this.indexable(object));
          if (object.signatures) {
            parts.push(
              h("h2", "Call signatures"),
              this.signatures(object, 3, ""),
            );
          }
          if (children && children.length > 0) {
            parts.push(h("h2", "Properties"), this.members(children, 3));
          }
        }
        break;
      }
      case "Module":
      case "Namespace": {
        parts.push(
          this.comment(declaration, 2),
          sections(declaration.children ?? [], declaration.comment).map(
            (section) => this.sectionIndex(section),
          ),
        );
        const { readme, readmeUrl } = declaration as Module;
        if (readme !== undefined) {
          parts.push(
            h(
              "section.readme",
              this.text([{ kind: "text", text: readme }], readmeUrl),
            ),
          );
        }
        break;
      }
      default: {
        parts.push(
          this.declarationSignature(declaration),
          definedIn(declaration.sources),
          this.comment(declaration, 2),
          this.typeParameterList(declaration.typeParameters, 2),
          ...this.indexable(declaration),
        );
        if (declaration.signatures) {
          parts.push(
            h("h2", "Call signatures"),
            this.signatures(declaration, 3, ""),
          );
        }
        const categories = this.router.categoryPages(declaration);
        // The members are on the categories' pages; this is their index.
        const list = categories
          ? categories.map(({ url, section }) =>
              this.sectionIndex(section!, url),
            )
          : sections(declaration.children ?? [], declaration.comment).map(
              (section) =>
                h(
                  null,
                  h("h2", section.title),
                  this.text(section.description),
                  this.members(section.members, 3),
                ),
            );
        parts.push(...list);
      }
    }
    return h("article", ...parts);
  }

  private indexable(declaration: Declaration): Result[] {
    return (declaration.indexSignatures ?? []).map((signature) =>
      h(
        null,
        h("h2", "Index signature"),
        this.code((printer) => {
          printer.indexSignature(signature);
        }),
        this.text(signature.comment?.summary),
        this.text(returnsOf(signature.comment)),
        this.tags(blockTags(signature.comment), 3),
      ),
    );
  }

  /**
   * @param declaration A class, interface or enum.
   * @returns Its declaration, as code: `class A<T> extends B`.
   */
  private declarationSignature(declaration: Declaration): Result | undefined {
    const keyword = { Class: "class", Interface: "interface", Enum: "enum" }[
      declaration.kind as "Class"
    ];
    if (!keyword) return undefined;
    return this.code((printer) => {
      if (declaration.flags.abstract) {
        printer.keyword("abstract").punctuation(" ");
      }
      if (declaration.flags.const) printer.keyword("const").punctuation(" ");
      printer.keyword(keyword).punctuation(" ").name(declaration.name);
      printer.typeParameters(declaration.typeParameters, true);
      for (const [clause, types] of [
        ["extends", declaration.extends],
        ["implements", declaration.implements],
      ] as const) {
        if (!types) continue;
        printer.punctuation(" ").keyword(clause).punctuation(" ");
        for (const [index, type] of types.entries()) {
          if (index > 0) printer.punctuation(", ");
          printer.type(type);
        }
      }
    });
  }

  private comment(declaration: Declaration, level: number): Result | undefined {
    const { comment } = declaration;
    if (!comment) return undefined;
    return h(
      null,
      this.text(comment.summary),
      this.tags(blockTags(comment), level),
    );
  }

  private tags(
    tags: { title: string; content: Part[] }[],
    level: number,
  ): Result[] {
    return tags.map(({ title, content }) =>
      h("section.tag", h(`h${level}.tag-title`, title), this.text(content)),
    );
  }

  private typeParameterList(
    parameters: TypeParameter[] | undefined,
    level: number,
  ): Result | undefined {
    if (parameters === undefined || parameters.length === 0) {
      return undefined;
    }
    return h(
      null,
      h(`h${level}`, "Type parameters"),
      h(
        "dl.parameters",
        parameters.flatMap((parameter) => [
          h(
            "dt",
            h(
              "code",
              this.tokens(
                tokens((printer) => {
                  printer.typeParameters([parameter], true);
                }).slice(1, -1),
              ),
            ),
          ),
          h("dd", this.text(parameter.comment)),
        ]),
      ),
    );
  }

  private parameterList(
    parameters: Parameter[],
    level: number,
  ): Result | undefined {
    if (parameters.length === 0) return undefined;
    return h(
      null,
      h(`h${level}`, "Parameters"),
      h(
        "dl.parameters",
        parameters.flatMap((parameter) => [
          h(
            "dt",
            h(
              "code",
              this.tokens(
                tokens((printer) => {
                  printer.parameter(parameter);
                }),
              ),
            ),
          ),
          h("dd", this.text(parameter.comment)),
        ]),
      ),
    );
  }

  private signatures(
    declaration: Declaration,
    level: number,
    prefix: string,
  ): Result[] {
    return signaturesOf(declaration).map((signature) =>
      h(
        "div.signature-block",
        this.signature(signature, level, prefix, declaration),
      ),
    );
  }

  private signature(
    signature: Signature,
    level: number,
    prefix: string,
    declaration: Declaration,
  ): Result {
    // Construct signatures are named `new`, methods may be too.
    const name =
      signature.name === "new" && declaration.kind !== "Method"
        ? "new "
        : signature.name;
    return h(
      null,
      this.code((printer) => {
        if (prefix) printer.keyword(prefix).punctuation(" ");
        printer.modifiers(declaration.flags);
        if (declaration.kind === "Method") {
          printer.property(name);
          if (declaration.flags.optional) printer.punctuation("?");
          printer.signature(signature, "");
        } else {
          printer.signature(signature, name);
        }
      }),
      definedIn(signature.sources),
      this.text(signature.comment?.summary),
      this.signatureDetails(signature, level, declaration),
    );
  }

  private signatureDetails(
    signature: Signature,
    level: number,
    declaration: Declaration,
  ): Result {
    // Variables and properties of function types describe the function.
    const comment =
      signature.comment ??
      (declaration.type?.type === "function" ? declaration.comment : undefined);
    return h(
      null,
      this.typeParameterList(signature.typeParameters, level),
      this.parameterList(signature.parameters, level),
      ...(signature.returns
        ? [
            h(`h${level}`, "Returns"),
            h("p", h("code", this.type(signature.returns))),
            this.text(returnsOf(comment)),
          ]
        : []),
      this.tags(blockTags(comment), level),
      this.relations(declaration),
    );
  }

  private relations(declaration: Declaration): Result | undefined {
    if (declaration.inheritedFrom) {
      return h(
        "p.relation",
        "Inherited from ",
        h("code", this.type(declaration.inheritedFrom)),
      );
    }
    if (declaration.overwrites) {
      return h(
        "p.relation",
        "Overrides ",
        h("code", this.type(declaration.overwrites)),
      );
    }
    return undefined;
  }

  private members(members: Declaration[], level: number): Result[] {
    return members.map((member) => this.member(member, level));
  }

  private member(member: Declaration, level: number): Result {
    const anchor = this.anchorOf(member) ?? "";
    // Members in several categories are documented in the first.
    const home = this.router.url(member)?.split("#")[0];
    if (
      this.rendered.has(member) ||
      (home !== undefined && home !== this.page)
    ) {
      return h(
        "p.also",
        h("a", { href: this.memberUrl(member) }, h("code", member.name)),
      );
    }
    this.rendered.add(member);
    const flags = (
      ["static", "abstract", "protected", "readonly", "optional"] as const
    ).filter((flag) => member.flags[flag]);
    if (isDeprecated(member)) flags.push("deprecated" as "static");
    const heading = h(
      `h${level}`,
      { id: anchor },
      h("a.anchor", { href: `#${anchor}` }, member.name),
      flags.flatMap((flag) => [" ", h("span.badge", flag)]),
    );
    let body: Child;
    switch (member.kind) {
      case "Constructor":
      case "Method": {
        body = this.signatures(member, level + 1, "");
        break;
      }
      case "Accessor": {
        body = h(
          null,
          [member.getSignature, member.setSignature].map((signature, index) =>
            signature
              ? h(
                  null,
                  this.code((printer) => {
                    printer
                      .modifiers(member.flags)
                      .keyword(index === 0 ? "get" : "set")
                      .punctuation(" ")
                      .signature(signature, member.name);
                  }),
                  definedIn(signature.sources),
                  this.text(signature.comment?.summary),
                  this.signatureDetails(signature, level + 1, member),
                )
              : undefined,
          ),
        );
        break;
      }
      case "Reference": {
        const target =
          member.target === undefined
            ? undefined
            : this.router.get(member.target);
        const url = target && this.router.url(target);
        body = h(
          "p",
          "Re-exports ",
          target !== undefined && url !== undefined
            ? h("a", { href: this.url(url) }, h("code", target.name))
            : h("code", member.name),
        );
        break;
      }
      default: {
        body = h(
          null,
          this.code((printer) => {
            printer.modifiers(member.flags);
            printer.property(member.name);
            if (member.flags.optional) printer.punctuation("?");
            if (member.type) printer.punctuation(": ").type(member.type);
            else if (member.defaultValue !== undefined) {
              printer
                .punctuation(" = ")
                .tokens.push({ kind: "literal", text: member.defaultValue });
            }
          }),
          definedIn(member.sources),
          // Members of function types are described as functions.
          member.type?.type === "function"
            ? h(
                null,
                this.text(member.comment?.summary),
                this.signatureDetails(member.type.signature, level + 1, member),
              )
            : h(null, this.comment(member, level + 1), this.relations(member)),
        );
      }
    }
    return h(
      "section",
      {
        class: isDeprecated(member) ? "member deprecated" : "member",
        tabindex: anchor === undefined ? undefined : "-1",
      },
      heading,
      body,
    );
  }

  private searchIndex(): {
    name: string;
    kind: string;
    url: string;
    parent?: string;
  }[] {
    const entries: {
      name: string;
      kind: string;
      url: string;
      parent?: string;
    }[] = [];
    const visit = (declaration: Declaration, parent?: Declaration): void => {
      // Re-exports are found by their names, as what they re-export, and
      // those of dependencies by their docs' URLs.
      const external =
        declaration.kind === "Reference" &&
        declaration.type?.type === "reference" &&
        declaration.type.target?.kind === "url"
          ? declaration.type.target.url
          : undefined;
      const url = external ?? this.router.url(declaration);
      const target =
        declaration.target === undefined
          ? declaration
          : this.router.get(declaration.target);
      if (url !== undefined && target && declaration.kind !== "Module") {
        const entry: (typeof entries)[number] = {
          name: declaration.name,
          kind: kindNames[target.kind],
          url,
        };
        if (parent && parent.kind !== "Module") entry.parent = parent.name;
        entries.push(entry);
      }
      for (const child of [
        ...(declaration.children ?? []),
        ...objectMembers(declaration),
      ]) {
        visit(child, declaration);
      }
    };
    for (const module of this.project.modules) visit(module);
    return entries;
  }
}

/**
 * Renders a project as an HTML site.
 *
 * @param project The project.
 * @param options How to render it.
 * @returns The files, by path.
 */
export async function renderHtml(
  project: Project,
  options: HtmlOptions = {},
): Promise<Map<string, string>> {
  const highlighter = await createHighlighter({
    themes: ["github-light-high-contrast", "github-dark-default"],
    langs: languages,
  });
  try {
    return new HtmlWriter(project, highlighter, options).render();
  } finally {
    highlighter.dispose();
  }
}
