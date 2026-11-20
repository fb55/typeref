export namespace Outer {
  export type Shared = string;
  export interface Inner {
    a: Shared;
  }
  export namespace Deep {
    export interface Options {
      b: string;
    }
  }
}

export function merged(): void {}
export namespace merged {
  export const extra = 1;
}

export namespace Runner {
  interface Options {
    fast: boolean;
  }
  export function run(options: Options): void {
    void options;
  }
}
