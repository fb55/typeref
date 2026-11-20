/// <reference types="node" />
import type { FileHandle } from "fs/promises";
import { Transform } from "node:stream";

export declare class Stream extends Transform {}

export declare function close(handle: FileHandle): void;
