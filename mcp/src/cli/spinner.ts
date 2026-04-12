import { spinnerFrames } from "./glyph.js";
import { accent, success } from "./theme.js";

export interface GlyphSpinner {
  start(msg: string): void;
  stop(msg: string): void;
  update(msg: string): void;
}

export function createGlyphSpinner(): GlyphSpinner {
  const frames = spinnerFrames();
  let interval: ReturnType<typeof setInterval> | null = null;
  let frameIdx = 0;
  let currentMsg = "";

  return {
    start(msg: string): void {
      currentMsg = msg;
      frameIdx = 0;
      process.stdout.write(`${accent("◆")} ${currentMsg}  ${frames[0]}`);
      interval = setInterval(() => {
        frameIdx = (frameIdx + 1) % frames.length;
        process.stdout.write(`\r\x1b[2K${accent("◆")} ${currentMsg}  ${frames[frameIdx]}`);
      }, 150);
    },
    stop(msg: string): void {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
      process.stdout.write(`\r\x1b[2K${success("✓")} ${msg}\n`);
    },
    update(msg: string): void {
      currentMsg = msg;
    },
  };
}
