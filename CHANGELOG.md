# Changelog

## 0.1.0

The first release.

- Documents TypeScript libraries from their declaration files, with the
  sources found through declaration maps.
- Builds HTML sites with TypeDoc's URLs, or Markdown in typedoc-plugin-markdown's
  layout for static site generators.
- Documents the published packages of npm workspaces.
- Loads the pages into Astro content collections (`typeref/astro`).
- Gives categories of large classes pages of their own (`categoryPages`).
- Links to the docs of dependencies through the indexes their sites publish
  (`symbols.json`), and to MDN, the TypeScript handbook and Node.js's docs.
