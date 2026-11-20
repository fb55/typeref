export enum Color {
  Red = "red",
  Green = 1,
}

/** @enum */
export const Like = { a: "a", b: 2 } as const;

export const NotLike = { a: "a" } as const;

/** @hideconstructor */
export class StaticOnly {
  static foo(): void {}
}
