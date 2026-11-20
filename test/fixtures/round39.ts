export interface Contract {
  /** Runs by contract. */
  run(): void;
}

export interface Extra {
  /** Runs extra. */
  run(): void;
}

export declare class Parser implements Contract {
  run(): void;
}
export interface Parser extends Extra {}
