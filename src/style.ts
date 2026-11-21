const ansi = (open: number, close: number) => (text: string) => `\u001b[${open}m${text}\u001b[${close}m`;
const plain = (text: string) => text;

export function colors(enabled: boolean) {
  const paint = (open: number, close: number) => (enabled ? ansi(open, close) : plain);
  return {
    bold: paint(1, 22),
    dim: paint(2, 22),
    inverse: paint(7, 27),
    red: paint(31, 39),
    green: paint(32, 39),
    yellow: paint(33, 39),
    cyan: paint(36, 39),
  };
}

export type Colors = ReturnType<typeof colors>;

// https://no-color.org
export function wantsColor(stream: { isTTY?: boolean }): boolean {
  return Boolean(stream.isTTY) && !process.env.NO_COLOR;
}

/** "123456" becomes "123 456". */
export function spaced(code: string): string {
  const half = Math.ceil(code.length / 2);
  return `${code.slice(0, half)} ${code.slice(half)}`;
}
