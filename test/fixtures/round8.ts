export type Dictionary = {
  /** @hidden */
  [key: string]: unknown;
};

export declare class Parser {
  static parse(text: string): Parser;
}

export declare const parse: typeof Parser.parse;

export namespace A {
  /** A's options. */
  export interface Options {}
  export class Base {
    /** Uses {@link Options}. */
    run(): void {}
  }
}

export namespace B {
  /** B's options. */
  export interface Options {}
  export class Child extends A.Base {}
}
