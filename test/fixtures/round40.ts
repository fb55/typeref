import { Base } from "./round40-base.ts";

export interface Options {
  b: number;
}

export declare class Child extends Base {}

declare function local(): void;

export { local as published };
