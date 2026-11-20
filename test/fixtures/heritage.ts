import * as Api from "./heritage-api.ts";

type Methods = typeof Api;

export interface Wrapper extends Methods {
  length: number;
}
