export const API_URL = "https://api.synapsesync.app";
export const APP_URL = "https://synapsesync.app";

export function pad(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - s.length));
}
