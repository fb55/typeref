import { Base as Linked } from "./overrides-base.ts";

/** The derived module's helper. */
export interface Helper {}

export declare class Base {
  constructor(a: number);
  static create(): Base;
  value: number;
}

export interface Specialized extends Base {}

export interface A {
  f(): void;
}

export interface B {
  f(): void;
}

export interface Both extends A, B {}

export declare class Derived extends Linked {
  m(): void;
}

export interface Own extends A, B {
  f(): void;
}
