// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * POST /v1/characters/from-upload
 *
 * Turns a chat-attached image into a reusable, permanent Character in one
 * step. The image the user attaches in the agent chat lands in Supabase
 * Storage's private `generation-inputs` bucket (short-lived, 6h signed
 * URL) -- fine for a single generation call, but not something
 * user_characters.character_sheet_url can point at: downstream
 * video-generation primitives require an R2-hosted URL (SSRF guard) and
 * the signed URL would silently expire.
 *
 * So this route mirrors the image into the permanent, public R2 bucket
 * via uploadUserImageFromUrl (SSRF-hardened fetch + content moderation +
 * MIME sniffing -- the same helper the URL-based skill inputs use), then
 * inserts a `source_kind: 'upload'` user_characters row pointing at the
 * new R2 URL. A friendly name is auto-generated when the caller doesn't
 * supply one; the row can be renamed immediately afterward via the
 * existing PATCH /api/dashboard/characters/:id (name is a plain mutable
 * field there, unlike the identity fields).
 */

import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { supabase } from '../../server.js';
import { uploadUserImageFromUrl } from '../../lib/r2-upload.js';
import { ModerationError } from '../../lib/image-moderation.js';

const ADJECTIVES = [
  'Bright', 'Calm', 'Bold', 'Swift', 'Golden', 'Silver', 'Vivid', 'Gentle',
  'Sunny', 'Cosmic', 'Electric', 'Velvet', 'Amber', 'Crimson', 'Azure',
  'Lucky', 'Merry', 'Quiet', 'Rapid', 'Radiant',
];
const NOUNS = [
  'Fox', 'Falcon', 'Tiger', 'Comet', 'River', 'Maple', 'Ember', 'Harbor',
  'Willow', 'Nova', 'Wren', 'Canyon', 'Meadow', 'Otter', 'Lantern',
  'Summit', 'Breeze', 'Cedar', 'Sparrow', 'Horizon',
];

function generateFriendlyName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj} ${noun}`;
}

function generatePublicId(): string {
  return `char_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

export async function createCharacterFromUploadRoute(req: Request, res: Response): Promise<void> {
  const userId = (req as { userId?: string }).userId;
  if (!userId) {
    res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'Auth required' } });
    return;
  }

  const imageUrl = typeof req.body?.image_url === 'string' ? req.body.image_url.trim() : '';
  if (!imageUrl) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'image_url is required' } });
    return;
  }

  const requestedName = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 80) : '';

  let uploaded;
  try {
    uploaded = await uploadUserImageFromUrl(userId, imageUrl);
  } catch (err) {
    if (err instanceof ModerationError) {
      res.status(422).json({
        error: 'unsafe_content',
        code: err.code,
        message: 'The uploaded image was rejected by content moderation.',
        detail: { categories: err.categories },
      });
      return;
    }
    console.error(`[characters/from-upload] r2 mirror failed: ${(err as Error).message}`);
    res.status(422).json({
      error: { code: 'IMAGE_MIRROR_FAILED', message: 'Could not process the uploaded image.' },
    });
    return;
  }

  const name = requestedName || generateFriendlyName();
  const publicId = generatePublicId();

  const { data, error } = await supabase
    .from('user_characters')
    .insert({
      user_id: userId,
      name,
      public_id: publicId,
      source_kind: 'upload',
      source_image_url: uploaded.url,
      character_sheet_url: uploaded.url,
      thumbnail_url: uploaded.url,
    })
    .select('id, public_id, name, source_kind, character_sheet_url, thumbnail_url, created_at')
    .single();

  if (error) {
    console.error(`[characters/from-upload] insert failed: ${error.message}`);
    res.status(500).json({ error: { code: 'DATABASE_ERROR', message: 'Failed to save character' } });
    return;
  }

  res.status(201).json({
    character: {
      id: data.id,
      character_id: data.public_id,
      name: data.name,
      source_kind: data.source_kind,
      character_sheet_url: data.character_sheet_url,
      thumbnail_url: data.thumbnail_url,
      created_at: data.created_at,
    },
  });
}
