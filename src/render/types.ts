/**
 * Types and signatures as text: tokens, with links, that each output format
 * renders its way.
 *
 * @module
 */
import type {
  Declaration,
  Flags,
  Parameter,
  Signature,
  Target,
  Type,
  TypeParameter,
} from "../model.ts";

export interface Token {
  kind: "punctuation" | "keyword" | "name" | "literal" | "parameter";
  text: string;
  target?: Target;
}

export interface PrintOptions {
  /**
   * Whether to leave out the types of parameters of function types (as in
   * `(value, index) => boolean`), which tables show instead.
   */
  shouldHideParameterTypes?: boolean;
}

/**
 * How tightly types bind; a type is wrapped in parentheses where something
 * binding tighter needs it.
 */
const Precedence = {
  Conditional: 0,
  Union: 1,
  Intersection: 2,
  Operator: 3,
  Postfix: 4,
  Primary: 5,
} as const;
type Precedence = (typeof Precedence)[keyof typeof Precedence];

/**
 * @param type A type.
 * @returns How tightly it binds.
 */
function precedenceOf(type: Type): Precedence {
  switch (type.type) {
    case "conditional":
    case "function": {
      return Precedence.Conditional;
    }
    case "union": {
      return Precedence.Union;
    }
    case "intersection": {
      return Precedence.Intersection;
    }
    case "operator":
    case "infer":
    case "query":
    case "predicate": {
      return Precedence.Operator;
    }
    case "array":
    case "indexedAccess": {
      return Precedence.Postfix;
    }
    default: {
      return Precedence.Primary;
    }
  }
}

export class TypePrinter {
  readonly tokens: Token[] = [];
  private readonly options: PrintOptions;

  constructor(options: PrintOptions = {}) {
    this.options = options;
  }

  punctuation(text: string): this {
    const last = this.tokens.at(-1);
    if (last?.kind === "punctuation") last.text += text;
    else this.tokens.push({ kind: "punctuation", text });
    return this;
  }

  keyword(text: string): this {
    this.tokens.push({ kind: "keyword", text });
    return this;
  }

  name(text: string, target?: Target): this {
    this.tokens.push(
      target ? { kind: "name", text, target } : { kind: "name", text },
    );
    return this;
  }

  private list<Item>(
    items: Item[],
    print: (item: Item) => void,
    separator = ", ",
  ): this {
    for (const [index, item] of items.entries()) {
      if (index > 0) this.punctuation(separator);
      print(item);
    }
    return this;
  }

