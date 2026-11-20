export interface Callable {
  (value: string): number;
}

export interface Left extends Callable {}

export interface Right extends Callable {}

export interface Both extends Left, Right {}

export declare class Base {
  /** Gets. */
  get value(): number;
  /** Sets. */
  set value(v: number);
}

export declare class Other {
  /** @inheritDoc Base#value */
  set value(v: number);
  /** @inheritDoc Base#value */
  get value(): number;
}
