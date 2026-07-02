// mcp/test/unit/stale-projects.test.ts
//
// Unit coverage for `selectStaleProjects` — the pure selection logic
// inside scripts/lib/stale-projects.mjs. That function is the
// safety-critical brain of scripts/cleanup-test-account.mjs (the CI
// pre-flight hygiene script that force-deletes leaked E2E projects on
// the test account). If the age boundary slips or the keep-list
// short-circuit is broken we could nuke a sibling CI leg's in-flight
// project, which would flip the bug we're trying to fix.
//
// Hosted here (mcp/test/unit/) so the mcp workspace's `npm test` picks
// it up — the scripts/ tree has no test runner of its own, and the
// happy-flow-e2e CI matrix uses the mcp workspace's `npm run test:e2e`
// gate so a regression here would surface in the same job.
//
// Import path: relative to scripts/ (one level above mcp/) — the
// `.mjs` file is plain ESM with no TypeScript types, but mcp's
// tsconfig only includes src/**/*.ts so the test file is outside the
// tsc compilation roots and the untyped import is fine at typecheck
// time. Vitest resolves .mjs natively.

import { describe, expect, it } from "vitest";
// @ts-expect-error - .mjs file, no types; pure JS module imported as ESM
import { formatAge, selectStaleProjects } from "../../../scripts/lib/stale-projects.mjs";

// Anchor time for age math. All test fixtures express `created_at` as
// `NOW - <N>m` so the arithmetic is obvious in the test source.
const NOW = Date.parse("2026-06-10T12:00:00Z");
const MIN = 60_000;

function ago(minutes: number): string {
  return new Date(NOW - minutes * MIN).toISOString();
}

interface ProjectFixture {
  id: string;
  name: string;
  created_at?: string | null;
}

describe("selectStaleProjects — empty list", () => {
  it("returns empty buckets when given no projects", () => {
    const out = selectStaleProjects([], NOW, { olderThanMinutes: 45, keepNames: [] });
    expect(out).toEqual({ stale: [], kept: [], fresh: [] });
  });

  it("still returns empty buckets when keep-list is non-empty but list is empty", () => {
    const out = selectStaleProjects([], NOW, {
      olderThanMinutes: 45,
      keepNames: ["landmark"],
    });
    expect(out).toEqual({ stale: [], kept: [], fresh: [] });
  });
});

describe("selectStaleProjects — age threshold boundary", () => {
  // The rule is `(now - created) >= olderThanMinutes * 60_000`. The
  // boundary is INCLUSIVE: a project created exactly `olderThanMinutes`
  // ago IS stale. These tests pin the boundary so a future refactor
  // can't silently flip `>=` to `>` (which would leave 1-minute-window
  // residue uncleaned every run).
  it("includes project at the exact threshold minute (>= boundary)", () => {
    const projects: ProjectFixture[] = [{ id: "p1", name: "boundary", created_at: ago(45) }];
    const out = selectStaleProjects(projects, NOW, { olderThanMinutes: 45, keepNames: [] });
    expect(out.stale.map((p: ProjectFixture) => p.id)).toEqual(["p1"]);
    expect(out.fresh).toEqual([]);
  });

  it("excludes project one minute below the threshold", () => {
    const projects: ProjectFixture[] = [{ id: "p1", name: "just-young", created_at: ago(44) }];
    const out = selectStaleProjects(projects, NOW, { olderThanMinutes: 45, keepNames: [] });
    expect(out.stale).toEqual([]);
    expect(out.fresh.map((p: ProjectFixture) => p.id)).toEqual(["p1"]);
  });

  it("includes project well past the threshold (default 45m vs 200m old)", () => {
    const projects: ProjectFixture[] = [{ id: "p1", name: "old", created_at: ago(200) }];
    const out = selectStaleProjects(projects, NOW, { olderThanMinutes: 45, keepNames: [] });
    expect(out.stale.map((p: ProjectFixture) => p.id)).toEqual(["p1"]);
  });

  it("respects a custom threshold (120m): a 100m-old project is fresh", () => {
    const projects: ProjectFixture[] = [{ id: "p1", name: "young-for-120", created_at: ago(100) }];
    const out = selectStaleProjects(projects, NOW, { olderThanMinutes: 120, keepNames: [] });
    expect(out.fresh.map((p: ProjectFixture) => p.id)).toEqual(["p1"]);
    expect(out.stale).toEqual([]);
  });

  it("partitions a mixed-age list into stale + fresh", () => {
    const projects: ProjectFixture[] = [
      { id: "stale-1", name: "old-a", created_at: ago(60) },
      { id: "fresh-1", name: "new-a", created_at: ago(10) },
      { id: "stale-2", name: "old-b", created_at: ago(46) },
      { id: "fresh-2", name: "new-b", created_at: ago(44) },
    ];
    const out = selectStaleProjects(projects, NOW, { olderThanMinutes: 45, keepNames: [] });
    expect(out.stale.map((p: ProjectFixture) => p.id).sort()).toEqual(["stale-1", "stale-2"]);
    expect(out.fresh.map((p: ProjectFixture) => p.id).sort()).toEqual(["fresh-1", "fresh-2"]);
  });
});

