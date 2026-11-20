export declare const values: {
  readonly "a-b": 1;
  2: "two";
  readonly c?: string;
  single: 0;
};
export type Keys = keyof typeof values;
export type Mapped<T> = {
  readonly [K in keyof T as `get${Capitalize<K & string>}`]-?: () => T[K];
};
export type Optional<T> = { -readonly [K in keyof T]+?: T[K] };
export type Cond<T> = T extends readonly (infer U extends string)[] ? U : never;
export type Rest<T> = T extends [infer H extends string, ...infer R]
  ? [H, R]
  : never;
export type Template = `a${string}b${number}`;
export type Tuple = readonly [
  first: string,
  second?: number,
  ...rest: boolean[],
];
export type Unnamed = [string, number?, ...boolean[]];
export type Ctor = abstract new <T>(value: T) => T;
export declare const symbol: unique symbol;
export type Predicate = (value: unknown) => value is string;
export type Asserts = (value: unknown) => asserts value is string;
export type AssertsOnly = (value: unknown) => asserts value;
export declare function generic<const T extends readonly unknown[] = []>(
  ...items: T
): T;
export interface Variance<in out T> {
  value: T;
}
export type Accessed = Variance<string>["value"];
export type Numbers = -1 | 1n | -1n | 0.5;
export type Generic = <T>(x: T) => T;
export type Parenthesized = (string | number)[];
export type FunctionUnion = (() => void) | string;
export type ObjectMembers = {
  m<T>(x: T): T;
  new (x: string): ObjectMembers;
  readonly [k: string]: unknown;
  "q-q"?: number;
  get x(): number;
  set x(v: number);
  (call: boolean): void;
};
export type Intrinsic = Uppercase<"a">;
export type ImportedType = import("./exports-other.ts").Other;
export declare let mutable: string;
export declare var old: number;
export declare const literal = "x";
export declare const template: `x-${string}`;
export enum Flags {
  A = "a",
  B = 1 << 2,
  "c-d" = 3,
}
export declare const enum Const {
  X,
}
export declare namespace Space {
  type Inner = string;
  const value: Inner;
}
export declare class Members<T = string> {
  static readonly s: number;
  protected p?: string;
  #secret: number;
  accessor auto: number;
  [key: number]: unknown;
  static [key: string]: unknown;
  m?(): void;
  get g(): number;
  set g(value: number);
  "quoted-name": string;
  123: number;
  [Symbol.iterator](): Iterator<T>;
  constructor(value?: T);
  self(): this;
  protected static create<U>(this: new () => U): U;
}
export declare abstract class Abstract {
  abstract run(): void;
  protected abstract readonly state: string;
}
export declare function withThis(this: Window, a: string): void;
export declare function defaults(a?: string, b?: number): void;
export type Keyword = object | symbol | bigint | never | unknown | any;
export type Nested = { a: { b: { c: string } } };
export type Arrays = readonly string[][];
export type Indexed = Members["p"];
export declare const key: unique symbol;
export interface More<T extends object = {}> extends Variance<T>, Space.Shape {
  [key]: string;
  readonly getter: number;
  get only(): number;
  overloaded(a: string): void;
  overloaded(a: number): void;
  isMore(): this is More<T>;
  check(value: unknown): asserts value is T;
  optional?(): void;
  callback: (error: Error | null, ...values: readonly string[]) => void;
}
export declare namespace Space {
  interface Shape {
    kind: string;
  }
}
export type Precedence<T> = (keyof T)[] | (() => T)[] | (A | B)["x"];
interface A {
  x: 1;
}
interface B {
  x: 2;
}
export type Elements<T extends unknown[]> = T[number];
export type Instantiated = typeof generic<[]>;
export type Qualified = typeof Space.value;
export type Deep = `a${`b${string}`}`;
export type Overloads = {
  m(a: string): void;
  m(a: number): void;
  o?(): void;
};
export declare function constructs(
  factory: abstract new (...args: never[]) => object,
): void;
export declare function defaulted<T = string, U extends T = T>(value: U): T;
export declare const globals: typeof globalThis;
export declare class Base<T> {
  value?: T;
}
export declare class Derived extends Base<string> implements Space.Shape, A {
  [key]: string;
  getter: number;
  get only(): number;
  overloaded(a: string): void;
  overloaded(a: number): void;
  isMore(): this is More;
  check(value: unknown): asserts value is object;
  callback: () => void;
  kind: string;
  x: 1;
}
