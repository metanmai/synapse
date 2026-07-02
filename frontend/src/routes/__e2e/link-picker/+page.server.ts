import { fail, redirect } from "@sveltejs/kit";
import type { Actions, PageServerLoad } from "./$types";

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
  const scenario = scenarioFor(url.searchParams.get("scenario"));
  return scenario;
};

export const actions: Actions = {
  linkProject: async ({ request, url }) => {
    const next = url.searchParams.get("next") ?? "success";
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