describe("selectStaleProjects — missing created_at treated as stale", () => {
  // Bug class this guards: a malformed list response, or an old row
  // predating the NOT NULL constraint, would otherwise sit there
  // forever — defeating the script's purpose of bounding contamination.
  // The rule MUST be "missing → stale" so the cleanup actually catches
  // those rows. We test every shape of "missing" because JS has too many
  // ways to express it.
  it("treats `undefined` created_at as stale", () => {
    const projects: ProjectFixture[] = [{ id: "p1", name: "no-field" }];
    const out = selectStaleProjects(projects, NOW, { olderThanMinutes: 45, keepNames: [] });
    expect(out.stale.map((p: ProjectFixture) => p.id)).toEqual(["p1"]);
  });

  it("treats `null` created_at as stale", () => {
    const projects: ProjectFixture[] = [{ id: "p1", name: "null-field", created_at: null }];
    const out = selectStaleProjects(projects, NOW, { olderThanMinutes: 45, keepNames: [] });
    expect(out.stale.map((p: ProjectFixture) => p.id)).toEqual(["p1"]);
  });

  it("treats empty-string created_at as stale", () => {
    const projects: ProjectFixture[] = [{ id: "p1", name: "empty-string", created_at: "" }];
    const out = selectStaleProjects(projects, NOW, { olderThanMinutes: 45, keepNames: [] });
    expect(out.stale.map((p: ProjectFixture) => p.id)).toEqual(["p1"]);
  });

  it("treats unparsable created_at as stale (not a NaN crash)", () => {
    const projects: ProjectFixture[] = [{ id: "p1", name: "garbage", created_at: "not-a-date" }];
    const out = selectStaleProjects(projects, NOW, { olderThanMinutes: 45, keepNames: [] });
    expect(out.stale.map((p: ProjectFixture) => p.id)).toEqual(["p1"]);
  });
});

