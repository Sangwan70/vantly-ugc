// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * GET  /api/dashboard/media  — list the caller's My Media library.
 * POST /api/dashboard/media  — upload a new image/video/audio asset.
 *
 * Uploads go straight through the authenticated cookie-session Supabase
 * client to the public `user-media` Storage bucket (RLS on storage.objects
 * scopes writes to the caller's own `${user.id}/...` prefix — see
 * supabase/migrations/20260902120000_user_media.sql) — no signed-URL
 * round trip and no service-role key needed, same pattern as every other
 * route in this folder.
 *
 * Each row gets a `short_code`: a slug the user can copy-paste into any
 * script/prompt text field elsewhere in the product as a human-readable
 * reference to this asset (alongside its real URL, which is what actually
 * has to go into a script/broll_url/image field today — nothing server-side
 * parses short codes out of scripts).
 *
 * Public URL: built with publicStorageUrl() (@/lib/media-url), NOT
 * supabase.storage.from(BUCKET).getPublicUrl() — that derives from the
 * server-side client's SUPABASE_URL, which in this self-hosted deployment is
 * the internal docker-network gateway address, unreachable from a browser.
 * GET also self-heals any older row whose stored `url` was built the wrong
 * way (e.g. a bug shipped one that pointed at http://gateway:3000/...).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { publicStorageUrl } from '@/lib/media-url';

const BUCKET = 'user-media';
const MAX_BYTES = 40 * 1024 * 1024; // 40 MiB decoded
const KIND_MIME_PREFIX: Record<string, string> = { image: 'image/', video: 'video/', audio: 'audio/' };

const SELECT_COLUMNS =
  'id, kind, name, short_code, url, storage_path, mime_type, size_bytes, category, notes, created_at, updated_at';

const DIACRITIC_RE = new RegExp('[̀-ͯ]', 'g');

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .normalize('NFKD')
    .replace(DIACRITIC_RE, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return base || 'media';
}

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

interface MediaRow {
  id: string;
  kind: string;
  name: string;
  short_code: string;
  url: string;
  storage_path: string;
  mime_type: string;
  size_bytes: number;
  category: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Strip the internal-only storage_path before a row leaves this API. */
function toPublicMedia(row: MediaRow): Omit<MediaRow, 'storage_path'> {
  const { storage_path: _storage_path, ...rest } = row;
  return rest;
}

export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: { code: 'unauthenticated', message: 'Not authenticated' } }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('user_media')
    .select(SELECT_COLUMNS)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) {
    return NextResponse.json({ error: { code: 'db_error', message: error.message } }, { status: 500 });
  }

  const rows = (data ?? []) as MediaRow[];
  const fixes: PromiseLike<unknown>[] = [];
  const media = rows.map((row) => {
    const expected = publicStorageUrl(BUCKET, row.storage_path);
    if (row.url !== expected) {
      const fixed = { ...row, url: expected };
      fixes.push(supabase.from('user_media').update({ url: expected }).eq('id', row.id).then(() => undefined));
      return toPublicMedia(fixed);
    }
    return toPublicMedia(row);
  });
  if (fixes.length) {
    // Best-effort repair of rows built with the old (internal-host) URL —
    // never block the response on it.
    await Promise.allSettled(fixes);
  }

  return NextResponse.json({ media }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: { code: 'unauthenticated', message: 'Not authenticated' } }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: 'invalid_json', message: 'Invalid JSON body' } }, { status: 400 });
  }

  const kind = body.kind;
  if (kind !== 'image' && kind !== 'video' && kind !== 'audio') {
    return NextResponse.json(
      { error: { code: 'invalid_kind', message: 'kind must be one of: image, video, audio' } },
      { status: 400 },
    );
  }

  const fileBase64 = body.file_base64;
  if (typeof fileBase64 !== 'string' || fileBase64.length < 16) {
    return NextResponse.json(
      { error: { code: 'invalid_file', message: 'file_base64 is required (a data: URL or raw base64)' } },
      { status: 400 },
    );
  }

  const nameRaw = typeof body.name === 'string' ? body.name.trim() : '';
  if (!nameRaw) {
    return NextResponse.json({ error: { code: 'invalid_name', message: 'name is required' } }, { status: 400 });
  }
  if (nameRaw.length > 80) {
    return NextResponse.json({ error: { code: 'invalid_name', message: 'name must be 80 characters or fewer' } }, { status: 400 });
  }

  const category = body.category;
  const VALID_CATEGORIES = new Set(['branding', 'script', 'audio_sample', 'image', 'video', 'other']);
  if (category != null && (typeof category !== 'string' || !VALID_CATEGORIES.has(category))) {
    return NextResponse.json(
      { error: { code: 'invalid_category', message: 'category must be one of: branding, script, audio_sample, image, video, other' } },
      { status: 400 },
    );
  }

  const notes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 400) || null : null;

  // Parse a data: URL (data:image/png;base64,AAAA...) or accept raw base64 + an
  // explicit mime_type field.
  let mimeType = typeof body.mime_type === 'string' ? body.mime_type : null;
  let base64Data = fileBase64;
  const dataUrlMatch = /^data:([^;]+);base64,(.*)$/s.exec(fileBase64);
  if (dataUrlMatch) {
    mimeType = dataUrlMatch[1];
    base64Data = dataUrlMatch[2];
  }
  if (!mimeType) {
    return NextResponse.json(
      { error: { code: 'invalid_mime', message: 'mime_type is required when file_base64 is not a data: URL' } },
      { status: 400 },
    );
  }
  if (!mimeType.startsWith(KIND_MIME_PREFIX[kind])) {
    return NextResponse.json(
      { error: { code: 'kind_mime_mismatch', message: `mime_type (${mimeType}) does not match kind (${kind})` } },
      { status: 400 },
    );
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Data, 'base64');
  } catch {
    return NextResponse.json({ error: { code: 'invalid_file', message: 'file_base64 could not be decoded' } }, { status: 400 });
  }
  if (buffer.length === 0) {
    return NextResponse.json({ error: { code: 'invalid_file', message: 'Decoded file is empty' } }, { status: 400 });
  }
  if (buffer.length > MAX_BYTES) {
    return NextResponse.json(
      { error: { code: 'file_too_large', message: `File is ${Math.round(buffer.length / 1024 / 1024)}MB — the limit is ${MAX_BYTES / 1024 / 1024}MB` } },
      { status: 413 },
    );
  }

  const ext = mimeType.split('/')[1]?.replace('quicktime', 'mov').replace('mpeg', 'mp3') ?? 'bin';
  const objectId = (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${randomSuffix()}`);
  const storagePath = `${user.id}/${objectId}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: mimeType, upsert: false });
  if (uploadError) {
    return NextResponse.json({ error: { code: 'upload_failed', message: uploadError.message } }, { status: 500 });
  }

  const url = publicStorageUrl(BUCKET, storagePath);

  // Short code: user-supplied (validated) or derived from the name, with a
  // random suffix retried on collision (UNIQUE (user_id, short_code)).
  let shortCode: string;
  const suppliedCode = typeof body.short_code === 'string' ? body.short_code.trim().toLowerCase() : '';
  if (suppliedCode) {
    if (!/^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/.test(suppliedCode)) {
      await supabase.storage.from(BUCKET).remove([storagePath]);
      return NextResponse.json(
        { error: { code: 'invalid_short_code', message: 'short_code must be lowercase letters, numbers and hyphens only' } },
        { status: 400 },
      );
    }
    shortCode = suppliedCode;
  } else {
    shortCode = `${slugify(nameRaw)}-${randomSuffix()}`;
  }

  let row: MediaRow | null = null;
  let lastError: { message: string; code?: string } | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase
      .from('user_media')
      .insert({
        user_id: user.id,
        kind,
        name: nameRaw,
        short_code: shortCode,
        storage_path: storagePath,
        url,
        mime_type: mimeType,
        size_bytes: buffer.length,
        category: category ?? null,
        notes,
      })
      .select(SELECT_COLUMNS)
      .single();
    if (!error) {
      row = data as MediaRow;
      break;
    }
    lastError = error;
    // Postgres unique_violation — only retry if it was OUR generated code
    // (a user-supplied code collision should be reported, not silently changed).
    if (error.code === '23505' && !suppliedCode) {
      shortCode = `${slugify(nameRaw)}-${randomSuffix()}`;
      continue;
    }
    break;
  }

  if (!row) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    if (lastError?.code === '23505') {
      return NextResponse.json(
        { error: { code: 'short_code_taken', message: 'That short code is already in use — try another.' } },
        { status: 409 },
      );
    }
    return NextResponse.json(
      { error: { code: 'db_error', message: lastError?.message ?? 'Failed to save media' } },
      { status: 500 },
    );
  }

  return NextResponse.json({ media: toPublicMedia(row) }, { status: 201 });
}
