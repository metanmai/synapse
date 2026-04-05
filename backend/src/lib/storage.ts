import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET_NAME = "conversation-media";
const SIGNED_URL_EXPIRY = 3600; // 1 hour

export async function uploadMedia(
  db: SupabaseClient,
  conversationId: string,
  messageId: string,
  filename: string,
  content: Uint8Array,
  mimeType: string,
): Promise<string> {
  const storagePath = `conversations/${conversationId}/${messageId}/${filename}`;
  const { error } = await db.storage
    .from(BUCKET_NAME)
    .upload(storagePath, content, {
      contentType: mimeType,
      upsert: false,
    });
  if (error) throw error;
  return storagePath;
}

export async function getSignedUrl(
  db: SupabaseClient,
  storagePath: string,
): Promise<string> {
  const { data, error } = await db.storage
    .from(BUCKET_NAME)
    .createSignedUrl(storagePath, SIGNED_URL_EXPIRY);
  if (error) throw error;
  return data.signedUrl;
}

export async function deleteMedia(
  db: SupabaseClient,
  storagePaths: string[],
): Promise<void> {
  if (storagePaths.length === 0) return;
  const { error } = await db.storage.from(BUCKET_NAME).remove(storagePaths);
  if (error) throw error;
}
