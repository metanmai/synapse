import { dev } from "$app/environment";
import { error, fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

// This route is a Playwright test fixture — it exposes mocked scenarios and
// arbitrary fail() responses. NEVER expose in production: search engines
// will index a non-product URL and visitors will hit fake error messages
// styled like real ones. The dev() check fails fast at the load + action
// boundaries so even a crafted POST gets a 404, not a fixture response.
function assertDevOnly(): void {
  if (!dev) throw error(404);
}

// Phase 2 Plan 02-06: Playwright fixture route — mounts LinkPicker with
// scenario-driven mock props, parameterized by URL search params.
// Outside the (app) layout so no Supabase auth required.
//
// Scenarios (via ?scenario=...):
//   basic        — 1 other project, no candidates, source = "source-project"
//   with-match   — 1 other project + 1 git-remote candidate (Matched badge)
//   empty        — no other projects, no candidates (disabled trigger state)
//
// Form-action outcomes (via ?next=...):
//   success    — redirect to /__e2e/link-picker?landed=1 (proxies real redirect)
//   loading    — sleep 1500ms then return success (drives State D spinner)
//   403        — fail(403) with locked UI-SPEC §State F copy
//   404        — fail(404)
//   409        — fail(409)
//   500        — fail(500)
//   network    — fail(503)
//   (default: success)

interface Scenario {
  sourceProjectId: string;
  sourceProjectName: string;
  candidates: Array<{
    id: string;
    name: string;
    conversation_count: number;
    last_activity?: string;
    matched_by_remote: boolean;
  }>;
  allOtherProjects: Array<{
    id: string;
    name: string;
    conversation_count: number;
    matched_by_remote: boolean;
  }>;
}

function scenarioFor(name: string | null): Scenario {
  if (name === "with-match") {
    return {
      sourceProjectId: "11111111-1111-1111-1111-111111111111",
      sourceProjectName: "source-project",
      candidates: [
        {
          id: "22222222-2222-2222-2222-222222222222",
          name: "matched-project",
          conversation_count: 3,
          matched_by_remote: true,
        },
      ],
      allOtherProjects: [
        {
          id: "33333333-3333-3333-3333-333333333333",
          name: "other-project",
          conversation_count: 1,
          matched_by_remote: false,
        },
      ],
    };
  }
  if (name === "empty") {
    return {
      sourceProjectId: "11111111-1111-1111-1111-111111111111",
      sourceProjectName: "source-project",
      candidates: [],
      allOtherProjects: [],
    };
  }
  // default: basic
  return {
    sourceProjectId: "11111111-1111-1111-1111-111111111111",
    sourceProjectName: "source-project",
    candidates: [],
    allOtherProjects: [
      {
        id: "33333333-3333-3333-3333-333333333333",
        name: "target-project",
        conversation_count: 1,
        matched_by_remote: false,
      },
    ],
  };
}

export const load: PageServerLoad = ({ url }) => {
  assertDevOnly();
  const scenario = scenarioFor(url.searchParams.get("scenario"));
  return scenario;
};

// `next` lives on the *page* URL (?scenario=basic&next=403), but the form's
// `action="?/linkProject"` is a relative URL that replaces the entire query
// string per the URL spec — so by the time this handler runs, `url` is
// `/__e2e/link-picker?/linkProject` with no `next`. The Referer header still
// carries the originating page URL with its search params intact, so read
// `next` from there. Fixture-only mechanism; prod's LinkPicker doesn't use
// URL params for action wiring.
function readNextFromReferer(referer: string | null): string {
  if (!referer) return "success";
  try {
    return new URL(referer).searchParams.get("next") ?? "success";
  } catch {
    return "success";
  }
}

export const actions: Actions = {
  linkProject: async ({ request }) => {
    assertDevOnly();
    const next = readNextFromReferer(request.headers.get("referer"));
    const data = await request.formData();
    const sourceProjectId = data.get("sourceProjectId") as string;
    const targetProjectId = data.get("targetProjectId") as string;

    if (!sourceProjectId || !targetProjectId) {
      return fail(400, { linkError: "Pick a target project before linking." });
    }

    if (next === "loading") {
      await new Promise((r) => setTimeout(r, 1500));
    }

    if (next === "403") {
      return fail(403, {
        linkError: "You're not the owner of one of these projects. Only the owner can link projects.",
      });
    }
    if (next === "404") {
      return fail(404, {
        linkError: "That target project no longer exists. Refresh and pick another one.",
      });
    }
    if (next === "409") {
      return fail(409, {
        linkError: "You can't link a project to itself. Pick a different target.",
      });
    }
    if (next === "500") {
      return fail(500, {
        linkError:
          "Something went wrong on our side. Wait a moment and try again — if it keeps failing, check the project page in a few minutes.",
      });
    }
    if (next === "network") {
      return fail(503, {
        linkError: "Couldn't reach the server. Check your connection and try again.",
      });
    }

    throw redirect(303, "/__e2e/link-picker?landed=1");
  },
};
