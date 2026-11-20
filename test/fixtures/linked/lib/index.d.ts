import type { Dep, Hidden, Parser, Tools } from "dep";
export type { Dep } from "dep";
/** Makes a {@link Dep}. */
export declare function make(): Dep;
export declare function use(
  tool: Tools.Tool,
  hidden: Hidden,
  parse: typeof Parser.parse,
): void;