  /**
   * @param type A type.
   * @param minimum How tightly the type must bind where it is written.
   * @returns The printer.
   */
  type(type: Type, minimum: Precedence = Precedence.Conditional): this {
    const isWrapped = precedenceOf(type) < minimum;
    if (isWrapped) this.punctuation("(");
    switch (type.type) {
      case "intrinsic": {
        this.keyword(type.name);
        break;
      }
      case "literal": {
        this.tokens.push({ kind: "literal", text: type.value });
        break;
      }
      case "reference": {
        this.name(type.name, type.target);
        this.typeArguments(type.typeArguments);
        break;
      }
      case "union":
      case "intersection": {
        const inner =
          type.type === "union" ? Precedence.Intersection : Precedence.Operator;
        this.list(
          type.types,
          (member) => {
            this.type(member, inner);
          },
          type.type === "union" ? " | " : " & ",
        );
        break;
      }
      case "array": {
        this.type(type.elementType, Precedence.Postfix).punctuation("[]");
        break;
      }
      case "tuple": {
        this.punctuation("[");
        this.list(type.elements, (element) => {
          if (element.rest) this.punctuation("...");
          if (element.name === undefined) {
            this.type(
              element.type,
              element.optional ? Precedence.Postfix : Precedence.Conditional,
            );
            if (element.optional) this.punctuation("?");
          } else {
            this.tokens.push({ kind: "parameter", text: element.name });
            this.punctuation(element.optional ? "?: " : ": ");
            this.type(element.type);
          }
        });
        this.punctuation("]");
        break;
      }
      case "object": {
        this.objectLiteral(type.declaration);
        break;
      }
      case "function": {
        if (type.construct) this.keyword(type.construct).punctuation(" ");
        // Inline, constraints are shown nowhere else.
        this.typeParameters(type.signature.typeParameters, true);
        this.parameters(type.signature.parameters).punctuation(" => ");
        if (type.signature.returns) this.type(type.signature.returns);
        break;
      }
      case "operator": {
        this.keyword(type.operator).punctuation(" ");
        this.type(type.target, Precedence.Operator);
        break;
      }
      case "indexedAccess": {
        this.type(type.objectType, Precedence.Postfix).punctuation("[");
        this.type(type.indexType).punctuation("]");
        break;
      }
      case "conditional": {
        this.type(type.checkType, Precedence.Union);
        this.punctuation(" ").keyword("extends").punctuation(" ");
        this.type(type.extendsType, Precedence.Union);
        this.punctuation(" ? ").type(type.trueType).punctuation(" : ");
        this.type(type.falseType);
        break;
      }
      case "infer": {
        this.keyword("infer").punctuation(" ").name(type.name);
        if (type.constraint) {
          this.punctuation(" ").keyword("extends").punctuation(" ");
          this.type(type.constraint);
        }
        break;
      }
      case "mapped": {
        this.punctuation("{ ");
        if (type.readonly !== undefined) {
          this.keyword(
            `${type.readonly === true ? "" : type.readonly}readonly`,
          );
          this.punctuation(" ");
        }
        this.punctuation("[").name(type.parameter).punctuation(" ");
        this.keyword("in").punctuation(" ").type(type.constraint);
        if (type.nameType) {
          this.punctuation(" ")
            .keyword("as")
            .punctuation(" ")
            .type(type.nameType);
        }
        this.punctuation("]");
        if (type.optional !== undefined) {
          this.punctuation(`${type.optional === true ? "" : type.optional}?`);
        }
        this.punctuation(": ");
        if (type.templateType) this.type(type.templateType);
        this.punctuation(" }");
        break;
      }
      case "query": {
        this.keyword("typeof").punctuation(" ").name(type.name, type.target);
        this.typeArguments(type.typeArguments);
        break;
      }
      case "templateLiteral": {
        this.tokens.push({ kind: "literal", text: `\`${type.head}` });
        for (const [inner, text] of type.tail) {
          this.punctuation("${").type(inner).punctuation("}");
          if (text !== "") this.tokens.push({ kind: "literal", text });
        }
        this.tokens.push({ kind: "literal", text: "`" });
        break;
      }
      case "predicate": {
        if (type.asserts) this.keyword("asserts").punctuation(" ");
        this.tokens.push({ kind: "parameter", text: type.name });
        if (type.targetType) {
          this.punctuation(" ")
            .keyword("is")
            .punctuation(" ")
            .type(type.targetType);
        }
        break;
      }
      // No default
    }
    if (isWrapped) this.punctuation(")");
    return this;
  }

  typeArguments(types: Type[] | undefined): this {
    if (types === undefined || types.length === 0) return this;
    this.punctuation("<").list(types, (type) => {
      this.type(type);
    });
    return this.punctuation(">");
  }

  typeParameters(
    parameters: TypeParameter[] | undefined,
    isFull = false,
  ): this {
    if (parameters === undefined || parameters.length === 0) return this;
    this.punctuation("<");
    this.list(parameters, (parameter) => {
      for (const modifier of parameter.modifiers ?? []) {
        this.keyword(modifier).punctuation(" ");
      }
      this.name(parameter.name);
      if (isFull && parameter.constraint) {
        this.punctuation(" ").keyword("extends").punctuation(" ");
        this.type(parameter.constraint);
      }
      if (isFull && parameter.default) {
        this.punctuation(" = ").type(parameter.default);
      }
    });
    return this.punctuation(">");
  }

  /**
   * @param flags A member's flags.
   * @returns The printer, with the member's modifiers in TypeScript's order.
   */
  modifiers(flags: Flags): this {
    for (const flag of [
      "protected",
      "static",
      "abstract",
      "readonly",
    ] as const) {
      if (flags[flag]) this.keyword(flag).punctuation(" ");
    }
    return this;
  }

