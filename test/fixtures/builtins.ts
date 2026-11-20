/// <reference types="node" />
import type { FileHandle } from "fs/promises";
import * as stream from "node:stream";
import { Transform } from "node:stream";
import type { ReadableStream } from "node:stream/web";

export declare class Stream extends Transform {}

export declare function close(handle: FileHandle): void;

export declare function pipe(
  source: stream.Readable,
  web: ReadableStream,
): void;
