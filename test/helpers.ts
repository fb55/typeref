import { join } from "node:path";

import { inject } from "vitest";

import { convert } from "../src/convert.ts";
import type { Declaration, Project } from "../src/model.ts";

/**
 * Documents fixtures, as entry points of one package.
 *
 * @param names The fixtures' names.
 * @param options More options for the conversion.
 * @returns The project.
 */
export function fixture(
  names: string[],
  options: {
    links?: Record<string, string>;
    shouldDocumentUnexported?: boolean;
  } = {},
): Project {
  const directory = inject("fixtures");
  return convert({
    name: "test",
    entryPoints: names.map((name) => ({
      name,
      file: join(directory, `${name}.d.ts`),
    })),
    roots: [directory],
    ...options,
  });
}

/**
 * Finds a declaration by its dotted path, from the project's top level.
 *
 * @param project The project.
 * @param path The path, e.g. `Base.method`.
 * @returns The declaration.
 */
export function query(project: Project, path: string): Declaration {
  let children: Declaration[] | undefined =
    project.modules.length === 1
      ? project.modules[0].children
      : project.modules;
  let found: Declaration | undefined;
  for (const name of path.split(".")) {
    found = children?.find((child) => child.name === name);
    if (!found) throw new Error(`${path}: no ${name}`);
    ({ children } = found);
  }
  return found!;
}
