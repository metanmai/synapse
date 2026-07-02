// Per-host drift detector. A completion that MATCHED the endpoint and returned
// a non-empty body but parsed to nothing is the unambiguous signature of a
// wire-format change (an empty/aborted body is not — it carries no evidence).
// Fires after `threshold` such strikes with no successful parse in between,
// then re-arms (resets) so it signals once per run rather than every call.

export interface CompletionOutcome {
  matched: boolean;
  hadBody: boolean;
  parsedOk: boolean;
}

export interface DriftSentinel {
  record(host: string, outcome: CompletionOutcome): "drift" | null;
}

export function createDriftSentinel(opts: { threshold?: number } = {}): DriftSentinel {
  const threshold = opts.threshold ?? 3;
  const strikes = new Map<string, number>();

  return {
    record(host, { matched, hadBody, parsedOk }) {
      if (!matched) return null; // not our endpoint — irrelevant
      if (parsedOk) {
        strikes.set(host, 0); // a good parse clears the host
        return null;
      }
      if (!hadBody) return null; // empty/aborted body — no drift evidence
      const next = (strikes.get(host) ?? 0) + 1;
      if (next >= threshold) {
        strikes.set(host, 0); // re-arm
        return "drift";
      }
      strikes.set(host, next);
      return null;
    },
  };
}
