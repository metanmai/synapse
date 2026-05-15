import type { Env } from "../lib/env";
import { createSupabaseClient } from "../db/client";
import type { GoogleOAuthTokens } from "../db/types";
import { upsertEntry } from "../db/queries/entries";
import { getAccessToken } from "./google-auth";

interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
}

interface GoogleDriveListResponse {
  files: GoogleDriveFile[];
}

async function listDriveFiles(
  accessToken: string,
  folderId: string,
  modifiedAfter?: string
): Promise<GoogleDriveFile[]> {
  let query = `'${folderId}' in parents and trashed=false`;
  if (modifiedAfter) {
    query += ` and modifiedTime > '${modifiedAfter}'`;
  }

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,mimeType,modifiedTime)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const data = await res.json() as GoogleDriveListResponse;
  return data.files ?? [];
}

async function getFileContent(accessToken: string, fileId: string): Promise<string> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return res.text();
}

async function walkDriveFolder(
  accessToken: string,
  folderId: string,
  basePath: string,
  modifiedAfter?: string
): Promise<{ path: string; content: string; googleDocId: string }[]> {
  const files = await listDriveFiles(accessToken, folderId, modifiedAfter);
  const results: { path: string; content: string; googleDocId: string }[] = [];

  for (const file of files) {
    const filePath = basePath ? `${basePath}/${file.name}` : file.name;

    if (file.mimeType === "application/vnd.google-apps.folder") {
      const nested = await walkDriveFolder(accessToken, file.id, filePath, modifiedAfter);
      results.push(...nested);
    } else {
      const content = await getFileContent(accessToken, file.id);
      results.push({ path: filePath, content, googleDocId: file.id });
    }
  }

  return results;
}

export async function syncProjectFromGoogle(env: Env, projectId: string): Promise<{ synced: number }> {
  const db = createSupabaseClient(env);

  const { data: project } = await db
    .from("projects")
    .select("*, users!projects_owner_id_fkey(google_oauth_tokens)")
    .eq("id", projectId)
    .single();

  if (!project?.google_drive_folder_id) {
    throw new Error("Project has no linked Google Drive folder");
  }

  const tokens = (project as unknown as { users?: { google_oauth_tokens?: GoogleOAuthTokens } }).users?.google_oauth_tokens ?? null;
  if (!tokens) throw new Error("Project owner has not connected Google");

  const accessToken = await getAccessToken(env, tokens);

  // Update tokens if refreshed
  await db.from("users").update({ google_oauth_tokens: tokens }).eq("id", project.owner_id);

  // Look for files modified in the last 10 minutes (overlaps with 5-min cron for safety)
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const files = await walkDriveFolder(
    accessToken,
    project.google_drive_folder_id,
    "",
    tenMinutesAgo
  );

  let synced = 0;
  for (const file of files) {
    await upsertEntry(db, {
      project_id: projectId,
      path: file.path,
      content: file.content,
      source: "google_docs",
    });

    // Link google_doc_id
    await db
      .from("entries")
      .update({ google_doc_id: file.googleDocId })
      .eq("project_id", projectId)
      .eq("path", file.path);

    synced++;
  }

  return { synced };
}

export async function runScheduledGoogleSync(env: Env): Promise<void> {
  const db = createSupabaseClient(env);

  // Find all projects with Google Drive linked
  const { data: projects } = await db
    .from("projects")
    .select("id")
    .not("google_drive_folder_id", "is", null);

  for (const project of projects ?? []) {
    try {
      await syncProjectFromGoogle(env, project.id);
    } catch (err) {
      console.error(`Google sync failed for project ${project.id}:`, err);
    }
  }
}
