import * as Api from "./heritage-api.ts";

type Methods = typeof Api;

export declare class Wrapped {
  length: number;
}

export interface Wrapped extends Methods {}
