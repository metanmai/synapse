/**
 * scripts/lib/stale-projects.mjs — pure selection logic for the
 * test-account hygiene cleanup.
 *
 * Why this is split out: the network/auth wrapper in
 * scripts/cleanup-test-account.mjs is hard to unit-test (it talks to a
 * live backend over fetch), but the "which projects count as stale" rule
 * IS the safety-critical bit — getting the keep-list semantics wrong or
 * the age-threshold boundary off-by-one is what would let the script
 * eat a sibling CI leg's in-flight project. Extracting it as a pure
 * function lets us pin it down with vitest unit tests in the mcp
 * workspace (mcp/test/unit/stale-projects.test.ts) without dragging
 * the whole script's fetch + process.exit surface into the test harness.
 *
 * Selection rule (must stay in lockstep with the script's docs):
 *   1. A project whose `name` appears in `keepNames` is NEVER stale,
 *      regardless of age. Exact-name match (the rule is opt-in safety
 *      for the rare landmark project on the test account; the default
 *      keep-list is EMPTY because that account is a dedicated CI mule).
 *   2. A project with a MISSING or unparsable `created_at` IS stale.
 *      This is the right default because (a) every real backend row
 *      has `created_at NOT NULL DEFAULT now()` per migration 001, so
 *      the only way to land here is a malformed list response or a
 *      historical row predating that constraint, and (b) the whole
 *      point of this script is to bound contamination — preserving
 *      mystery rows defeats the purpose.
 *   3. Otherwise: stale iff `(nowMs - createdMs) >= olderThanMinutes * 60_000`.
 *      The `>=` (not `>`) is deliberate: the boundary minute is "old enough."
 *      With the default 45-minute threshold, this matches the CI matrix's
 *      concurrency guard (the ubuntu + windows happy-flow legs both run
 *      against the same account; a 45-min floor is well beyond any single
 *      leg's runtime so this script can't race a sibling job).
 *
 * Pure: no fetch, no process exit, no clock — caller passes `nowMs`. The
 * script that owns the side effects is responsible for calling
 * `Date.now()` once and passing it in, which also keeps every project's
 * staleness check anchored to the same instant.
 */

const MS_PER_MINUTE = 60_000;

/**
 * @typedef {object} ProjectShape
 * @property {string} id
 * @property {string} name
 * @property {string | null | undefined} [created_at]
 */

/**
 * @typedef {object} StaleSelection
 * @property {ProjectShape[]} stale     - eligible for deletion
 * @property {ProjectShape[]} kept      - matched a `keepNames` entry by exact name
 * @property {ProjectShape[]} fresh     - too young (under the threshold)
 */

/**
 * @param {ProjectShape[]} projects
 * @param {number} nowMs - the "now" instant in ms (Date.now() at script start)
 * @param {{ olderThanMinutes: number, keepNames: Iterable<string> }} opts
 * @returns {StaleSelection}
 */
export function selectStaleProjects(projects, nowMs, { olderThanMinutes, keepNames }) {
  if (!Array.isArray(projects)) {
    throw new TypeError("selectStaleProjects: projects must be an array");
  }
  if (!Number.isFinite(nowMs)) {
    throw new TypeError("selectStaleProjects: nowMs must be a finite number");
  }
  if (!Number.isFinite(olderThanMinutes) || olderThanMinutes < 0) {
    throw new TypeError("selectStaleProjects: olderThanMinutes must be a non-negative finite number");
  }

  const keepSet = new Set(keepNames ?? []);
  const thresholdMs = olderThanMinutes * MS_PER_MINUTE;

  const stale = [];
  const kept = [];
  const fresh = [];

  for (const p of projects) {
    if (keepSet.has(p.name)) {
      kept.push(p);
      continue;
    }
    // Missing OR unparsable created_at → treated as stale (see header).
    const raw = p?.created_at;
    if (raw === undefined || raw === null || raw === "") {
      stale.push(p);
      continue;
    }
    const createdMs = Date.parse(String(raw));
    if (Number.isNaN(createdMs)) {
      stale.push(p);
      continue;
    }
    const ageMs = nowMs - createdMs;
    if (ageMs >= thresholdMs) {
      stale.push(p);
    } else {
      fresh.push(p);
    }
  }

  return { stale, kept, fresh };
}

/**
 * Helper that callers can use to render an age string for the dry-run log.
 * Returns "unknown" when `created_at` is missing/unparsable so the log line
 * still makes sense (it's the same row that selectStaleProjects flagged
 * stale via the missing-created_at branch).
 *
 * @param {ProjectShape} project
 * @param {number} nowMs
 * @returns {string}
 */
export function formatAge(project, nowMs) {
  const raw = project?.created_at;
  if (raw === undefined || raw === null || raw === "") return "unknown";
  const createdMs = Date.parse(String(raw));
  if (Number.isNaN(createdMs)) return "unknown";
  const ageMin = Math.floor((nowMs - createdMs) / MS_PER_MINUTE);
  if (ageMin < 60) return `${ageMin}m`;
  const ageHr = Math.floor(ageMin / 60);
  if (ageHr < 48) return `${ageHr}h${ageMin % 60}m`;
  const ageDay = Math.floor(ageHr / 24);
  return `${ageDay}d${ageHr % 24}h`;
}
