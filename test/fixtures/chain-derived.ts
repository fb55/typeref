import { Accessors, type A } from "./chain-base.ts";

export * from "./chain-base.ts";

export interface B extends A {
  (x: number): number;
}

export interface C extends B {}

export declare class Override extends Accessors {
  set value(v: number);
  get value(): number;
}

declare class Internal {}

export declare const internal: Internal;
