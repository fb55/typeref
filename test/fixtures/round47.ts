/**
 * Made by factories.
 *
 * @hideconstructor
 */
export declare class Hidden {
  constructor();
}

export declare class Shown extends Hidden {
  constructor(seed: number);
}

/** @enum */
export const Status = Object.freeze({ Active: "active" } as const);

/** Uses {@link Status.Active}. */
export declare function use(): void;

/** @enum */
export const Phase = Object.freeze({ Ready: "ready", Busy: "busy" } as const);
