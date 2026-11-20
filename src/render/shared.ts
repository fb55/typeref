/**
 * What the output formats share: sections of members, titles, and comments
 * as Markdown.
 *
 * @module
 */
import type { Nodes, PhrasingContent, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { toMarkdown } from "mdast-util-to-markdown";
import { toString } from "mdast-util-to-string";
import { gfm } from "micromark-extension-gfm";

import { firstParagraph } from "../comment.ts";
import type {
  Comment,
  Declaration,
  Kind,
  Part,
  Signature,
  Target,
} from "../model.ts";

/** Names of kinds, for titles: `Class: Cheerio`. */
export const kindNames: Record<Kind, string> = {
  Module: "Module",
  Namespace: "Namespace",
  Enum: "Enumeration",
  EnumMember: "Enumeration Member",
  Variable: "Variable",
  Function: "Function",
  Class: "Class",
  Interface: "Interface",
  Constructor: "Constructor",
  Property: "Property",
  Method: "Method",
  Accessor: "Accessor",
  TypeAlias: "Type Alias",
  TypeLiteral: "Type Literal",
  Reference: "Reference",
};

/** Titles of groups of members, by kind. */
const groupTitles: Record<Kind, string> = {
  Module: "Modules",
  Namespace: "Namespaces",
  Enum: "Enumerations",
  EnumMember: "Enumeration Members",
  Variable: "Variables",
  Function: "Functions",
  Class: "Classes",
  Interface: "Interfaces",
  Constructor: "Constructors",
  Property: "Properties",
  Method: "Methods",
  Accessor: "Accessors",
  TypeAlias: "Type Aliases",
  TypeLiteral: "Type Literals",
  Reference: "References",
};

/** Block tags shown elsewhere, or not at all. */
const hiddenTags = new Set([
  "@category",
  "@categoryDescription",
  "@group",
  "@groupDescription",
  "@inheritDoc",
  "@module",
  "@privateRemarks",
  "@returns",
  "@summary",
]);

export interface Section {
  title: string;
  members: Declaration[];
}

/**
 * @param comment A comment.
 * @param tag A block tag, including its `@`.
 * @returns The plain text of each of the tag's blocks.
 */
function tagTexts(comment: Comment | undefined, tag: string): string[] {
  return (comment?.blockTags ?? [])
    .filter((block) => block.tag === tag)
    .map((block) =>
      block.content
        .map((part) => part.text)
        .join("")
        .trim(),
    )
    .filter(Boolean);
}

/**
 * @param declaration A declaration.
 * @returns Its comment, or that of its first signature.
 */
export function commentOf(declaration: Declaration): Comment | undefined {
  return (
    declaration.comment ??
    declaration.signatures?.[0]?.comment ??
    declaration.getSignature?.comment ??
    declaration.setSignature?.comment
  );
}

/**
 * Overloads and accessors' getters and setters may each have a category.
 *
 * @param member A member.
 * @param tag The tag naming its sections: `@category` or `@group`.
 * @returns The texts of the member's tags, without duplicates.
 */
function titlesOf(member: Declaration, tag: string): string[] {
  return [
    ...new Set(
      [
        member.comment,
        ...[
          ...(member.signatures ?? []),
          member.getSignature,
          member.setSignature,
        ].map((signature) => signature?.comment),
      ].flatMap((comment) => tagTexts(comment, tag)),
    ),
  ];
}

/**
 * Splits members into sections: their categories if any has one (`Other`
 * for the rest), otherwise their groups (by kind, or `@group`).
 *
 * @param members The members, in order.
 * @returns The sections, in order.
 */
export function sections(members: Declaration[]): Section[] {
  const byTitle = new Map<string, Declaration[]>();
  const add = (title: string, member: Declaration): void => {
    const list = byTitle.get(title);
    if (list) list.push(member);
    else byTitle.set(title, [member]);
  };
  const isCategorized = members.some(
    (member) => titlesOf(member, "@category").length > 0,
  );
  for (const member of members) {
    const titles = titlesOf(member, isCategorized ? "@category" : "@group");
    if (titles.length === 0) {
      add(isCategorized ? "Other" : groupTitles[member.kind], member);
    }
    for (const title of titles) add(title, member);
  }
  const result = [...byTitle].map(([title, list]) => ({
    title,
    members: list,
  }));
  return isCategorized
    ? result.toSorted((left, right) => left.title.localeCompare(right.title))
    : result;
}

/**
 * @param comment A comment.
 * @returns Its block tags to show, with their titles.
 */
export function blockTags(
  comment: Comment | undefined,
): { title: string; content: Part[] }[] {
  const tags = (comment?.blockTags ?? []).filter(
    (block) => !hiddenTags.has(block.tag),
  );
  // Several `@see` tags are one list, where the first one is.
  const see = tags.filter((block) => block.tag === "@see");
  return tags.flatMap((block) => {
    if (block.tag === "@see" && see.length > 1) {
      if (block !== see[0]) return [];
      const content: Part[] = [];
      for (const tag of see) {
        content.push({ kind: "text", text: " - " }, ...tag.content, {
          kind: "text",
          text: "\n",
        });
      }
      return [{ title: "See", content }];
    }
    return [
      {
        title:
          block.tag === "@defaultValue" || block.tag === "@default"
            ? "Default"
            : block.tag.charAt(1).toUpperCase() + block.tag.slice(2),
        content:
          block.tag === "@example" ? caption(block.content) : block.content,
      },
    ];
  });
}

/**
 * Makes the text on the line of an `@example` tag, before its code, the
 * example's caption.
 *
 * @param content The tag's content.
 * @returns The content, with the caption in bold.
 */
function caption(content: Part[]): Part[] {
  const [first, ...rest] = content;
  if (first?.kind !== "text" || rest.length === 0) return content;
  const end = first.text.indexOf("\n");
  const title = (end === -1 ? first.text : first.text.slice(0, end)).trim();
  if (!title) return content;
  return [
    {
      kind: "text",
      text: `**${title}**${end === -1 ? "" : first.text.slice(end)}`,
    },
    ...rest,
  ];
}

/**
 * @param comment A comment.
 * @returns The content of its `@returns` tag.
 */
export function returnsOf(comment: Comment | undefined): Part[] | undefined {
  return comment?.blockTags.find((block) => block.tag === "@returns")?.content;
}

/**
 * @param declaration A declaration.
 * @returns Whether it is deprecated.
 */
export function isDeprecated(declaration: Declaration): boolean {
  return Boolean(
    commentOf(declaration)?.blockTags.some(
      (block) => block.tag === "@deprecated",
    ),
  );
}

/**
 * Parses comment text, Markdown, with its `{@link}` tags as links.
 *
 * @param parts The text.
 * @param link The URL of a link's target.
 * @param base A README's URL in its repository, for its relative links.
 * @returns The Markdown tree.
 */
export function markdownTree(
  parts: Part[],
  link: (target: Target) => string | undefined,
  base?: string,
): Root {
  let markdown = "";
  for (const part of parts) {
    const url =
      part.kind === "inline-tag" && part.target ? link(part.target) : undefined;
    if (
      part.kind !== "inline-tag" ||
      (part.tag !== "@link" &&
        part.tag !== "@linkcode" &&
        part.tag !== "@linkplain") ||
      (url === undefined && part.tag !== "@linkcode")
    ) {
      markdown += part.text;
      continue;
    }
    const label: PhrasingContent =
      part.tag === "@linkcode"
        ? { type: "inlineCode", value: part.text }
        : { type: "text", value: part.text };
    // A `!` before a link would make it an image.
    if (markdown.endsWith("!")) markdown = `${markdown.slice(0, -1)}\\!`;
    markdown += toMarkdown(
      url === undefined ? label : { type: "link", url, children: [label] },
    ).trimEnd();
  }
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  if (base !== undefined) rebase(tree, base);
  return tree;
}

/**
 * Resolves a README's relative links and images where it is in its
 * repository: links to pages showing files, images to the files.
 *
 * @param tree The README.
 * @param base The README's URL.
 */
function rebase(tree: Root, base: string): void {
  const nodes: Nodes[] = [];
  const collect = (node: Nodes): void => {
    nodes.push(node);
    if ("children" in node) for (const child of node.children) collect(child);
  };
  collect(tree);
  const root = /^.*?\/(?:-\/)?blob\/[^/]+\//u.exec(base)?.[0] ?? base;
  // Definitions that images refer to are images too.
  const images = new Set(
    nodes.flatMap((node) =>
      node.type === "imageReference" ? [node.identifier] : [],
    ),
  );
  for (const node of nodes) {
    if (
      (node.type === "link" ||
        node.type === "image" ||
        node.type === "definition") &&
      !/^(?:[A-Za-z][\w+.-]*:|#|\/\/)/u.test(node.url)
    ) {
      // Paths from `/` start at the repository's root, at the README's commit.
      const url = new URL(
        node.url.replace(/^\//u, ""),
        node.url.startsWith("/") ? root : base,
      ).href;
      node.url =
        node.type === "image" ||
        (node.type === "definition" && images.has(node.identifier))
          ? url.replace("/blob/", "/raw/")
          : url;
    }
  }
}

/**
 * Puts comment text on one line, for table cells and indexes: blocks are
 * joined by spaces, blocks other than paragraphs give their text.
 *
 * @param parts The text.
 * @param link The URL of a link's target.
 * @returns The text's inline content.
 */
export function inlineMarkdown(
  parts: Part[],
  link: (target: Target) => string | undefined,
): PhrasingContent[] {
  const inline: PhrasingContent[] = [];
  for (const block of markdownTree(parts, link).children) {
    if (inline.length > 0) inline.push({ type: "text", value: " " });
    if (block.type === "paragraph" || block.type === "heading") {
      inline.push(...block.children);
    } else {
      inline.push({ type: "text", value: blockText(block) });
    }
  }
  for (const node of inline) oneLine(node);
  return inline;
}

/**
 * @param node A block.
 * @returns Its text, with its list items and quoted blocks apart.
 */
const blockText = (node: Nodes): string =>
  node.type === "list" || node.type === "listItem" || node.type === "blockquote"
    ? node.children.map(blockText).join(" ")
    : toString(node);

/**
 * Turns the line breaks of inline content's text into spaces.
 *
 * @param node The content, of a tree parsed for this.
 */
function oneLine(node: PhrasingContent): void {
  if (node.type === "text" || node.type === "inlineCode") {
    node.value = node.value.replaceAll(/\s*\n\s*/gu, " ");
  } else if ("children" in node) {
    for (const child of node.children) oneLine(child);
  }
}

/**
 * @param declaration A declaration.
 * @returns The first paragraph of its summary, the description in indexes.
 */
export function summaryOf(declaration: Declaration): Part[] {
  return firstParagraph(commentOf(declaration)?.summary ?? []);
}

/**
 * @param declaration A function, method or variable of a function type.
 * @returns Its signatures.
 */
export function signaturesOf(declaration: Declaration): Signature[] {
  if (declaration.signatures) return declaration.signatures;
  if (declaration.type?.type === "function") {
    return [declaration.type.signature];
  }
  return [];
}
