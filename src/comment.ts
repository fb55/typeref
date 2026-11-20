/**
 * Doc comments: from the text of a `/** … *\/` comment to a {@link Comment}.
 * Follows TSDoc and TypeDoc: a summary, then block tags (`@param`, `@returns`,
 * …), modifier tags anywhere, inline tags (`{@link …}`) in text, and code
 * (inline and fenced) left alone.
 *
 * @module
 */
import type { BlockTag, Comment, Part, Target } from "./model.ts";

/** Tags without content: flags, wherever they are written. */
const modifierTags = new Set([
  "@abstract",
  "@alpha",
  "@beta",
  "@class",
  "@enum",
  "@event",
  "@eventProperty",
  "@experimental",
  "@hidden",
  "@hideCategories",
  "@hideconstructor",
  "@hideGroups",
  "@ignore",
  "@inline",
  "@interface",
  "@internal",
  "@namespace",
  "@overload",
  "@override",
  "@packageDocumentation",
  "@private",
  "@protected",
  "@public",
  "@readonly",
  "@sealed",
  "@showCategories",
  "@showGroups",
  "@useDeclaredType",
  "@virtual",
]);

/** Tags spelled another way, and the spelling used. */
const synonyms: Record<string, string> = {
  "@inheritdoc": "@inheritDoc",
  "@return": "@returns",
  "@template": "@typeParam",
  "@prop": "@property",
};

/** Block tags whose content starts with the name of what they describe. */
const namedTags = new Set(["@param", "@typeParam", "@property", "@inheritDoc"]);

const linkTags = new Set(["@link", "@linkcode", "@linkplain"]);

