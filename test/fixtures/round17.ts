export interface Contract {
  /** Runs the contract. */
  run(): void;
}

export declare class Worker implements Contract {
  run(): void;
}

export declare class Child extends Worker {}

export declare class Parent {
  /** Creates a parent. */
  constructor(name: string);
}

export declare class Kid extends Parent {
  constructor(count: number);
}

export declare class Reader {
  /**
   * Reads.
   *
   * @param input - The input.
   */
  read(input: string): void;
}

export declare class Renamed extends Reader {
  read(text: string): void;
}
