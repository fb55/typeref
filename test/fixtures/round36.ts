import * as tools from "./round36-tools.ts";

export { tools };
export type Tools = typeof tools;

export declare class Runner {
  /** Runs. */
  run(): void;
}

interface Runnable {
  /** Runs as a runnable. */
  run(): void;
}

declare class Middle extends Runner implements Runnable {
  run(): void;
}

export declare class Sprinter extends Middle {}

interface First {
  run(): void;
}

interface Second {
  /** Runs second. */
  run(): void;
}

interface Both extends First, Second {
  run(): void;
}

export interface Parser extends Both {}
