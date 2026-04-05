import { introFrames } from "./glyph.js";
import { bold, cream, muted } from "./theme.js";

const NO_COLOR = "NO_COLOR" in process.env;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function showWelcome(version: string): Promise<void> {
  const stream = process.stdout;
  const frames = introFrames();

  if (NO_COLOR || !stream.isTTY) {
    const last = frames[frames.length - 1];
    for (const line of last) {
      stream.write(`  ${line}\n`);
    }
    stream.write(`\n  ${bold("Synapse")} ${muted(`v${version}`)}\n`);
    stream.write(`  ${muted("Capture sessions. Distill knowledge. Remember everything.")}\n\n`);
    return;
  }

  const frameDelay = 250;

  // Write first frame
  for (const line of frames[0]) {
    stream.write(`  ${line}\n`);
  }
  await sleep(frameDelay);

  // Subsequent glyph frames — overwrite previous lines
  for (let i = 1; i < frames.length; i++) {
    stream.write(`\x1b[${frames[i - 1].length}A`);
    for (const line of frames[i]) {
      stream.write(`\r\x1b[2K  ${line}\n`);
    }
    await sleep(frameDelay);
  }

  // Title
  stream.write(`\n  ${bold(cream("Synapse"))} ${muted(`v${version}`)}\n`);
  await sleep(frameDelay);

  // Tagline
  stream.write(`  ${muted("Capture sessions. Distill knowledge. Remember everything.")}\n\n`);
  await sleep(frameDelay);
}
