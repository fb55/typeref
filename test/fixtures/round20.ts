/** @enum */
export const Mode = {
  Read: "read",
} as const;

/** Opens with {@link Mode.Read}. */
export declare function open(): void;
