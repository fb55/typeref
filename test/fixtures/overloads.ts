/** First */
export function foo(f: true): string;
export function foo(f: false): string | undefined;
/** Third */
export function foo(f: string): string | undefined;
export function foo(f: unknown): string | undefined {
  return String(f);
}

export class Overloads {
  /** First */
  method(f: true): string;
  method(f: false): string;
  /** Third */
  method(f: string): string;
  method(f: unknown): string {
    return String(f);
  }
}
