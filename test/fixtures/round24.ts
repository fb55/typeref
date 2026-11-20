export interface Parser {
  /**
   * Parses input.
   *
   * @param input The input.
   */
  parse(input: string): string;
}

export declare class ArrowParser implements Parser {
  parse: (input: string) => string;
}

export interface Handler {
  /**
   * Handles input.
   *
   * @param input The input.
   */
  handle: (input: string) => void;
}

export declare class ArrowHandler implements Handler {
  handle: (input: string) => void;
}
