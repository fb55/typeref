import { Base, type WithConstructor } from "./undocumented-base.ts";

export type { Helper as BaseHelper } from "./undocumented-base.ts";

/** The derived module's helper. */
export interface Helper {}

export declare class Derived extends Base {
  m(): void;
}

export interface FromInterface extends WithConstructor {}

export interface Indexed {
  /** @hidden */
  [key: string]: unknown;
}
