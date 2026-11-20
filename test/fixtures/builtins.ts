/// <reference types="node" />
import type { FileHandle } from "fs/promises";
import * as stream from "node:stream";
import { Transform } from "node:stream";
import type { ReadableStream } from "node:stream/web";

import type { Readable as Barreled } from "./builtins-types.ts";

export declare class Stream extends Transform {}

export declare function close(handle: FileHandle): void;

export declare function readable(): import("node:stream").Readable;

export declare function barreled(): Barreled;

/** The module of {@link stream.Readable}. */
export declare function streams(): typeof import("node:stream");

export declare function pipe(
  source: stream.Readable,
  web: ReadableStream,
): void;
