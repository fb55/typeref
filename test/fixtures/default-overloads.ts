export default function (value: string): string;
export default function (value: number): number;
export default function (value: string | number): string | number {
  return value;
}
