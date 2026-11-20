export interface Keyed {
  [key: string]: unknown;
  TSIndexSignature: string;
}

export interface Computed {
  ["foo"]: number;
}

export interface Plain extends Computed {
  foo: number;
}

export interface Base {
  /** The value. */
  value: unknown;
}

export interface Mid extends Base {
  value: string;
}

export interface Leaf extends Mid {
  value: "a";
}

export enum Merged {
  A = 1,
}
export enum Merged {
  B = 2,
}

/** @hidden */
export declare const secret: number;

export { secret as alias };

export declare const query: typeof import("./exports-other.ts").renamed;
