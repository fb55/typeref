/** @abstract */
export declare class AbstractTag {
  /** @abstract */
  foo(): void;
  /** @abstract */
  x: number;
}

export declare class Book {
  /** @readonly */
  get title(): string;
  set title(v: string);
}

export declare class HiddenAccessors {
  get x(): number;
  get y(): number;
  /** @hidden */
  set y(v: number);
  /** @hidden */
  get z(): number;
}

export declare function overloaded(a: string): string;
/** @hidden */
export declare function overloaded(a: number): number;

export interface Callable {
  (a: string): string;
  /** @hidden */
  (a: number): number;
}
