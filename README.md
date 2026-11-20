# typeref

API documentation for TypeScript libraries, read from their published
declaration files. typeref builds an HTML site with the URLs TypeDoc uses, so
links to existing docs keep working, or Markdown for a static site generator,
whose routes decide the URLs. (With `categoryPages`, members move to their
categories' pages; links to them land on their entries in the class's index.)

It reads `.d.ts` files rather than sources, so it works with any TypeScript
version that emits them, TypeScript 7 included. Declaration maps, if the
package has them, give each declaration's place in its source; pages link
there if the repository's `origin` remote is on GitHub or GitLab.

## Usage

typeref needs Node.js 22.18 or later. Build the package, so its declaration
files exist, then run typeref in its directory:

```sh
npm install --save-dev typeref
npx tsc && npx typeref
```

The site is written to `docs/`. typeref documents every subpath listed in the
package's `exports` that has types, with the README on the index page.
Subpaths matched by patterns (`"./features/*"`) are not found by themselves:
list them in `entryPoints`.

## Configuration

typeref reads its options from a `typeref` key in `package.json`:

```json
{
  "typeref": {
    "entryPoints": ["."],
    "links": { "domhandler": "https://domhandler.js.org/" }
  }
}
```

Or from `typeref.config.ts` (or `.js`, `.mjs`), or the file given as the
command's argument:

```ts
import { defineConfig } from "typeref";

export default defineConfig({ format: "markdown", basePath: "/docs/api/" });
```

| Option                     | Default                  | Description                                                                                                                                                |
| -------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entryPoints`              | every subpath with types | Subpaths of `exports` (`"."`, `"./decode"`), or paths of declaration files.                                                                                |
| `packages`                 | –                        | For monorepos: globs of the packages' directories (`["packages/*"]`). Each package's README is shown on its page.                                          |
| `out`                      | `docs`                   | The output directory. Files that typeref did not write there are never replaced.                                                                           |
| `format`                   | `html`                   | `html` for a site, `markdown` for a static site generator.                                                                                                 |
| `name`                     | the package's name       | The project's name.                                                                                                                                        |
| `readme`                   | `README.md`              | The README for the index page, or `false` for none.                                                                                                        |
| `links`                    | –                        | Docs of dependencies, by package name: a site's URL, or a template with `{kind}` and `{name}`.                                                             |
| `basePath`                 | –                        | Markdown: the path the pages are served under. Links are relative without it.                                                                              |
| `categoryPages`            | off                      | Classes, interfaces and enums with at least this many members, some with `@category`, get a page per category; members without one are on an `Other` page. |
| `shouldDocumentUnexported` | `false`                  | Also document declarations that exported ones use but that are not exported themselves, such as the types of options.                                      |

## Comments

typeref reads TSDoc and JSDoc comments as TypeDoc does: `@param`, `@returns`,
`@example`, `@see`, `@deprecated`, `@defaultValue`, `{@link}` (with TypeDoc's
declaration references), `@inheritDoc`, `@category` and `@categoryDescription`,
`@group` and `@groupDescription`, and `@module` for entry points. Declarations
tagged `@internal`, `@hidden`, `@ignore` or `@private` are not documented.

## Links to dependencies

Types from dependencies link to their docs if `links` lists them. HTML sites
built by typeref publish `symbols.json`, an index of their URLs: builds fetch
it, and link only to what it lists (Markdown builds publish none). The last index fetched is kept in
`node_modules/.cache/typeref`, for builds without a network. Links to sites
that do not publish one follow TypeDoc's URLs (`classes/Element.html`); a
template, such as `https://example.com/{kind}/{name}.html`, gives the URLs
itself.

Globals link to MDN or the TypeScript handbook, and imports from Node.js's
modules (`node:stream`) to Node.js's docs.

## Astro

`typeref/astro` loads the pages into an Astro content collection, rendered by
the site's Markdown pipeline, with no files written into the site:

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

`root` is the package's directory, relative to the site. Each entry's ID is its
page's path (`classes/cheerio`, `index` for the index), and its data has the
page's `title`, `kind`, `name`, `category` and `href`, for navigation:

```astro
---
// src/pages/docs/api/[...slug].astro
import { getCollection, render } from "astro:content";

export async function getStaticPaths() {
  const pages = await getCollection("api");
  return pages.map((page) => ({
    params: { slug: page.id === "index" ? undefined : page.id },
    props: { page },
  }));
}

const { Content } = await render(Astro.props.page);
---

<Content />
```

In development, pages update when the declaration files change: run the
compiler in watch mode next to `astro dev`.

## API

```ts
import { build, loadProject, renderMarkdown } from "typeref";

// What the command does.
await build(process.cwd(), { format: "markdown" });

// The documentation as JSON, and its pages.
const project = loadProject(process.cwd());
const files = renderMarkdown(project, { basePath: "/docs/api/" });
```

## License

BSD-2-Clause
