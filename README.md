# typeref

API docs for TypeScript libraries, built from the `.d.ts` files you publish.
A drop-in replacement for TypeDoc that works with TypeScript 7.

```sh
npm install --save-dev typeref
npx tsc && npx typeref   # writes the site to docs/
```

## Why typeref

TypeDoc is built on the TypeScript compiler's API and does not support
TypeScript 7, so projects documented with TypeDoc cannot upgrade. typeref
reads declaration files instead, which every TypeScript version emits.

- **Keeps your links.** Pages have TypeDoc's URLs, and comments use TypeDoc's
  tags. Switching changes your build script, not your docs.
- **Documents what users get.** The declaration files are exactly what your
  package's users import, so the docs cannot drift from the published API.
- **Fast.** typeref parses declarations with
  [oxc](https://oxc.rs/) and needs no type checker: on
  [parse5](https://github.com/inikulin/parse5), it builds the site 5× faster
  than TypeDoc, with a third of the memory.
- **Fits static sites.** It writes Markdown for any static site generator, and
  loads pages straight into [Astro](https://astro.build/) content collections.
- **Links across projects.** Sites built by typeref publish an index of their
  pages, so types from your dependencies link to their docs without
  hand-written mappings.
- **Splits large classes.** Classes with many methods get a page per
  `@category`, so pages stay readable and searchable.

## Usage

typeref needs Node.js 22.18 or later. Build your package first: typeref reads
its declaration files, and declaration maps (if you emit them) to link each
declaration to its source, when your `origin` remote is on GitHub or GitLab.

typeref documents every subpath in `package.json`'s `exports` that has types,
with your README on the index page. Options go under a `typeref` key in
`package.json`:

```json
{
  "typeref": {
    "entryPoints": ["."],
    "links": { "domhandler": "https://domhandler.js.org/" }
  }
}
```

Or in `typeref.config.ts` (or `.js`, `.mjs`), with `defineConfig` from
`typeref` for types.

| Option                     | Default                  | Description                                                                                                             |
| -------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| `entryPoints`              | every subpath with types | Subpaths of `exports` (`"."`, `"./decode"`), or paths of declaration files. List subpaths matched by `"./*"` here.      |
| `packages`                 | –                        | For monorepos: globs of the packages' directories (`["packages/*"]`).                                                   |
| `out`                      | `docs`                   | The output directory. Files typeref did not write there are never replaced.                                             |
| `format`                   | `html`                   | `html` for a site, `markdown` for a static site generator.                                                              |
| `name`                     | the package's name       | The project's name.                                                                                                     |
| `readme`                   | `README.md`              | The README for the index page, or `false` for none.                                                                     |
| `links`                    | –                        | Docs of dependencies, by package name: a site's URL, or a template with `{kind}` and `{name}`.                          |
| `basePath`                 | –                        | Markdown: the path the pages are served under. Links are relative without it.                                           |
| `categoryPages`            | off                      | Classes, interfaces and enums with at least this many members get a page per `@category` (the rest on an `Other` page). |
| `shouldDocumentUnexported` | `false`                  | Also document types that exported declarations use but do not export, such as the types of options.                     |

### Comments

typeref reads TSDoc and JSDoc as TypeDoc does: `@param`, `@returns`,
`@example`, `@see`, `@deprecated`, `@defaultValue`, `{@link}` with TypeDoc's
declaration references, `@inheritDoc`, `@category`, `@group` and their
descriptions, and `@module`. Declarations tagged `@internal`, `@hidden`,
`@ignore` or `@private` are left out.

### Links to dependencies

Types from packages in `links` link to their docs. HTML sites built by typeref
publish `symbols.json`, an index of their pages; typeref fetches it and links
only to what it lists, keeping the last copy in `node_modules/.cache/typeref`
for offline builds. Other sites are linked by TypeDoc's URLs, or by your
template. Globals link to MDN and the TypeScript handbook, and Node.js's
modules (`node:stream`) to Node.js's docs.

### Astro

`typeref/astro` loads the pages into a content collection, rendered by your
site's Markdown setup, plugins included:

```ts
// src/content.config.ts
import { defineCollection } from "astro:content";
import { typerefLoader } from "typeref/astro";

export const collections = {
  api: defineCollection({
    loader: typerefLoader({ root: "..", basePath: "/docs/api/" }),
  }),
};
```

Each entry's ID is its page's path (`classes/cheerio`, or `index`), and its
data has the page's `title`, `kind`, `name`, `category` and `href` for your
navigation. Render entries with `render(entry)` in a `[...slug].astro` route.
In development, pages update as the declaration files change.

### API

```ts
import { build, loadProject, renderMarkdown } from "typeref";

await build(process.cwd(), { format: "markdown" }); // What the command does.
const project = loadProject(process.cwd()); // The docs as JSON.
const files = renderMarkdown(project, { basePath: "/docs/api/" });
```

## Where the ideas come from

- [TypeDoc](https://typedoc.org/): URLs, comment tags and declaration
  references, so existing sites and comments carry over.
- [typedoc-plugin-markdown](https://typedoc-plugin-markdown.org/): the layout
  of the Markdown pages.
- [API Extractor](https://api-extractor.com/): declaration files as the
  record of a package's API.
- [Sphinx's intersphinx](https://www.sphinx-doc.org/en/master/usage/extensions/intersphinx.html):
  sites publishing an index of their pages for others to link to.

typeref was written for the docs of [cheerio](https://cheerio.js.org/),
[parse5](https://parse5.js.org/), [domhandler](https://github.com/fb55/domhandler),
[domutils](https://github.com/fb55/domutils) and
[entities](https://github.com/fb55/entities), whose TypeDoc builds stood
between them and TypeScript 7.

## License

BSD-2-Clause
