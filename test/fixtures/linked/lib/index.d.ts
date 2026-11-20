import type { Dep, Hidden, Tools } from "dep";
export type { Dep } from "dep";
/** Makes a {@link Dep}. */
export declare function make(): Dep;
export declare function use(tool: Tools.Tool, hidden: Hidden): void;
