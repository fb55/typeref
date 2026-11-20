export interface Input {
  a: string;
}

export interface A {
  (x: Input): Input;
}

export declare class Accessors {
  /** Sets. */
  set value(v: number);
  /** Gets. */
  get value(): number;
}