  /**
   * @param name A property's name.
   * @returns The printer, with the name as a key: quoted unless it is an
   *   identifier, a number or computed (`[iterator]`). `new` is quoted, which
   *   tells methods named so from construct signatures.
   */
  property(name: string): this {
    return this.name(
      /^(?!new$)(?:[\p{ID_Start}$_][\p{ID_Continue}$]*|\d+|\[.*\])$/u.test(name)
        ? name
        : JSON.stringify(name),
    );
  }

  /**
   * @param signature An index signature.
   * @returns The printer, with the signature: `readonly [key: K]: T`.
   */
  indexSignature(signature: Signature): this {
    if (signature.static) this.keyword("static").punctuation(" ");
    if (signature.readonly) this.keyword("readonly").punctuation(" ");
    // Keys keep their types where parameters of function types do not.
    const [key] = signature.parameters;
    this.punctuation("[").tokens.push({ kind: "parameter", text: key.name });
    if (key.type) this.punctuation(": ").type(key.type);
    this.punctuation("]");
    if (signature.returns) this.punctuation(": ").type(signature.returns);
    return this;
  }

  parameter(parameter: Parameter): this {
    if (parameter.rest) this.punctuation("...");
    this.tokens.push({ kind: "parameter", text: parameter.name });
    if (parameter.optional) this.punctuation("?");
    if (!this.options.shouldHideParameterTypes && parameter.type) {
      this.punctuation(": ").type(parameter.type);
    }
    return this;
  }

  parameters(parameters: Parameter[]): this {
    this.punctuation("(");
    this.list(parameters, (parameter) => {
      this.parameter(parameter);
    });
    return this.punctuation(")");
  }

  /**
   * Prints a signature: `name<T>(a: A): R`.
   *
   * @param signature The signature.
   * @param name The name to print, if not the signature's.
   * @param isInline Whether it is part of a type, which then shows the type
   *   parameters' constraints and defaults too.
   * @returns The printer.
   */
  signature(
    signature: Signature,
    name: string = signature.name,
    isInline = false,
  ): this {
    if (name) this.name(name);
    this.typeParameters(signature.typeParameters, isInline);
    this.parameters(signature.parameters);
    if (signature.returns) this.punctuation(": ").type(signature.returns);
    return this;
  }

  private objectLiteral(declaration: Declaration): void {
    const members = [
      ...(declaration.signatures ?? []).map((signature) => () => {
        this.signature(signature, signature.name === "new" ? "new " : "", true);
      }),
      ...(declaration.indexSignatures ?? []).map((signature) => () => {
        this.indexSignature(signature);
      }),
      ...(declaration.children ?? []).map((child) => () => {
        if (child.flags.readonly) this.keyword("readonly").punctuation(" ");
        const signatures =
          child.signatures ??
          [child.getSignature, child.setSignature].flatMap(
            (signature) => signature ?? [],
          );
        for (const [index, signature] of signatures.entries()) {
          if (index > 0) this.punctuation("; ");
          if (child.kind === "Accessor") {
            this.keyword(signature === child.getSignature ? "get" : "set");
            this.punctuation(" ");
          }
          this.property(child.name);
          if (child.flags.optional) this.punctuation("?");
          this.signature(signature, "", true);
        }
        if (signatures.length > 0) return;
        this.property(child.name);
        if (child.flags.optional) this.punctuation("?");
        this.punctuation(": ");
        if (child.type) this.type(child.type);
      }),
    ];
    if (members.length === 0) {
      this.punctuation("{}");
      return;
    }
    this.punctuation("{ ");
    for (const [index, print] of members.entries()) {
      if (index > 0) this.punctuation("; ");
      print();
    }
    this.punctuation(" }");
  }
}

/**
 * @param print Prints to a printer.
 * @param options How to print.
 * @returns The printed tokens.
 */
export function tokens(
  print: (printer: TypePrinter) => void,
  options?: PrintOptions,
): Token[] {
  const printer = new TypePrinter(options);
  print(printer);
  return printer.tokens;
}

/**
 * @param tokenList Tokens.
 * @returns Their text.
 */
export const plain = (tokenList: Token[]): string =>
  tokenList.map((token) => token.text).join("");
