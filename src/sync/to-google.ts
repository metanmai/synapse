import type { Env } from "../lib/env";
import { createSupabaseClient } from "../db/client";
import type { Entry, GoogleOAuthTokens } from "../db/types";
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

async function ensureDriveFolder(
  accessToken: string,
  parentId: string,
  folderName: string
): Promise<string> {
  // Check if folder exists
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
      `'${parentId}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
    )}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  const searchData = await searchRes.json() as GoogleDriveListResponse;

  if (searchData.files?.length > 0) {
    return searchData.files[0].id;
  }

  // Create folder
  const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    }),
  });
  const created = await createRes.json() as GoogleDriveFile;
  return created.id;
}

async function upsertGoogleDoc(
  accessToken: string,
  folderId: string,
  entry: Entry
): Promise<string> {
  const fileName = entry.path.split("/").pop() ?? entry.path;

  if (entry.google_doc_id) {
    // Update existing doc
    await fetch(
      `https://www.googleapis.com/upload/drive/v3/files/${entry.google_doc_id}?uploadType=media`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "text/plain",
        },
        body: entry.content,
      }
    );
    return entry.google_doc_id;
  }

  // Create new file
  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: entry.content_type === "json" ? "application/json" : "text/plain",
  };

  const boundary = "mcp_sync_boundary";
  const body = `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: text/plain\r\n\r\n${entry.content}\r\n--${boundary}--`;

  const res = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
  const created = await res.json() as GoogleDriveFile;
  return created.id;
}

export async function syncProjectToGoogle(env: Env, projectId: string): Promise<{ synced: number }> {
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

  const { data: entries } = await db
    .from("entries")
    .select("*")
    .eq("project_id", projectId);

  let synced = 0;
  for (const entry of entries ?? []) {
    // Ensure folder path exists in Drive
    const pathParts = entry.path.split("/");
    let currentFolderId = project.google_drive_folder_id;

    for (let i = 0; i < pathParts.length - 1; i++) {
      currentFolderId = await ensureDriveFolder(accessToken, currentFolderId, pathParts[i]);
    }

    const googleDocId = await upsertGoogleDoc(accessToken, currentFolderId, entry as Entry);

    // Store the Google Doc ID on the entry
    if (!entry.google_doc_id) {
      await db.from("entries").update({ google_doc_id: googleDocId }).eq("id", entry.id);
    }

    synced++;
  }

  return { synced };
}
