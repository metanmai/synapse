// Privacy-safe structural descriptor of a response body, for drift diagnosis.
// Emits ONLY structure: the set of SSE `event:` names, the byte length, and a
// one-way FNV-1a hash of the bytes. Never any value, key, or message text — so
// it is safe to send to the daemon and log.

export interface DriftShape {
  eventNames: string[];
  byteLength: number;
  sampleHash: string;
}

function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function summarizeShape(responseText: string): DriftShape {
  const names = new Set<string>();
  for (const line of responseText.split("\n")) {
    if (line.startsWith("event:")) names.add(line.slice("event:".length).trim());
  }
  return {
    eventNames: [...names].sort().slice(0, 20),
    byteLength: responseText.length,
    sampleHash: fnv1a(responseText),
  };
}
