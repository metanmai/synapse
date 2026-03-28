const NO_COLOR = "NO_COLOR" in process.env;
const TRUECOLOR = /^(truecolor|24bit)$/i.test(process.env.COLORTERM ?? "");

function rgb(r: number, g: number, b: number, s: string): string {
  if (NO_COLOR) return s;
  if (TRUECOLOR) return `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m`;
  const code = 16 + 36 * Math.round((r / 255) * 5) + 6 * Math.round((g / 255) * 5) + Math.round((b / 255) * 5);
  return `\x1b[38;5;${code}m${s}\x1b[39m`;
}

/** Copper — interactive elements, prompts, glyph nodes (#c87941) */
export function accent(s: string): string {
  return rgb(200, 121, 65, s);
}

/** Cream — primary text, headings (#ffe4c4) */
export function cream(s: string): string {
  return rgb(255, 228, 196, s);
}

/** Warm gray — hints, descriptions, pipes (#7a6455) */
export function muted(s: string): string {
  return rgb(122, 100, 85, s);
}

/** Dark brown — glyph edges, subtle details (#5c3d2e) */
export function dim(s: string): string {
  return rgb(92, 61, 46, s);
}

/** Green — checkmarks (#3fb950) */
export function success(s: string): string {
  return rgb(63, 185, 80, s);
}

/** Red — error messages (#f85149) */
export function error(s: string): string {
  return rgb(248, 81, 73, s);
}

export function bold(s: string): string {
  if (NO_COLOR) return s;
  return `\x1b[1m${s}\x1b[22m`;
}
