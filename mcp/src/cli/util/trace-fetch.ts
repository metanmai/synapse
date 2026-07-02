import fs from "node:fs";

/**
 * Diagnostic fetch wrapper. Writes synchronous stderr markers around each
 * fetch call so we can pinpoint WHICH fetch crashed the process — useful
 * for the Windows STATUS_STACK_BUFFER_OVERRUN class of native fastfails
 * where the process dies inside the fetch syscall before any JS catch
 * runs. Gated on SYNAPSE_TRACE_FETCH=1 so it's a no-op in production.
 *
 * Uses `fs.writeSync(2, ...)` not `process.stderr.write()` — sync writes
 * to file descriptor 2 bypass Node's stdio buffering and reach the OS
 * before the fastfail kills the process.
 */
export function traceFetch(label: string, input: string, init?: RequestInit): Promise<Response> {
  if (process.env.SYNAPSE_TRACE_FETCH !== "1") return fetch(input, init);
  const method = init?.method ?? "GET";
  fs.writeSync(2, `[trace-fetch ${label}] start ${method} ${input}\n`);
  return fetch(input, init).then(
    (res) => {
      fs.writeSync(2, `[trace-fetch ${label}] ok ${method} status=${res.status}\n`);
      return res;
    },
    (err: unknown) => {
      const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      fs.writeSync(2, `[trace-fetch ${label}] threw ${method}: ${msg}\n`);
      throw err;
    },
  );
}