describe("selectStaleProjects — keep-list exclusion", () => {
  // The keep-list short-circuits BEFORE the age check, so a kept
  // project is preserved even if it's billion years old. That's the
  // intent: keep-names are a landmark protection, not an age modifier.
  it("excludes a keep-named project even when ancient", () => {
    const projects: ProjectFixture[] = [{ id: "p1", name: "landmark", created_at: ago(99_999) }];
    const out = selectStaleProjects(projects, NOW, {
      olderThanMinutes: 45,
      keepNames: ["landmark"],
    });
    expect(out.kept.map((p: ProjectFixture) => p.id)).toEqual(["p1"]);
    expect(out.stale).toEqual([]);
    expect(out.fresh).toEqual([]);
  });

  it("excludes a keep-named project even when created_at is missing", () => {
    // Otherwise the missing-created_at rule would override the keep
    // list, surfacing as a confusing "I told you to keep X but you
    // deleted it" CI log. Keep-list always wins.
    const projects: ProjectFixture[] = [{ id: "p1", name: "landmark" }];
    const out = selectStaleProjects(projects, NOW, {
      olderThanMinutes: 45,
      keepNames: ["landmark"],
    });
    expect(out.kept.map((p: ProjectFixture) => p.id)).toEqual(["p1"]);
    expect(out.stale).toEqual([]);
  });

  it("keep-list matches by EXACT name only — substring is not enough", () => {
    // Substring matches would be too permissive: a keep of `synapse`
    // would also protect `synapse-test-leak-from-fri`, masking leaks.
    const projects: ProjectFixture[] = [
      { id: "match", name: "landmark", created_at: ago(200) },
      { id: "near-1", name: "landmark-suffix", created_at: ago(200) },
      { id: "near-2", name: "prefix-landmark", created_at: ago(200) },
    ];
    const out = selectStaleProjects(projects, NOW, {
      olderThanMinutes: 45,
      keepNames: ["landmark"],
    });
    expect(out.kept.map((p: ProjectFixture) => p.id)).toEqual(["match"]);
    expect(out.stale.map((p: ProjectFixture) => p.id).sort()).toEqual(["near-1", "near-2"]);
  });

  it("supports multiple keep names", () => {
    const projects: ProjectFixture[] = [
      { id: "k1", name: "alpha", created_at: ago(200) },
      { id: "k2", name: "beta", created_at: ago(200) },
      { id: "d1", name: "gamma", created_at: ago(200) },
    ];
    const out = selectStaleProjects(projects, NOW, {
      olderThanMinutes: 45,
      keepNames: ["alpha", "beta"],
    });
    expect(out.kept.map((p: ProjectFixture) => p.id).sort()).toEqual(["k1", "k2"]);
    expect(out.stale.map((p: ProjectFixture) => p.id)).toEqual(["d1"]);
  });

  it("default empty keep-list lets everything stale go (test-account intent)", () => {
    // The script's default keepNames is []. Confirm that an old
    // "landmark"-named project with no keep-list is still deleted —
    // because nothing on the dedicated CI account is landmark-worthy.
    const projects: ProjectFixture[] = [{ id: "p1", name: "landmark", created_at: ago(60) }];
    const out = selectStaleProjects(projects, NOW, { olderThanMinutes: 45, keepNames: [] });
    expect(out.stale.map((p: ProjectFixture) => p.id)).toEqual(["p1"]);
    expect(out.kept).toEqual([]);
  });
});

describe("selectStaleProjects — argument validation", () => {
  it("throws TypeError when projects is not an array", () => {
    expect(() =>
      selectStaleProjects(null as unknown as ProjectFixture[], NOW, {
        olderThanMinutes: 45,
        keepNames: [],
      }),
    ).toThrow(TypeError);
  });

  it("throws TypeError on a non-finite olderThanMinutes", () => {
    expect(() => selectStaleProjects([], NOW, { olderThanMinutes: Number.NaN, keepNames: [] })).toThrow(TypeError);
  });

  it("throws TypeError on a negative olderThanMinutes", () => {
    expect(() => selectStaleProjects([], NOW, { olderThanMinutes: -1, keepNames: [] })).toThrow(TypeError);
  });
});

describe("formatAge — display helper", () => {
  it("renders minutes for sub-hour ages", () => {
    expect(formatAge({ id: "p", name: "n", created_at: ago(5) }, NOW)).toBe("5m");
  });

  it("renders 'unknown' for missing/null/unparsable created_at", () => {
    expect(formatAge({ id: "p", name: "n" }, NOW)).toBe("unknown");
    expect(formatAge({ id: "p", name: "n", created_at: null }, NOW)).toBe("unknown");
    expect(formatAge({ id: "p", name: "n", created_at: "garbage" }, NOW)).toBe("unknown");
  });

  it("renders Hh Mm for hours-scale ages", () => {
    expect(formatAge({ id: "p", name: "n", created_at: ago(125) }, NOW)).toBe("2h5m");
  });

  it("renders Dd Hh for day-scale ages", () => {
    expect(formatAge({ id: "p", name: "n", created_at: ago(60 * 50) }, NOW)).toBe("2d2h");
  });
});
