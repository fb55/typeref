/**
 * Where each declaration is documented: pages for modules, namespaces,
 * classes, interfaces, enums, type aliases, functions and variables, anchors
 * on those pages for their members. URLs follow TypeDoc's, so links to sites
 * TypeDoc built keep working. Optionally, categories of the members of
 * classes, interfaces and enums get pages of their own.
 *
 * @module
 */
import GithubSlugger, { slug as toSlug } from "github-slugger";

import type { Declaration, Kind, Project } from "../model.ts";
import type { SymbolIndex } from "../symbols.ts";
import { isCategorized, sections, type Section } from "./shared.ts";

/** The directories of pages, by kind. */
const directories: Partial<Record<Kind, string>> = {
  Class: "classes",
  Interface: "interfaces",
  Enum: "enums",
  Module: "modules",
  Namespace: "modules",
  TypeAlias: "types",
  Function: "functions",
  Variable: "variables",
};

export interface Page {
  /** The page's path, relative to the output directory. */
  url: string;
  /** The declaration the page documents; none for the project's pages. */
  declaration?: Declaration;
  /**
   * The README, the index of the project's exports, a declaration, or a
   * category of its members.
   */
  kind: "readme" | "index" | "declaration" | "category";
  /** For categories: the members documented on the page. */
  section?: Section;
}

export interface RouterOptions {
  /**
   * Classes, interfaces and enums with at least this many members get a page
   * for each category of their members.
   */
  categoryPages?: number;
}

/** Where sites publish the index of their URLs, for others to link to. */
export const indexUrl = "symbols.json";

/** Kinds whose members are documented on their pages, not on their own. */
const splittable = new Set<Kind>(["Class", "Interface", "Enum"]);

/**
 * Replaces characters that are not safe in file names, as TypeDoc does.
 *
 * @param name A name.
 * @returns The name, safe in URLs and file names.
 */
function normalize(name: string): string {
  return name.replaceAll(/[^\p{L}\p{N}()+,.\-_ -\u{10FFFD}]/gu, "_");
}

/**
 * A project with one entry point shows its exports, not the module, at the
 * top level.
 *
 * @param project The project.
 * @returns The declarations at the top level.
 */
export function topLevel(project: Project): Declaration[] {
  return project.modules.length === 1
    ? (project.modules[0].children ?? [])
    : project.modules;
}

/**
 * @param declaration A declaration.
 * @returns The members of its object type, documented on its page if it has
 *   one (type aliases and variables do).
 */
export function objectMembers(declaration: Declaration): Declaration[] {
  return directories[declaration.kind] !== undefined &&
    declaration.type?.type === "object"
    ? (declaration.type.declaration.children ?? [])
    : [];
}

export class Router {
  readonly pages: Page[] = [];
  private readonly parents = new Map<Declaration, Declaration>();
  private readonly urls = new Map<Declaration, string>();
  private readonly objectMembers = new Set<Declaration>();
  private readonly byId = new Map<number, Declaration>();
  private readonly fileNames = new Set<string>();
  private readonly categories = new Map<Declaration, Page[]>();
  private readonly categoryPagesFrom: number;
  /** Anchors used on each page. */
  private readonly sluggers = new Map<string, GithubSlugger>();
  /** The URL of the project's index of exports. */
  readonly indexUrl: string;
  private readonly extension: string;
  private readonly project: Project;

  /**
   * @param project The project.
   * @param extension The pages' extension, including its dot.
   * @param options How to divide the documentation into pages.
   */
  constructor(
    project: Project,
    extension: string,
    options: RouterOptions = {},
  ) {
    this.extension = extension;
    this.project = project;
    this.categoryPagesFrom = options.categoryPages ?? Infinity;
    if (project.readme !== undefined && project.readme !== "") {
      this.pages.push({ url: this.fileName("index"), kind: "readme" });
      this.indexUrl = this.fileName("modules");
    } else {
      this.indexUrl = this.fileName("index");
    }
    this.pages.push({ url: this.indexUrl, kind: "index" });
    for (const module of topLevel(project)) {
      this.route(module, undefined, this.indexUrl);
    }
  }

  private fileName(base: string): string {
    const lower = base.toLowerCase();
    let name = lower;
    for (let index = 1; this.fileNames.has(name); index++) {
      name = `${lower}-${index}`;
    }
    this.fileNames.add(name);
    return `${base}${name.slice(lower.length)}${this.extension}`;
  }

