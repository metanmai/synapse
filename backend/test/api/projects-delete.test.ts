import { describe, expect, it } from "vitest";
import worker from "../../src/index";
import { createExecutionContext, env, waitOnExecutionContext } from "../setup";

// DELETE /api/projects/:id — owner-only project deletion. Default behavior
// is "refuse if non-empty" (409 PROJECT_NOT_EMPTY); ?force=true bypasses
// the safety check. The bug class this guards: every empty-project row
// the dashboard accumulates needs to be removable, AND deletes must
// require ownership so a shared-with-editor user can't nuke the project.

describe("DELETE /api/projects/:id — auth enforcement", () => {
  it("DELETE without auth returns 401", async () => {
    const req = new Request("http://localhost/api/projects/some-id", {
      method: "DELETE",
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("DELETE without auth returns 401 even with ?force=true", async () => {
    // The force flag MUST NOT bypass authentication — it only bypasses the
    // is-empty safety check post-auth.
    const req = new Request("http://localhost/api/projects/some-id?force=true", {
      method: "DELETE",
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });

  it("DELETE without auth returns 401 even with a UUID-shaped path", async () => {
    // Routing must not 200/204 just because the path looks well-formed.
    const req = new Request("http://localhost/api/projects/00000000-0000-0000-0000-000000000001", {
      method: "DELETE",
    });
    const ctx = createExecutionContext();
    const res = await worker.fetch(req, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
  });
});

describe("DELETE /api/projects/:id — live-DB contract (skipped in unit env)", () => {
  // Live-DB tests verify the actual cascade + safety semantics. Run manually
  // against the dogfood Supabase or via the e2e CI job — same `.skip` convention
  // the merge tests use.

  it.skip("returns 200 + { ok: true, deleted_project_id, name } when project is empty and user is owner", async () => {
    // Contract: status 200, body shape proves the row is gone AND the response
    // echoes the name so a CLI/UI can confirm the right project was hit.
    // Post-condition: GET /api/projects/:id 404s, project_members row gone.
  });

  it.skip("returns 409 PROJECT_NOT_EMPTY when project has conversations or insights and ?force is absent", async () => {
    // Critical safety contract: a user-driven DELETE must NOT silently destroy
    // data. The 409 body MUST include conversation_count + insight_count so
    // the caller can decide how to proceed (merge into another project, or
    // pass ?force=true to accept the loss).
  });

  it.skip("returns 200 with ?force=true even when project has conversations", async () => {
    // The escape hatch contract: an authenticated owner can always delete
    // their own project — no data is more important than user agency.
    // Post-condition: cascade has fired across conversations, insights,
    // entries, activity_log, project_members, share_links, and the
    // handoff_* family.
  });

  it.skip("returns 403 when user is NOT an owner of the project", async () => {
    // Security contract: an editor on a shared project can append data but
    // CANNOT destroy the project. requireRole("owner") enforces this; same
    // gate as POST /merge-into and DELETE /:id/members/:email.
  });

  it.skip("returns 404 when project does not exist", async () => {
    // The requireRole call should produce a NotFoundError that maps to 404
    // (matches the existing convention in other routes).
  });

  it.skip("cascade removes all child rows in one transaction (no orphans)", async () => {
    // Bug class: a project DELETE must be atomic across the FK tree so a
    // failure halfway through doesn't leave the system in a state where the
    // project is gone but its conversations / share_links still exist (would
    // be unreachable but consume tier quota and complicate audit).
    //
    // Verification: BEFORE delete, seed the project with rows in
    // conversations + insights + entries + share_links + activity_log +
    // handoff_events. AFTER ?force=true delete, all rows whose project_id
    // matches MUST be gone from every child table.
  });
});
