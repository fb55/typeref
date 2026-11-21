export declare function id(): `item-${number}`;

export type Keys = { "a|b": string };

/**
 * Loads.
 *
 * @param a - A.
 * @returns The count.
 * @see https://example.com
 */
export declare const load: (a: string) => number;

/**
 * @categoryDescription A
 * The first category.
 */
export interface Multi {
  /**
   * In two categories.
   *
   * @category A
   * @category B
   */
  both: string;
  /** @category B */
  second: string;
  /**
   * @category A
   * @category Index
   */
  listed: string;
  plain: number;
}

export type Hooks = { onError(error: Error): void };

export type Codec = {
  decode(value: string): string;
  decode(value: Uint8Array): Uint8Array;
};

export interface Events {
  "on-error"?(): void;
}

export interface Layout {
  main(): void;
}

export interface Factory {
  "new"(name: string): string;
}

export interface Dictionary {
  /**
   * Values by name.
   *
   * @returns The value.
   * @example
   * dictionary.a;
   */
  [name: string]: number;
}

export declare abstract class Cache {
  /** @returns Zero when empty. */
  get size(): number;
  /** @param value A nonnegative number. */
  set size(value: number);
  protected abstract refresh(): void;
  static get count(): number;
  /** @category Settings */
  get mode(): string;
}

export type Settings = {
  get volume(): number;
  set volume(value: number | string);
};

export type Lookup = {
  /** Values by key. */
  [key: string]: number;
};

export type Config = {
  /** Whether to be strict. */
  strict: boolean;
};

/** Configures {@link Config.strict}. */
export declare function configure(): void;

export type Loader = {
  /**
   * Loads by ID.
   *
   * @param id The ID.
   */
  (id: string): number;
  clear(): void;
};

export interface Handlers {
  /**
   * Handles values.
   *
   * @param value - The value.
   * @returns Whether it was handled.
   */
  handle: (value: string) => boolean;
}

/**
 * The first of a list.
 *
 * @returns The first item.
 */
export declare function first<T, R extends ArrayLike<T>>(list: R): T;

/** Accepts a `function`. */
export declare function accepts(callback: () => void): void;
