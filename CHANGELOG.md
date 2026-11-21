# Changelog

## Unreleased

- A redesigned HTML theme that works on every screen: the navigation is a
  menu on phones, and "On this page" stays in reach as you read. Signatures
  are larger and wrap with a hanging indent, examples scroll instead of
  breaking words, and parameters sit over their descriptions.
- Small touches of motion and color: pages change in place where browsers
  support it, the member a link lands on glows briefly, and kinds are marked
  in the colors of their names in code. All movement respects reduced motion.
- Search moves between results with the arrow keys.
- Fixes: type parameters' constraints keep their closing `>`
  (`R extends ArrayLike<T>`), summaries no longer gain spaces around inline
  code, and members inherited from dependencies no longer link to
  `node_modules` paths that do not exist in the repository.

## 0.1.0

The first release.

- Documents TypeScript libraries from their declaration files, with the
  sources found through declaration maps.
- Builds HTML sites with TypeDoc's URLs, or Markdown in typedoc-plugin-markdown's
  layout for static site generators.
- From a private npm workspace root, documents its non-private packages with
  declarations.
- Loads the pages into Astro content collections (`typeref/astro`).
- Gives categories of large classes pages of their own (`categoryPages`).
- Links to the docs of dependencies through the indexes their sites publish
  (`symbols.json`), and to MDN, the TypeScript handbook and Node.js's docs.