/** A tag: `@` and a letter, not part of a word, an email or a package name. */
const tagPattern = /@[A-Za-z][\w-]*(?=[\s{}]|$)/uy;
const fencePattern = /^ {0,3}(?<marker>`{3,}|~{3,})/u;

/** Resolves the target of a `{@link}`, e.g. `Foo.bar` or a URL. */
export type LinkResolver = (reference: string) => Target | undefined;

/**
 * Removes the comment's delimiters, the stars starting its lines and the
 * indentation of lines without stars.
 *
 * @param raw The comment, from `/*` to `*\/`.
 * @returns The comment's text.
 */
function stripDelimiters(raw: string): string {
  const lines = raw.slice(2, -2).replace(/^\*+/u, "").split(/\r?\n/u);
  const rest = lines.slice(1).filter((line) => line.trim());
  // Stars start every line, or are part of the text (as list markers).
  const starred = /^\s*\* ?/u;
  const isStarred = rest.every((line) => starred.test(line));
  const indent = Math.min(...rest.map((line) => /^\s*/u.exec(line)![0].length));
  return lines
    .map((line, index) => {
      if (index === 0) return line.trimStart();
      return isStarred ? line.replace(starred, "") : line.slice(indent);
    })
    .join("\n")
    .trim();
}

type Token =
  | { kind: "text" | "code" | "tag"; text: string }
  | { kind: "inline"; tag: string; text: string };

/**
 * Splits comment text into text, code, block or modifier tags and inline tags.
 *
 * @param text The text of the comment.
 * @yields The tokens, in order.
 */
function* tokenize(text: string): Generator<Token> {
  let buffer = "";
  let index = 0;
  let isExample = false;
  function* flush(): Generator<Token> {
    if (buffer) yield { kind: "text", text: buffer };
    buffer = "";
  }
  while (index < text.length) {
    const char = text[index];
    const lineStart =
      index === 0 ||
      text[index - 1] === "\n" ||
      // A fence may open on the line of `@example`.
      ((char === "`" || char === "~") &&
        /(?:^|\n)[ \t]*@example[ \t]+$/u.test(text.slice(0, index)));
    const fence = lineStart ? fencePattern.exec(text.slice(index)) : null;
    if (fence) {
      // A fenced block runs to a fence of the same kind, at least as long.
      const { marker } = fence.groups as { marker: string };
      const close = new RegExp(
        String.raw`\n {0,3}${marker.startsWith("`") ? "`" : "~"}{${marker.length},}[ \t]*(?=\n|$)`,
        "gu",
      );
      close.lastIndex = index + fence[0].length;
      const end = close.exec(text);
      const stop = end ? end.index + end[0].length : text.length;
      yield* flush();
      yield { kind: "code", text: unescapeCode(text.slice(index, stop)) };
      index = stop;
      continue;
    }
    if (char === "\\" && "@{}`/".includes(text[index + 1] ?? " ")) {
      buffer += text[index + 1];
      index += 2;
      continue;
    }
    if (char === "`") {
      // Inline code ends at a run of as many backticks, on the same line.
      const run = /`+/uy;
      run.lastIndex = index;
      const ticks = run.exec(text)![0];
      const lineEnd = text.indexOf("\n", index);
      const closing = new RegExp(`(?<!\`)${ticks}(?!\`)`, "gu");
      closing.lastIndex = index + ticks.length;
      const end = closing.exec(text);
      if (end && (lineEnd === -1 || end.index < lineEnd)) {
        yield* flush();
        const stop = end.index + ticks.length;
        yield { kind: "code", text: text.slice(index, stop) };
        index = stop;
        continue;
      }
      buffer += ticks;
      index += ticks.length;
      continue;
    }
    if (char === "{" && text[index + 1] === "@") {
      tagPattern.lastIndex = index + 1;
      const tag = tagPattern.exec(text);
      const end = text.indexOf("}", index);
      if (tag && end !== -1) {
        yield* flush();
        yield {
          kind: "inline",
          tag: tag[0],
          text: text.slice(index + 1 + tag[0].length, end).trim(),
        };
        index = end + 1;
        continue;
      }
    }
    // In examples, tags start lines: `// @ts-expect-error` is code.
    if (
      char === "@" &&
      (index === 0 || /\s/u.test(text[index - 1])) &&
      (!isExample ||
        text.slice(text.lastIndexOf("\n", index - 1) + 1, index).trim() === "")
    ) {
      tagPattern.lastIndex = index;
      const tag = tagPattern.exec(text);
      if (tag) {
        yield* flush();
        yield { kind: "tag", text: tag[0] };
        isExample = tag[0] === "@example";
        index += tag[0].length;
        continue;
      }
    }
    buffer += char;
    index++;
  }
  yield* flush();
}

/**
 * @param code A fenced block.
 * @returns The block, with `*\/` written as comments must escape it.
 */
const unescapeCode = (code: string): string =>
  code.replaceAll(String.raw`*\/`, "*/");

/**
 * Removes whitespace at the start and end of content, and merges text.
 *
 * @param parts The content.
 * @returns The content, trimmed.
 */
function trim(parts: Part[]): Part[] {
  const merged: Part[] = [];
  for (const part of parts) {
    const last = merged.at(-1);
    if (part.kind === "text" && last?.kind === "text") {
      last.text += part.text;
    } else {
      merged.push(part);
    }
  }
  const first = merged[0];
  if (first?.kind === "text") first.text = first.text.trimStart();
  const last = merged.at(-1);
  if (last?.kind === "text") last.text = last.text.trimEnd();
  return merged.filter((part) => part.kind !== "text" || part.text !== "");
}

/**
 * Takes the name off the content of a `@param`-like tag: `name`, `[name]` or
 * `[name = default]`, after a JSDoc type in braces and before a dash.
 *
 * @param text The start of the tag's content.
 * @returns The name, and the text after it.
 */
export function extractTagName(text: string): {
  name: string;
  newText: string;
} {
  let rest = text.trimStart();
  if (rest.startsWith("{")) {
    // A JSDoc type: balanced braces.
    let depth = 0;
    let index = 0;
    for (; index < rest.length; index++) {
      if (rest[index] === "{") depth++;
      else if (rest[index] === "}" && --depth === 0) break;
    }
    rest = rest.slice(index + 1);
    // Names are on their tags' lines, after the type.
    if (/^[^\S\n]*(?:\n|$)/u.test(rest)) {
      return { name: "", newText: rest.trimStart() };
    }
    rest = rest.trimStart();
  }
  let name: string;
  if (rest.startsWith("[")) {
    // `[name = default]`: the default may hold brackets and strings.
    let depth = 0;
    let quote = "";
    let index = 0;
    for (; index < rest.length; index++) {
      const char = rest[index];
      if (quote) {
        if (char === quote) quote = "";
      } else if (char === "'" || char === '"' || char === "`") {
        quote = char;
      } else if (char === "[") {
        depth++;
      } else if (char === "]" && --depth === 0) {
        break;
      }
    }
    name = rest.slice(1, index).split("=")[0].trim();
    rest = rest.slice(index + 1);
  } else {
    name = /^\S*/u.exec(rest)![0];
    rest = rest.slice(name.length);
  }
  return { name, newText: rest.replace(/^\s*-?\s*/u, "") };
}

/**
 * Splits a link's text into its target and label: `target | label`, or
 * `target label` as JSDoc writes it.
 *
 * @param text The text after the tag.
 * @returns The target, and the label if one was given.
 */
function splitLink(text: string): [string, string | undefined] {
  const bar = text.indexOf("|");
  if (bar !== -1) {
    return [text.slice(0, bar).trim(), text.slice(bar + 1).trim()];
  }
  const space = text.search(/\s/u);
  return space === -1
    ? [text, undefined]
    : [text.slice(0, space), text.slice(space + 1).trim()];
}

/**
 * Parses a doc comment.
 *
 * @param raw The comment, from `/**` to `*\/`.
 * @param resolve Resolves the targets of links.
 * @returns The comment.
 */
export function parseComment(raw: string, resolve: LinkResolver): Comment {
  const summary: Part[] = [];
  const blockTags: BlockTag[] = [];
  const modifiers = new Set<string>();
  let content = summary;
  for (const token of tokenize(stripDelimiters(raw))) {
    if (token.kind === "tag") {
      const tag = synonyms[token.text.toLowerCase()] ?? token.text;
      if (modifierTags.has(tag)) {
        modifiers.add(tag);
      } else {
        const block: BlockTag = { tag, content: [] };
        blockTags.push(block);
        ({ content } = block);
      }
    } else if (token.kind === "inline") {
      const tag = synonyms[token.tag.toLowerCase()] ?? token.tag;
      if (linkTags.has(tag)) {
        const [reference, label] = splitLink(token.text);
        const target = resolve(reference);
        content.push(
          target
            ? { kind: "inline-tag", tag, text: label ?? reference, target }
            : { kind: "inline-tag", tag, text: label ?? reference },
        );
      } else {
        content.push({ kind: "inline-tag", tag, text: token.text });
      }
    } else {
      content.push({ kind: token.kind, text: token.text });
    }
  }
  for (const block of blockTags) {
    const first = block.content[0];
    // Names are on their tags' lines: `@inheritDoc` alone on its line has none.
    if (
      namedTags.has(block.tag) &&
      first?.kind === "text" &&
      !/^[^\S\n]*(?:\n|$)/u.test(first.text)
    ) {
      const { name, newText } = extractTagName(first.text);
      if (name !== "") block.name = name;
      first.text = newText;
    }
    block.content = trim(block.content);
    const isPlainText = block.content.every((part) => part.kind === "text");
    const text = block.content.map((part) => part.text).join("");
    if (
      (block.tag === "@defaultValue" || block.tag === "@default") &&
      isPlainText
    ) {
      block.content = [asCode(text)];
    } else if (
      block.tag === "@example" &&
      !block.content.some(
        (part) => part.kind === "code" && fencePattern.test(part.text),
      )
    ) {
      // A JSDoc caption is the example's first line, its title.
      const caption =
        /^\s*<caption>(?<title>[^\n]*?)<\/caption>\s*(?:\n|$)(?<code>.*)/su.exec(
          text,
        )?.groups;
      block.content = caption
        ? [
            { kind: "text", text: `${caption["title"]}\n` },
            asCode(caption["code"]),
          ]
        : [asCode(text)];
    }
  }
  return {
    summary: trim(summary),
    blockTags,
    modifierTags: [...modifiers],
  };
}

/**
 * @param text Code written without code fences.
 * @returns The code as a TypeScript code block.
 */
function asCode(text: string): Part {
  return { kind: "code", text: `\`\`\`ts\n${text}\n\`\`\`` };
}

/**
 * The text of the first paragraph of content: the summary shown in indexes.
 *
 * @param parts The content.
 * @returns The parts up to the first blank line.
 */
export function firstParagraph(parts: Part[]): Part[] {
  const result: Part[] = [];
  for (const part of parts) {
    const end = part.kind === "text" ? part.text.search(/\n\s*\n/u) : -1;
    if (end !== -1) {
      result.push({ kind: "text", text: part.text.slice(0, end) });
      break;
    }
    result.push(part);
  }
  return result;
}
