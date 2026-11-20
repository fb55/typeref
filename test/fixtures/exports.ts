import type { Other } from "./exports-other.ts";

export * from "./exports-other.ts";
export * as other from "./exports-other.ts";
export { renamed as alias } from "./exports-other.ts";

/** A function. */
export function fn(): Other {
  return { a: "" };
}

export default fn;

export const value = 1;
