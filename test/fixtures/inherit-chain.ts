export interface A extends B {}

export interface B extends C {}

/** C docs. */
export interface C {}

export interface Base {
  [key: string]: unknown;
}

export interface Numbered extends Base {
  [key: number]: string;
}

export const first = 1,
  second = "";

/** @inheritDoc A */
export interface Named {}
