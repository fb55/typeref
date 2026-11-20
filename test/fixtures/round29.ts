export class Base {
  /** Reads. */
  read(): void {}
}

type Constructor = new (...args: any[]) => object;

export function withReset<T extends Constructor>(Super: T) {
  return class extends Super {
    /** Resets. */
    reset(): void {}
  };
}

export class Client extends withReset(Base) {}

export function tagged(): new (...args: any[]) => { tag: string } {
  return class {
    tag = "";
  };
}

export class Tagged extends tagged() {}

export declare class Factory {
  constructor(seed: number);
  static create(): Factory;
  value: number;
}

export declare class Merged {}
export interface Merged extends Factory {}

export declare class SubMerged extends Merged {}

export declare class FactoryResult {
  constructor(value: string);
  static helper(): void;
  result: number;
}

declare const Produced: new (count: number) => FactoryResult;

export declare class Product extends Produced {}

export declare class Configured {
  static configure(): void;
  read(): void;
}

declare const Mixed: (new () => Configured) & typeof Configured;

export declare class MixedClient extends Mixed {}

export function withFactory<T extends Constructor>(Super: T) {
  return class extends Super {
    /** Creates. */
    static create(): void {}
    /** Builds. */
    build(): void {}
  };
}

export class Item extends withFactory(Base) {}
