/** The base's helper. */
export interface Helper {}

export declare class Base {
  /** Uses {@link Helper}. */
  m(): void;
}

export interface WithConstructor {
  constructor: Function;
}
