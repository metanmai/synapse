import { describe, expect, it } from "vitest";
import {
  chooseMergeTarget,
  decideAssignment,
  isStableCandidate,
  isSyntheticProjectName,
  orderPair,
} from "../../src/lib/project-correlation";

describe("decideAssignment", () => {
  const t = { assign: 0.82, create: 0.65 };

  it("creates when there are no candidates", () => {
    expect(decideAssignment([], t)).toEqual({ action: "create", confidence: 0 });
  });

  it("creates when the top candidate is below the create floor", () => {
    expect(decideAssignment([{ projectId: "p", score: 0.5 }], t).action).toBe("create");
  });

  it("assigns (ambiguous) in the middle band, carrying the score", () => {
    const r = decideAssignment([{ projectId: "p", score: 0.7 }], t);
    expect(r).toMatchObject({ action: "assign", projectId: "p", confidence: 0.7 });
  });

  it("assigns (confident) at or above the assign threshold", () => {
    expect(decideAssignment([{ projectId: "p", score: 0.9 }], t).action).toBe("assign");
  });

  it("picks the highest-scoring candidate regardless of input order", () => {
    const r = decideAssignment(
      [
        { projectId: "a", score: 0.7 },
        { projectId: "b", score: 0.88 },
      ],
      t,
    );
    expect(r.projectId).toBe("b");
  });
});

describe("isSyntheticProjectName", () => {
  it("flags cwd hashes, capture hosts, and the provisional placeholder", () => {
    expect(isSyntheticProjectName("cwd_a1b2c3d4e5f6")).toBe(true);
    expect(isSyntheticProjectName("chatgpt.com")).toBe(true);
    expect(isSyntheticProjectName("claude.ai")).toBe(true);
    expect(isSyntheticProjectName("New project")).toBe(true);
  });

  it("does not flag real project names", () => {
    expect(isSyntheticProjectName("synapse")).toBe(false);
    expect(isSyntheticProjectName("octopay")).toBe(false);
  });
});

describe("chooseMergeTarget (real project absorbs synthetic buckets)", () => {
  const real = { id: "r", name: "synapse", createdAt: 200 };
  const bucket = { id: "b", name: "chatgpt.com", createdAt: 100 };

  it("keeps the real project even when it is newer than the bucket", () => {
    const { target, source } = chooseMergeTarget(real, bucket);
    expect(target.id).toBe("r");
    expect(source.id).toBe("b");
  });

  it("is symmetric in argument order", () => {
    expect(chooseMergeTarget(bucket, real).target.id).toBe("r");
  });

  it("when both are real, the earliest-created survives", () => {
    const a = { id: "a", name: "alpha", createdAt: 50 };
    const b = { id: "b", name: "beta", createdAt: 60 };
    expect(chooseMergeTarget(a, b).target.id).toBe("a");
  });

  it("when both are synthetic, the earliest-created survives", () => {
    const a = { id: "a", name: "chatgpt.com", createdAt: 80 };
    const b = { id: "b", name: "claude.ai", createdAt: 40 };
    expect(chooseMergeTarget(a, b).target.id).toBe("b");
  });
});

describe("orderPair / isStableCandidate", () => {
  it("orders a pair deterministically by id", () => {
    expect(orderPair("z", "a")).toEqual(["a", "z"]);
    expect(orderPair("a", "z")).toEqual(["a", "z"]);
  });

  it("is stable only if first seen strictly before this run", () => {
    expect(isStableCandidate(100, 200)).toBe(true);
    expect(isStableCandidate(200, 200)).toBe(false);
    expect(isStableCandidate(300, 200)).toBe(false);
  });
});
