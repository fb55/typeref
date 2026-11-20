export * as helpers from "./round10-helpers.ts";

export interface Factory {
  /** @hidden */
  (): Factory;
  name: string;
}

export { Factory as OtherFactory };

/** Uses {@link helpers.helper}. */
export declare const linked: number;
