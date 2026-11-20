export declare function documented(/** Doc of a. */ a: number, b: string): void;

export declare function action(
  /** Param comment @param data - Data */ callback: (data: {}) => void,
): void;

/** @param e - The event. */
export type Handler = (e: Event) => void;

export declare class C {
  constructor(/** @hidden */ x: number, y: boolean);
  method(/** @hidden */ internalHelper?: string): void;
}

/**
 * @param a - Hidden.
 * @param options - The options.
 */
export declare function destructured(
  /** @hidden */ a: number,
  { x }: { x: number },
): void;
