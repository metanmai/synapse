// Pure decision logic for AI-driven project correlation.
// Spec: docs/superpowers/specs/2026-06-14-ai-project-correlation-design.md
// Kept free of I/O so it can be unit-tested deterministically.

import { CAPTURE_HOSTS } from "@synapse/shared/capture-hosts.js";

export const PROVISIONAL_PROJECT_NAME = "New project";

export interface Candidate {
  projectId: string;
  score: number;
}

export interface ProjLite {
  id: string;
  name: string;
  createdAt: number;
}

export interface AssignmentDecision {
  action: "assign" | "create";
  projectId?: string;
  confidence: number;
}

/**
 * Decide whether a keyless capture joins an existing project or starts a new one.
 * `assign` covers both the confident band (score ≥ assign) and the ambiguous band
 * (create ≤ score < assign); the reconciler later rechecks the ambiguous case,
 * which callers derive from `confidence < assign`.
 */
export function decideAssignment(
  candidates: Candidate[],
  thresholds: { assign: number; create: number },
): AssignmentDecision {
  const top = [...candidates].sort((a, b) => b.score - a.score)[0];
  if (!top || top.score < thresholds.create) {
    return { action: "create", confidence: top?.score ?? 0 };
  }
  return { action: "assign", projectId: top.projectId, confidence: top.score };
}

/** A name is synthetic if it was auto-derived rather than meaningful to a human. */
export function isSyntheticProjectName(name: string): boolean {
  if (/^cwd_[a-f0-9]{12}$/.test(name)) return true;
  if (name === PROVISIONAL_PROJECT_NAME) return true;
  return (CAPTURE_HOSTS as readonly string[]).includes(name);
}

/**
 * Pick which project survives a merge: a non-synthetic ("real") project always
 * absorbs a synthetic host-bucket; otherwise the earliest-created survives.
 */
export function chooseMergeTarget(a: ProjLite, b: ProjLite): { target: ProjLite; source: ProjLite } {
  const aSynthetic = isSyntheticProjectName(a.name);
  const bSynthetic = isSyntheticProjectName(b.name);
  if (aSynthetic !== bSynthetic) {
    const target = aSynthetic ? b : a;
    return { target, source: target === a ? b : a };
  }
  const target = a.createdAt <= b.createdAt ? a : b;
  return { target, source: target === a ? b : a };
}

/** Canonical pair ordering so a candidate is deduped regardless of detection order. */
export function orderPair(idA: string, idB: string): [string, string] {
  return idA <= idB ? [idA, idB] : [idB, idA];
}

/** Hysteresis: a candidate is stable (mergeable) only once it has survived a prior run. */
export function isStableCandidate(firstSeenAtMs: number, runStartMs: number): boolean {
  return firstSeenAtMs < runStartMs;
}

/**
 * A capture is "keyless" — eligible for AI Tier-3 resolution — when it has no git
 * remote and no real filesystem path. Browser captures (synapse:// projectPath) and
 * pure non-code captures (no cwd) qualify; a real git remote or local folder does not.
 */
export function isKeylessContext(wc: Record<string, unknown>): boolean {
  if (typeof wc.git_origin_url === "string" && wc.git_origin_url.length > 0) return false;
  if (typeof wc.projectPath === "string") return wc.projectPath.startsWith("synapse://");
  return !wc.cwd;
}
