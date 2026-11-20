export interface Options {
  name?: string;
}

export function configure({ name }: Options = {}): string {
  return name ?? "";
}

export enum TokenType {
  Text,
  Comment,
}

export interface TextToken {
  type: TokenType.Text;
}
