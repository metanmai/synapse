import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../../lib/env";
import type { GetMcpContext } from "../agent";
import { createSupabaseClient } from "../../db/client";
import {
  createProject,
  listProjectsForUser,
  getProjectByName,
  getMemberRole,
  addMember,
  removeMember,
} from "../../db/queries/projects";
import { findUserByEmail } from "../../db/queries/users";
import { setPreference } from "../../db/queries/preferences";

export function registerProjectManagementTools(server: McpServer, env: Env, getContext: GetMcpContext) {
  server.tool(
    "create_project",
    "Create a new project workspace for organizing context. You become the owner.",
    { name: z.string().describe("Project name") },
    async ({ name }) => {
      const db = createSupabaseClient(env);
      const userId = getContext().userId!;
      const project = await createProject(db, name, userId);
      return {
        content: [{ type: "text", text: `Project "${project.name}" created (id: ${project.id})` }],
      };
    }
  );

  server.tool(
    "list_projects",
    "List all projects you have access to.",
    {},
    async (_args) => {
      const db = createSupabaseClient(env);
      const userId = getContext().userId!;
      const projects = await listProjectsForUser(db, userId);
      const list = projects.map((p) => `- ${p.name} (id: ${p.id})`).join("\n");
      return {
        content: [{ type: "text", text: list || "No projects found." }],
      };
    }
  );

  server.tool(
    "invite_member",
    "Invite a team member to a project by email. They'll be able to access shared context.",
    {
      project: z.string().describe("Project name"),
      email: z.string().email().describe("Email of the person to invite"),
      role: z.enum(["editor", "viewer"]).describe("Role: 'editor' can read/write, 'viewer' can only read"),
    },
    async ({ project, email, role }) => {
      const db = createSupabaseClient(env);
      const userId = getContext().userId!;

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

      const callerRole = await getMemberRole(db, proj.id, userId);
      if (callerRole !== "owner") {
        return { content: [{ type: "text", text: "Only project owners can invite members." }] };
      }

      const invitee = await findUserByEmail(db, email);
      if (!invitee) {
        return { content: [{ type: "text", text: `No user found with email ${email}. They need to sign up first.` }] };
      }

      await addMember(db, proj.id, invitee.id, role);
      return {
        content: [{ type: "text", text: `Invited ${email} as ${role} to "${project}".` }],
      };
    }
  );

  server.tool(
    "remove_member",
    "Remove a team member from a project.",
    {
      project: z.string().describe("Project name"),
      email: z.string().email().describe("Email of the person to remove"),
    },
    async ({ project, email }) => {
      const db = createSupabaseClient(env);
      const userId = getContext().userId!;

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

      const callerRole = await getMemberRole(db, proj.id, userId);
      if (callerRole !== "owner") {
        return { content: [{ type: "text", text: "Only project owners can remove members." }] };
      }

      const target = await findUserByEmail(db, email);
      if (!target) {
        return { content: [{ type: "text", text: `No user found with email ${email}.` }] };
      }

      await removeMember(db, proj.id, target.id);
      return {
        content: [{ type: "text", text: `Removed ${email} from "${project}".` }],
      };
    }
  );

  server.tool(
    "set_preference",
    "Set a user preference for a project. Keys: 'auto_capture' (aggressive|moderate|manual_only), 'context_loading' (full|smart|on_demand|summary_only).",
    {
      project: z.string().describe("Project name"),
      key: z.string().describe("Preference key"),
      value: z.string().describe("Preference value"),
    },
    async ({ project, key, value }) => {
      const db = createSupabaseClient(env);
      const userId = getContext().userId!;

      const proj = await getProjectByName(db, project, userId);
      if (!proj) return { content: [{ type: "text", text: `Project "${project}" not found.` }] };

      const prefs = await setPreference(db, userId, proj.id, key, value);
      return {
        content: [{ type: "text", text: `Set ${key} = ${value} for project "${project}".` }],
      };
    }
  );
}