  private route(
    declaration: Declaration,
    parent: Declaration | undefined,
    parentPage: string,
  ): void {
    this.byId.set(declaration.id, declaration);
    if (parent) this.parents.set(declaration, parent);
    if (declaration.kind === "Reference") return;
    const directory = directories[declaration.kind];
    let page = parentPage;
    if (directory === undefined) {
      // Members are anchors on the page of the nearest declaration with one.
      const names = [declaration.name];
      for (
        let ancestor = parent;
        ancestor && directories[ancestor.kind] === undefined;
        ancestor = this.parents.get(ancestor)
      ) {
        names.unshift(ancestor.name);
      }
      this.urls.set(
        declaration,
        `${page}#${this.anchor(page, names.join("."))}`,
      );
    } else {
      const names = [normalize(declaration.name)];
      for (
        let ancestor = parent;
        ancestor;
        ancestor = this.parents.get(ancestor)
      ) {
        names.unshift(normalize(ancestor.name));
      }
      page = this.fileName(`${directory}/${names.join(".")}`);
      this.urls.set(declaration, page);
      this.pages.push({ url: page, declaration, kind: "declaration" });
    }
    const children = declaration.children ?? [];
    // Members in several categories are documented in the first.
    const pages = new Map<Declaration, string>();
    if (
      children.length >= this.categoryPagesFrom &&
      splittable.has(declaration.kind) &&
      isCategorized(children)
    ) {
      const base = page.slice(0, -this.extension.length);
      const categories = sections(children, declaration.comment).map(
        (section): Page => ({
          url: this.fileName(`${base}/${toSlug(section.title) || "_"}`),
          declaration,
          kind: "category",
          section,
        }),
      );
      for (const category of categories) {
        for (const member of category.section!.members) {
          if (!pages.has(member)) pages.set(member, category.url);
        }
      }
      this.categories.set(declaration, categories);
      this.pages.push(...categories);
    }
    for (const child of children) {
      this.route(child, declaration, pages.get(child) ?? page);
    }
    for (const child of objectMembers(declaration)) {
      this.objectMembers.add(child);
      this.route(child, declaration, page);
    }
  }

  /**
   * Of names declared more than once (in several entry points, or as static
   * and instance members), the first wins.
   *
   * @returns The index of the project's URLs, for others to link to.
   */
  symbolIndex(): SymbolIndex {
    const symbols = new Map<string, string>();
    const visit = (declaration: Declaration, prefix: string): void => {
      const name = `${prefix}${declaration.name}`;
      const url = this.url(declaration);
      if (url !== undefined && !symbols.has(name)) symbols.set(name, url);
      for (const child of [
        ...(declaration.children ?? []),
        ...objectMembers(declaration),
      ]) {
        visit(child, `${name}.`);
      }
    };
    for (const module of this.project.modules) {
      for (const child of module.children ?? []) visit(child, "");
    }
    return { version: 1, symbols: Object.fromEntries(symbols) };
  }

  /**
   * @param declaration A class, interface or enum.
   * @returns The pages of its members' categories, if they have pages.
   */
  categoryPages(declaration: Declaration): Page[] | undefined {
    return this.categories.get(declaration);
  }

  /**
   * @param declaration A declaration.
   * @returns Whether it is a member of an object type, which Markdown lists
   *   in a table.
   */
  isObjectMember(declaration: Declaration): boolean {
    return this.objectMembers.has(declaration);
  }

  /**
   * Makes a unique anchor on a page, as GitHub and Astro do.
   *
   * @param page The page.
   * @param text The heading the anchor is for.
   * @returns The anchor.
   */
  anchor(page: string, text: string): string {
    let slugger = this.sluggers.get(page);
    if (!slugger) {
      slugger = new GithubSlugger();
      this.sluggers.set(page, slugger);
    }
    // Names of punctuation alone have no slug.
    const slug = slugger.slug(text);
    return slug === "" ? slugger.slug("_") : slug;
  }

  /**
   * @param id A declaration's ID.
   * @returns The declaration, if it is documented.
   */
  get(id: number): Declaration | undefined {
    return this.byId.get(id);
  }

  /**
   * @param declaration A declaration.
   * @returns Its URL, relative to the output directory: its page's, with an
   *   anchor for members. References link to what they reference.
   */
  url(declaration: Declaration): string | undefined {
    // References link to what they reference; they have no anchors.
    if (declaration.kind === "Reference") {
      const target =
        declaration.target === undefined
          ? undefined
          : this.byId.get(declaration.target);
      return target && this.url(target);
    }
    return this.urls.get(declaration);
  }

  /**
   * @param declaration A declaration.
   * @returns Whether it has a page of its own.
   */
  hasPage(declaration: Declaration): boolean {
    return (
      directories[declaration.kind] !== undefined && this.urls.has(declaration)
    );
  }

  /**
   * @param from The page a link is on.
   * @param to The URL it links to, relative to the output directory.
   * @returns The URL relative to the page.
   */
  static relative(from: string, to: string): string {
    const hash = to.indexOf("#");
    if (hash !== -1 && to.slice(0, hash) === from) return to.slice(hash);
    const fromParts = from.split("/").slice(0, -1);
    const toParts = to.split("/");
    let common = 0;
    while (
      common < fromParts.length &&
      common < toParts.length - 1 &&
      fromParts[common] === toParts[common]
    ) {
      common++;
    }
    return [
      ...Array.from({ length: fromParts.length - common }, () => ".."),
      ...toParts.slice(common),
    ].join("/");
  }
}
