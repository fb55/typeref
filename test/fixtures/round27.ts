export declare class Base {
  constructor(seed: number);
}

export declare class Singleton extends Base {
  private constructor();
  static create(): Singleton;
}
