export interface A {
  a?: string;
}
export interface B extends A {}
export interface B extends A {
  b?: string;
}
export interface D extends Record<"a", 1> {}
export interface D extends Record<"a", 1>, Record<"b", 1> {}

/** @hidden */
export interface Hidden extends A {}
export interface NotHidden extends Hidden {}
export declare class NotHiddenImpl implements Hidden {}

export declare const Obj: {
  b: string;
  /** @hidden */
  c: string;
  a: string;
};

/** @typeParam T - class docs */
export declare class Generic<T> {
  /** @typeParam T - ctor docs */
  constructor();
  constructor(x: T);
}
