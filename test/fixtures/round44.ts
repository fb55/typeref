export declare class Base {
  /** Opens a path. */
  constructor(path: string);
}

declare class Middle extends Base {
  constructor(fd: number);
}

export declare class Final extends Middle {}
