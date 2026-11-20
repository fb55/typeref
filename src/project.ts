/**
 * What to document: the configuration, and the entry points of the packages
 * it names, from their `package.json` files.
 *
 * @module
 */
import {
  existsSync,
  globSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";

import { convert, type EntryPoint } from "./convert.ts";
import type { Project } from "./model.ts";
import { Program } from "./program.ts";
import { Sources } from "./source.ts";

export interface Config {
  /**
   * The entry points: subpaths of the package's `exports` (`"."`,
   * `"./decode"`), or paths of declaration files. By default, every subpath
   * that has types.
   */
  entryPoints?: string[];
  /** For monorepos: globs of the directories of the packages to document. */
  packages?: string[];
  /** The output directory. Defaults to `docs`. */
  out?: string;
  /** HTML pages, or Markdown for a static site generator. Defaults to `html`. */
  format?: "html" | "markdown";
  /** The project's name. Defaults to the package's name. */
  name?: string;
  /** The README to show on the index page, or `false` for none. */
  readme?: string | false;
  /**
   * Links to the docs of dependencies, by package name: their URL, or a
   * template with `{kind}` and `{name}`, for sites with TypeDoc's URLs.
   */
  links?: Record<string, string>;
  /** Markdown: the path the pages are served under, e.g. `/docs/api/`. */
  basePath?: string;
  /**
   * Classes, interfaces and enums with at least this many members get a page
   * for each category (`@category`) of their members. Off by default.
   */
  categoryPages?: number;
  /**
   * Whether to document declarations that are used by exported ones but not
   * exported themselves (such as the types of a constructor's options).
   */
  shouldDocumentUnexported?: boolean;
}

/**
 * Typed configuration, for `typeref.config.ts`.
 *
 * @param config The configuration.
 * @returns The configuration.
 */
export const defineConfig = (config: Config): Config => config;

interface PackageJson {
  name?: string;
  version?: string;
  exports?: unknown;
}

/**
 * @param directory A directory.
 * @returns The `package.json` in it.
 */
function readPackage(directory: string): PackageJson {
  return JSON.parse(
    readFileSync(join(directory, "package.json"), "utf8"),
  ) as PackageJson;
}

/**
 * @param directory A directory.
 * @returns The README in it, spelled any way (`Readme.md`) as GitHub and npm
 *   find it.
 */
function findReadme(directory: string): string | undefined {
  const names = readdirSync(directory);
  const name = names.includes("README.md")
    ? "README.md"
    : names.find((candidate) => candidate.toLowerCase() === "readme.md");
  return name === undefined ? undefined : join(directory, name);
}

/**
 * @param target A declaration or project to give a README.
 * @param path The README's path.
 * @param sources Where to find the README in its repository.
 */
function addReadme(
  target: { readme?: string; readmeUrl?: string },
  path: string | undefined,
  sources: Sources,
): void {
  if (path === undefined) return;
  target.readme = readFileSync(path, "utf8");
  // Repositories know files by their real paths.
  const url = sources.fileUrl(realpathSync(path));
  if (url !== undefined) target.readmeUrl = url;
}

/**
 * @param exports A package's `exports`.
 * @returns The subpaths it exports, without patterns.
 */
function subpaths(exports: unknown): string[] {
  if (typeof exports === "string" || Array.isArray(exports)) return ["."];
  if (exports === null || typeof exports !== "object") return [];
  const keys = Object.keys(exports);
  // An object of conditions exports the package itself.
  if (!keys.some((key) => key.startsWith("."))) return ["."];
  return keys.filter((key) => !key.includes("*") && !key.endsWith(".json"));
}

/**
 * Finds the entry points of a package.
 *
 * @param directory The package's directory.
 * @param program The program to resolve modules with.
 * @param requested The entry points to document, if not all.
 * @returns The entry points.
 */
function entryPoints(
  directory: string,
  program: Program,
  requested: string[] | undefined,
): EntryPoint[] {
  const json = readPackage(directory);
  const packageName = json.name ?? "";
  const exported = json.exports === undefined ? [] : subpaths(json.exports);
  const specifiers =
    requested ?? (json.exports === undefined ? ["."] : exported);
  const points = specifiers.flatMap((specifier): EntryPoint[] => {
    // Paths of declaration files, unless the package exports them as subpaths.
    if (
      !exported.includes(specifier) &&
      (!specifier.startsWith(".") || /\.d\.[mc]?ts$|\.tsx?$/u.test(specifier))
    ) {
      const file = resolve(directory, specifier);
      return [
        {
          name: relative(directory, file).replace(/(?:\.d)?\.[mc]?tsx?$/u, ""),
          file,
        },
      ];
    }
    const resolved = program.resolve(
      join(directory, "package.json"),
      json.exports === undefined
        ? specifier
        : `${packageName}${specifier.slice(1)}`,
    );
    // Subpaths found in `exports` may have no types (as scripts or styles),
    // which resolve to the files themselves.
    const file =
      resolved !== undefined && /\.[mc]?tsx?$/u.test(resolved)
        ? resolved
        : undefined;
    if (file === undefined) {
      if (requested === undefined) return [];
      throw new Error(
        `No declarations for "${specifier}" of ${packageName || directory}. Build the package first.`,
      );
    }
    return [
      {
        name:
          specifier === "."
            ? packageName
            : `${packageName}${specifier.slice(1)}`,
        file,
      },
    ];
  });
  if (points.length === 0) {
    throw new Error(
      `No declarations for ${packageName || directory}. Build the package first.`,
    );
  }
  return points;
}

/**
 * Documents the packages a configuration names.
 *
 * @param path The project's directory.
 * @param config The configuration.
 * @returns The project.
 */
export function loadProject(path: string, config: Config = {}): Project {
  const root = resolve(path);
  const program = new Program();
  const json = readPackage(root);
  const directories = config.packages
    ? config.packages
        .flatMap((pattern) => globSync(pattern, { cwd: root }))
        .map((directory) => resolve(root, directory))
        .filter((directory) => existsSync(join(directory, "package.json")))
        .toSorted()
    : [root];
  const entries = directories.flatMap((directory) =>
    entryPoints(directory, program, config.entryPoints).map((point) => ({
      point,
      directory,
    })),
  );
  const project = convert({
    name: config.name ?? json.name ?? "",
    ...(json.version !== undefined && { version: json.version }),
    entryPoints: entries.map(({ point }) => point),
    roots: directories,
    ...(config.links && { links: config.links }),
    ...(config.shouldDocumentUnexported && { shouldDocumentUnexported: true }),
  });
  const sources = new Sources();
  if (config.readme !== false) {
    addReadme(
      project,
      config.readme === undefined
        ? findReadme(root)
        : resolve(root, config.readme),
      sources,
    );
  }
  // Packages of a monorepo show their READMEs on their modules' pages.
  if (config.packages) {
    for (const [index, { directory }] of entries.entries()) {
      addReadme(project.modules[index], findReadme(directory), sources);
    }
  }
  return project;
}
