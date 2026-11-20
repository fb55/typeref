/**
 * Links for globals: JavaScript's built-ins and the DOM on MDN, TypeScript's
 * utility types in its handbook.
 *
 * @module
 */

const mdn = "https://developer.mozilla.org/en-US/docs/";
const handbook = "https://www.typescriptlang.org/docs/handbook/";

const javascript = new Set([
  "AggregateError",
  "Array",
  "ArrayBuffer",
  "AsyncGenerator",
  "AsyncGeneratorFunction",
  "AsyncIterator",
  "Atomics",
  "BigInt",
  "BigInt64Array",
  "BigUint64Array",
  "Boolean",
  "DataView",
  "Date",
  "Error",
  "EvalError",
  "FinalizationRegistry",
  "Float16Array",
  "Float32Array",
  "Float64Array",
  "Function",
  "Generator",
  "GeneratorFunction",
  "Int16Array",
  "Int32Array",
  "Int8Array",
  "Intl",
  "Iterator",
  "JSON",
  "Map",
  "Math",
  "Number",
  "Object",
  "Promise",
  "Proxy",
  "RangeError",
  "ReferenceError",
  "Reflect",
  "RegExp",
  "Set",
  "SharedArrayBuffer",
  "String",
  "Symbol",
  "SyntaxError",
  "TypeError",
  "URIError",
  "Uint16Array",
  "Uint32Array",
  "Uint8Array",
  "Uint8ClampedArray",
  "WeakMap",
  "WeakRef",
  "WeakSet",
]);

/** Utility types, and their anchors in the handbook's page. */
const utilityTypes: Record<string, string> = {
  Awaited: "awaitedtype",
  Capitalize: "capitalizestringtype",
  ConstructorParameters: "constructorparameterstype",
  Exclude: "excludeuniontype-excludedmembers",
  Extract: "extracttype-union",
  InstanceType: "instancetypetype",
  Lowercase: "lowercasestringtype",
  NoInfer: "noinfertype",
  NonNullable: "nonnullabletype",
  Omit: "omittype-keys",
  OmitThisParameter: "omitthisparametertype",
  Parameters: "parameterstype",
  Partial: "partialtype",
  Pick: "picktype-keys",
  Readonly: "readonlytype",
  Record: "recordkeys-type",
  Required: "requiredtype",
  ReturnType: "returntypetype",
  ThisParameterType: "thisparametertypetype",
  ThisType: "thistypetype",
  Uncapitalize: "uncapitalizestringtype",
  Uppercase: "uppercasestringtype",
};

/** Other types of TypeScript's library, and their pages. */
const typescript: Record<string, string> = {
  ArrayLike: `${mdn}Web/JavaScript/Guide/Indexed_collections#working_with_array-like_objects`,
  AsyncIterable: `${mdn}Web/JavaScript/Reference/Iteration_protocols#the_async_iterator_and_async_iterable_protocols`,
  AsyncIterableIterator: `${mdn}Web/JavaScript/Reference/Iteration_protocols#the_async_iterator_and_async_iterable_protocols`,
  Iterable: `${handbook}iterators-and-generators.html#iterable-interface`,
  IterableIterator: `${handbook}iterators-and-generators.html#iterable-interface`,
  PromiseLike: `${mdn}Web/JavaScript/Reference/Global_Objects/Promise#thenables`,
  PropertyKey: `${handbook}2/keyof-types.html`,
  ReadonlyArray: `${handbook}2/objects.html#the-readonlyarray-type`,
  ReadonlyMap: `${mdn}Web/JavaScript/Reference/Global_Objects/Map`,
  ReadonlySet: `${mdn}Web/JavaScript/Reference/Global_Objects/Set`,
  TemplateStringsArray: `${mdn}Web/JavaScript/Reference/Template_literals#tagged_templates`,
};

/** Interfaces of the DOM and of web APIs that have a page on MDN. */
const web = new Set([
  "AbortController",
  "AbortSignal",
  "Attr",
  "Blob",
  "BroadcastChannel",
  "CharacterData",
  "Comment",
  "CompressionStream",
  "Crypto",
  "CryptoKey",
  "CustomEvent",
  "DOMException",
  "DOMParser",
  "DecompressionStream",
  "Document",
  "DocumentFragment",
  "DocumentType",
  "Element",
  "Event",
  "EventTarget",
  "File",
  "FormData",
  "HTMLElement",
  "HTMLTemplateElement",
  "Headers",
  "MessageChannel",
  "MessagePort",
  "NamedNodeMap",
  "Node",
  "NodeList",
  "ProcessingInstruction",
  "ReadableStream",
  "Request",
  "Response",
  "ShadowRoot",
  "Text",
  "TextDecoder",
  "TextDecoderStream",
  "TextEncoder",
  "TextEncoderStream",
  "TransformStream",
  "URL",
  "URLSearchParams",
  "WebAssembly",
  "WebSocket",
  "Window",
  "Worker",
  "WritableStream",
  "XMLDocument",
  "XMLSerializer",
]);

/**
 * @param name The name of a global.
 * @returns A page documenting the global, if it is a built-in.
 */
export function globalUrl(name: string): string | undefined {
  if (javascript.has(name)) {
    return `${mdn}Web/JavaScript/Reference/Global_Objects/${name}`;
  }
  const anchor = Object.hasOwn(utilityTypes, name)
    ? utilityTypes[name]
    : undefined;
  if (anchor !== undefined) return `${handbook}utility-types.html#${anchor}`;
  if (web.has(name)) return `${mdn}Web/API/${name}`;
  return Object.hasOwn(typescript, name) ? typescript[name] : undefined;
}
