import * as Int from "./typeof-int.ts";

type Int = typeof Int;

export interface FileInt extends Int {}

export const value = 1;
export namespace Inner {
  export type value = string;
  export type Query = typeof value;
}
