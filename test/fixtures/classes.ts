/** Base docs. */
export abstract class Base<T> {
  /** The value. */
  value: T | undefined;
  protected guarded = 1;
  private hidden = 2;
  #secret = 3;
  constructor(seed: number) {
    void seed;
    void this.hidden;
    void this.#secret;
  }
  static create(): void {}
  /** Overridable. */
  method(): void {}
  abstract run(): void;
  get size(): number {
    return 0;
  }
  set size(_: number) {}
}

/** Runner docs. */
export interface Runner {
  /** Runs. */
  run(): void;
}

export class Derived extends Base<string> implements Runner {
  override method(): void {}
  run(): void {}
}

export interface Indexed {
  [key: string]: number;
  (input: string): number;
  new (input: string): Indexed;
}
