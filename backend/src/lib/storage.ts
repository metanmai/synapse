import type { SupabaseClient } from "@supabase/supabase-js";
import { MEDIA_BUCKET, SIGNED_URL_EXPIRY_SECONDS } from "./constants";

export async function uploadMedia(
  db: SupabaseClient,
  conversationId: string,
  messageId: string,
  filename: string,
  content: Uint8Array,
  mimeType: string,
): Promise<string> {
  const storagePath = `conversations/${conversationId}/${messageId}/${filename}`;
  const { error } = await db.storage.from(MEDIA_BUCKET).upload(storagePath, content, {
    contentType: mimeType,
    upsert: false,
  });
  if (error) throw error;
  return storagePath;
}

export async function getSignedUrl(db: SupabaseClient, storagePath: string): Promise<string> {
  const { data, error } = await db.storage.from(MEDIA_BUCKET).createSignedUrl(storagePath, SIGNED_URL_EXPIRY_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteMedia(db: SupabaseClient, storagePaths: string[]): Promise<void> {
  if (storagePaths.length === 0) return;
  const { error } = await db.storage.from(MEDIA_BUCKET).remove(storagePaths);
  if (error) throw error;
}
