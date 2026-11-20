# typeref

typeref generates API docs for TypeScript libraries from the `.d.ts` files you
publish, as an HTML site or as Markdown. It works with TypeScript 7, and
follows TypeDoc's URLs and comment tags.

Requires Node.js 22.18 or later.

```sh
npm install --save-dev typeref
npx typeref  # after your build emits .d.ts files; writes docs/
```

## Why typeref

TypeDoc's dependency on the TypeScript compiler API blocked the move to
TypeScript 7 for [cheerio](https://cheerio.js.org/),
[parse5](https://parse5.js.org/) and related libraries. typeref parses their
emitted declarations with [oxc](https://oxc.rs/), so generating docs needs no
TypeScript type checker.

- **Keep your TypeDoc links and comments.** HTML pages use TypeDoc's URLs,
  and comments its tags (`@param`, `@returns`, `{@link}`); keep doc comments
  in your emitted `.d.ts` files (no `removeComments`).
- **Monorepos need no setup.** From a private npm workspace root, typeref
  documents the packages that are not private and have declarations.
- **Fits static sites.** Markdown for any static site generator, or pages
  loaded straight into [Astro](https://astro.build/) content collections.
- **Links to your dependencies' docs.** Set a dependency's docs URL once in
  `links`; for HTML sites built by typeref, their `symbols.json` supplies each
  page's URL.
- **Optionally splits large classes** into a page per `@category`.

## Where the ideas come from

- [TypeDoc](https://typedoc.org/): the HTML URLs, comment tags and
  declaration references. TypeDoc's plugins and themes do not work with
  typeref.
- [typedoc-plugin-markdown](https://typedoc-plugin-markdown.org/): the layout
  of the Markdown pages.
- [API Extractor](https://api-extractor.com/): declaration files as the
  record of a package's API.
- [Sphinx's intersphinx](https://www.sphinx-doc.org/en/master/usage/extensions/intersphinx.html):
  sites publishing an index of their pages for others to link to.

## Usage

typeref documents your package's explicit `exports` that have declarations,
with your README on the index page. For wildcard exports (`"./*"`), list the
subpaths in `entryPoints`. With declaration maps, pages link each declaration
to its source, when your `origin` remote is on GitHub or GitLab.

Options go under a `typeref` key in `package.json`, or in `typeref.config.ts`
(with `defineConfig` from `typeref`):

```json
{
  "typeref": {
    "entryPoints": ["."],
    "links": { "domhandler": "https://domhandler.js.org/" }
  }
}
```

| Option                     | Default                      | Description                                                                                                             |
| -------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `entryPoints`              | auto-discovered exports      | Subpaths of `exports` (`"."`, `"./decode"`), or paths of declaration files.                                             |
| `packages`                 | workspaces of a private root | For monorepos: globs of the packages' directories (`["packages/*"]`).                                                   |
| `out`                      | `docs`                       | The output directory. The build stops if a file it would write there came from another tool, such as TypeDoc.           |
| `format`                   | `html`                       | `html` for a site, `markdown` for a static site generator.                                                              |
| `name`                     | the package's name           | The project's name.                                                                                                     |
| `readme`                   | `README.md`                  | The README for the index page, or `false` for none.                                                                     |
| `links`                    | –                            | Docs of dependencies, by package name: a site's URL, or a template with `{kind}` and `{name}`.                          |
| `basePath`                 | –                            | Markdown: the path the pages are served under. Links are relative without it.                                           |
| `categoryPages`            | off                          | Classes, interfaces and enums with at least this many members get a page per `@category` (the rest on an `Other` page). |
| `shouldDocumentUnexported` | `false`                      | Also document types that exported declarations use but do not export, such as the types of options.                     |

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

await build(process.cwd(), { format: "markdown" }); // Writes Markdown to docs/.
const project = loadProject(process.cwd()); // The docs as JSON.
const files = renderMarkdown(project, { basePath: "/docs/api/" });
```

## License

BSD-2-Clause
