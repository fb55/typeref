/**
 * Summary
 * @remarks Remarks
 * @typeParam T - Type parameter
 */
export interface Source<T> {
  /** Property description */
  property: T;
  /**
   * Method description
   * @param arg - arg description
   */
  someMethod(arg: number): T;
}

/** @inheritDoc Source */
export interface Target<T> {
  /** @inheritDoc Source.property */
  property: T;
  /**
   * @inheritDoc Source.someMethod
   * @example This should still be present
   * ```ts
   * someMethod(123)
   * ```
   */
  someMethod(arg: number): T;
}

/**
 * Source
 * @remarks Remarks
 */
export const source = 123;

/**
 * Target summary
 * @inheritDoc source
 * @remarks Target remarks
 */
export const target = 123;

export declare class SigRef {
  /** A */
  method(): void;
  /** B */
  method(x: string): string;
  /** C */
  prop: number;
  /** {@inheritDoc method} */
  test1(): void;
  /** {@inheritDoc method} */
  test1(x: string): string;
  /** {@inheritDoc prop} */
  test2(): void;
}

export declare class Accessors {
  /** getter */
  get x(): number;
  /** setter */
  set x(value: number);
  /** {@inheritDoc Accessors.x} */
  y: number;
}

/** Foo */
export class Foo {
  /**
   * Foo.member
   * @param x - Foo.member.x
   */
  member(x: number): void {
    void x;
  }
}

/** @inheritdoc */
export class Bar implements Foo {
  /** @inheritdoc */
  member(x: number): void {
    void x;
  }
}

export class Baz extends Foo {
  /** @inheritdoc */
  override member(x: number): void {
    void x;
  }
}
