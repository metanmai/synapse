import { accent, cream, dim } from "./theme.js";

export function introFrames(): string[][] {
  return [
    ["       ", `   ${cream("◆")}   `, "       "],
    [`   ${dim("·")}   `, `   ${cream("◆")}   `, `   ${dim("·")}   `],
    [
      `${dim("·")}  ${accent("○")}  ${dim("·")}`,
      `${accent("○")}──${cream("◆")}──${accent("○")}`,
      `${dim("·")}  ${accent("○")}  ${dim("·")}`,
    ],
    [
      `${dim("·")}  ${accent("○")}  ${dim("·")}`,
      `${accent("○")}──${cream("◆")}──${accent("○")}`,
      `${dim("·")}  ${accent("○")}  ${dim("·")}`,
    ],
  ];
}

export function spinnerFrames(): string[] {
  return [
    `${dim("·○·")} ${dim("○")}─${cream("◆")}─${dim("○")} ${dim("·○·")}`,
    `${dim("·")}${accent("●")}${dim("·")} ${dim("○")}─${cream("◆")}─${dim("○")} ${dim("·○·")}`,
    `${dim("·○·")} ${accent("●")}─${cream("◆")}─${accent("●")} ${dim("·○·")}`,
    `${dim("·○·")} ${dim("○")}─${cream("◆")}─${dim("○")} ${dim("·")}${accent("●")}${dim("·")}`,
  ];
}
