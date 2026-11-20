export namespace Scoping {
  export type abc = 1;
  /** {@link abc} */
  export interface Bar {
    /** {@link abc} */
    abc: 3;
  }
}

export namespace URLS {}
export const A = 1;
export namespace Globals {
  /** {@link URLS!} {@link !A} {@link A} */
  export const A = 2;
}

export declare class Test {
  method(): void;
}
export { Test as Test2 };
/** {@link Test2.method} */
export const check = 123;

export type Alias = {
  /** {@link Alias.other} */
  readonly default: string;
  readonly other: string;
};

/** {@link Nested.prop.nested.here} */
export interface Nested {
  prop: { nested: { here: true } };
}
