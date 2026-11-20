/**
 * The documentation model: what was found in the declaration files, ready to
 * render. It is plain data (no classes, no cycles), so it serializes to JSON.
 *
 * @module
 */

/**
 * Kinds of documented declarations. They are named as TypeDoc names them, and
 * decide the directory a page lands in.
 */
export type Kind =
  | "Module"
  | "Namespace"
  | "Enum"
  | "EnumMember"
  | "Variable"
  | "Function"
  | "Class"
  | "Interface"
  | "Constructor"
  | "Property"
  | "Method"
  | "Accessor"
  | "TypeAlias"
  | "TypeLiteral"
  | "Reference";

/** Where a link goes. */
export type Target =
  /** A declaration of the documented project, by its {@link Declaration.id}. */
  | { kind: "declaration"; id: number }
  /** Another site: the docs of a dependency, MDN, or a URL from a comment. */
  | { kind: "url"; url: string };

/** A piece of comment text. */
export type Part =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | {
      kind: "inline-tag";
      /** The tag, including its `@`, e.g. `@link`. */
      tag: string;
      /** The text after the tag (for links, the label if one was given). */
      text: string;
      /** For `@link`, `@linkcode` and `@linkplain`: where the link goes. */
      target?: Target;
    };

export interface BlockTag {
  /** The tag, including its `@`, e.g. `@returns`. */
  tag: string;
  /** For `@param` and `@typeParam`: the name it describes. */
  name?: string;
  content: Part[];
}

export interface Comment {
  summary: Part[];
  blockTags: BlockTag[];
  /** Tags without content, e.g. `@readonly`, `@deprecated` without a reason. */
  modifierTags: string[];
}

/** Where a declaration is written, in the sources the declarations map to. */
export interface Source {
  /** The path, relative to the project's root. */
  file: string;
  /** The line, starting at 1. */
  line: number;
  /** A link to the line, e.g. on GitHub. */
  url?: string;
}

export interface TypeParameter {
  name: string;
  constraint?: Type;
  default?: Type;
  /** Modifiers written before the name: `const`, `in`, `out`. */
  modifiers?: ("const" | "in" | "out")[];
  comment?: Part[];
}

export interface Parameter {
  name: string;
  type?: Type;
  optional?: boolean;
  rest?: boolean;
  comment?: Part[];
}

export interface Signature {
  /** The name of the function or method, `new` for construct signatures. */
  name: string;
  comment?: Comment;
  typeParameters?: TypeParameter[];
  parameters: Parameter[];
  returns?: Type;
  sources?: Source[];
  /** Index signatures: whether they are `readonly`, and `static`. */
  readonly?: boolean;
  static?: boolean;
}

export interface Flags {
  optional?: boolean;
  readonly?: boolean;
  static?: boolean;
  abstract?: boolean;
  protected?: boolean;
  /** `const` variables and enums. */
  const?: boolean;
}

export interface Declaration {
  /** Unique within a project. Links refer to declarations by it. */
  id: number;
  kind: Kind;
  name: string;
  flags: Flags;
  comment?: Comment;
  sources?: Source[];
  typeParameters?: TypeParameter[];
  /** Functions, methods and constructors; call and construct signatures. */
  signatures?: Signature[];
  indexSignatures?: Signature[];
  /** Accessors. */
  getSignature?: Signature;
  setSignature?: Signature;
  /** Variables, properties and type aliases. */
  type?: Type;
  /** Enum members, and variables declared with a literal. */
  defaultValue?: string;
  /** Members of classes, interfaces, enums, namespaces and modules. */
  children?: Declaration[];
  extends?: Type[];
  implements?: Type[];
  /** The member of a base type this one was copied from. */
  inheritedFrom?: Type;
  /** The member of a base type this one replaces. */
  overwrites?: Type;
  /** References: the declaration exported under another name or path. */
  target?: number;
}

/** A member of a tuple type. */
export interface TupleElement {
  name?: string;
  type: Type;
  optional?: boolean;
  rest?: boolean;
}

export type Type =
  /** Keywords: `string`, `void`, `this`, `unique symbol`'s `symbol`, … */
  | { type: "intrinsic"; name: string }
  /** As written: `"a"`, `1`, `-1n`, `true`, `null`. */
  | { type: "literal"; value: string }
  | {
      type: "reference";
      /** As written, qualified names included (`Intl.Locale`). */
      name: string;
      target?: Target;
      typeArguments?: Type[];
      /** Type parameters are not linked. */
      typeParameter?: boolean;
    }
  | { type: "union" | "intersection"; types: Type[] }
  | { type: "array"; elementType: Type }
  | { type: "tuple"; elements: TupleElement[] }
  /** Object type literals, whose members are declarations. */
  | { type: "object"; declaration: Declaration }
  | {
      type: "function";
      signature: Signature;
      /** `new (…) => …` and `abstract new (…) => …`. */
      construct?: "new" | "abstract new";
    }
  | {
      type: "operator";
      operator: "keyof" | "unique" | "readonly";
      target: Type;
    }
  | { type: "indexedAccess"; objectType: Type; indexType: Type }
  | {
      type: "conditional";
      checkType: Type;
      extendsType: Type;
      trueType: Type;
      falseType: Type;
    }
  | { type: "infer"; name: string; constraint?: Type }
  | {
      type: "mapped";
      parameter: string;
      constraint: Type;
      nameType?: Type;
      templateType?: Type;
      readonly?: "+" | "-" | true;
      optional?: "+" | "-" | true;
    }
  /** `typeof x`. */
  | {
      type: "query";
      name: string;
      target?: Target;
      typeArguments?: Type[];
    }
  /** `` `a${B}c` ``: the text before the first type, then each type and the text after it. */
  | { type: "templateLiteral"; head: string; tail: [Type, string][] }
  | {
      type: "predicate";
      name: string;
      asserts?: boolean;
      targetType?: Type;
    };

export interface Module extends Declaration {
  kind: "Module";
  /** The README, for packages of a monorepo. */
  readme?: string;
  /** Where the README is in its repository, for its relative links. */
  readmeUrl?: string;
}

export interface Project {
  name: string;
  version?: string;
  /** The README's Markdown. */
  readme?: string;
  /** Where the README is in its repository, for its relative links. */
  readmeUrl?: string;
  /**
   * The entry points. A project with one entry point keeps its exports here,
   * in a module without a page of its own.
   */
  modules: Module[];
}
