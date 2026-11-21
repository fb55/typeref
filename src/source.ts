/**
 * Where declarations come from: declaration maps lead from a `.d.ts` line to
 * the source file and line, and the repository to a link to that line.
 *
 * @module
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { decodedMappings, TraceMap } from "@jridgewell/trace-mapping";

/** A repository on GitHub or GitLab, and the commit to link to. */
interface Repository {
  root: string;
  url: string;
  revision: string;
}

/** Finds sources through declaration maps, and links to them. */
export class Sources {
  private readonly maps = new Map<string, TraceMap | undefined>();
  private readonly repositories = new Map<string, Repository | undefined>();

  /**
   * @param declarationFile The `.d.ts` file.
   * @returns Its declaration map, if it has one.
   */
  private getMap(declarationFile: string): TraceMap | undefined {
    if (this.maps.has(declarationFile)) return this.maps.get(declarationFile);
    const path = `${declarationFile}.map`;
    // Sources resolve against the map's URL, and are file URLs then.
    const map = existsSync(path)
      ? new TraceMap(readFileSync(path, "utf8"), pathToFileURL(path).href)
      : undefined;
    this.maps.set(declarationFile, map);
    return map;
  }

  /**
   * Maps a position in a declaration file to its source.
   *
   * @param file The declaration file.
   * @param line The line, starting at 0.
   * @param column The column, starting at 0.
   * @param lastLine The declaration's last line, to look for a mapping until.
   * @returns The source file and line (starting at 1); the declaration file's
   *   when it has no map.
   */
  locate(
    file: string,
    line: number,
    column: number,
    lastLine: number = line,
  ): { file: string; line: number } {
    const map = this.getMap(file);
    // Some names, such as `constructor`, are not mapped: the next mapped line.
    if (map !== undefined) {
      for (let index = line; index <= lastLine; index++) {
        const segments = decodedMappings(map)[index]?.filter(
          (segment) => segment.length !== 1,
        );
        if (!segments?.length) continue;
        let best = segments[0];
        for (const segment of segments) {
          if (index === line && segment[0] > column) break;
          best = segment;
          if (index !== line) break;
        }
        // Sources not on disk (`https:` roots) leave the declaration's place.
        const source = map.resolvedSources[best[1]];
        if (!source.startsWith("file:")) break;
        return { file: fileURLToPath(source), line: best[2] + 1 };
      }
    }
    return { file, line: line + 1 };
  }

  /**
   * @param file A source file.
   * @param line Its line, starting at 1.
   * @returns A link to the line in the file's repository, at the checked-out
   *   commit; `undefined` outside of repositories on GitHub or GitLab.
   */
  url(file: string, line: number): string | undefined {
    const url = this.fileUrl(file);
    return url === undefined ? undefined : `${url}#L${line}`;
  }

  /**
   * @param file A file.
   * @returns A link to the file in its repository, at the checked-out
   *   commit; `undefined` outside of repositories on GitHub or GitLab, and
   *   for installed dependencies.
   */
  fileUrl(file: string): string | undefined {
    // Installed dependencies are not in their dependents' repositories.
    if (file.split(/[/\\]/u).includes("node_modules")) return undefined;
    const repository = this.getRepository(dirname(file));
    if (!repository) return undefined;
    const path = relative(repository.root, file)
      .split(/[/\\]/u)
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    const blob = repository.url.startsWith("https://gitlab.com/")
      ? "-/blob"
      : "blob";
    return `${repository.url}/${blob}/${repository.revision}/${path}`;
  }

  private getRepository(directory: string): Repository | undefined {
    if (this.repositories.has(directory)) {
      return this.repositories.get(directory);
    }
    const git = (...args: string[]): string =>
      spawnSync("git", args, {
        cwd: directory,
        encoding: "utf8",
      }).stdout?.trim() ?? "";
    const root = git("rev-parse", "--show-toplevel");
    let repository: Repository | undefined;
    const remote = root && git("remote", "get-url", "origin");
    // `git@github.com:user/repo.git` and `https://github.com/user/repo.git`.
    const groups =
      /(?<host>github\.com|gitlab\.com)[:/](?<path>.+?)(?:\.git)?$/u.exec(
        remote,
      )?.groups;
    if (groups) {
      repository = {
        root,
        url: `https://${groups["host"]}/${groups["path"]}`,
        revision: git("rev-parse", "HEAD"),
      };
    }
    this.repositories.set(directory, repository);
    return repository;
  }
}
