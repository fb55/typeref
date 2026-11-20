export declare class Base {
  /** @hidden */
  run(): void;
  /** Runs with a count. */
  run(count: number): void;
}

export declare class Child extends Base {
  run(count?: number): void;
}

/** @hidden */
export declare function secret(): void;

export { secret as alias };
