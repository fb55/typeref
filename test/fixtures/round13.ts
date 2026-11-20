export type Config = { readonly [name: string]: string };

export type Callable = {
  (input: string): string;
  /** @hidden */
  (input: number): number;
};
