/**
 * Formats.
 *
 * @typeParam T - The input.
 * @param value - What to format.
 * @param options - How.
 * @returns The text.
 */
export function format<T>(value: T, { pad }: { pad?: number } = {}): string {
  return String(value).padStart(pad ?? 0);
}

/** See {@link Target.member}, {@link Target | the target}, {@link Map} and {@link https://example.com}. */
export const linked = 1;

export class Target {
  member = 1;
  /** Links to {@link member}. */
  other = 2;
}

/** @hidden */
export const hidden = 1;

/** First. */
export function over(a: string): string;
/** Second. */
export function over(a: number): number;
export function over(a: unknown): unknown {
  return a;
}
