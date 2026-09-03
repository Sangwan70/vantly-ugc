// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Uploads a freshly-picked "upload a photo" data: URL from the My Prompts
 * wizard into the same public `user-media` Storage bucket My Media uses
 * (supabase/migrations/20260902120000_user_media.sql), under this user's
 * own `${user.id}/prompt-photos/...` prefix so it satisfies the bucket's
 * existing per-user RLS policy without needing one of its own.
 *
 * Keeps the base64 payload out of the database — user_prompts.person_image_url
 * stores a plain https URL either way, whether the photo came from a saved
 * character/actor or from this upload path.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { publicStorageUrl } from './media-url';

const BUCKET = 'user-media';
const MAX_BYTES = 20 * 1024 * 1024; // 15 MiB decoded — a face photo, not a video

export async function uploadPromptPhoto(
  supabase: SupabaseClient,
  userId: string,
  dataUrl: string,
): Promise<string> {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error('Photo must be a data: URL');
  const mimeType = match[1];
  if (!mimeType.startsWith('image/')) throw new Error('Photo must be an image');

  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.length === 0) throw new Error('Photo is empty');
  if (buffer.length > MAX_BYTES) {
    throw new Error(`Photo is ${Math.round(buffer.length / 1024 / 1024)}MB — the limit is ${MAX_BYTES / 1024 / 1024}MB`);
  }

  const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'bin';
  const objectId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const storagePath = `${userId}/prompt-photos/${objectId}.${ext}`;

  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType: mimeType,
    upsert: false,
  });
  if (error) throw new Error(error.message);

  return publicStorageUrl(BUCKET, storagePath);
}
