// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * PATCH  /api/dashboard/media/:id — edit name/short_code/category/notes.
 * DELETE /api/dashboard/media/:id — remove the storage object + row.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const BUCKET = 'user-media';
type Params = { params: Promise<{ id: string }> };

const SELECT_COLUMNS =
  'id, kind, name, short_code, url, mime_type, size_bytes, category, notes, created_at, updated_at';
const VALID_CATEGORIES = new Set(['branding', 'script', 'audio_sample', 'image', 'video', 'other']);

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
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

  const update: Record<string, string | null> = {};

  if ('name' in body) {
    const name = body.name;
    if (typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: { code: 'invalid_name', message: 'name must not be empty' } }, { status: 400 });
    }
    if (name.trim().length > 80) {
      return NextResponse.json({ error: { code: 'invalid_name', message: 'name must be 80 characters or fewer' } }, { status: 400 });
    }
    update.name = name.trim();
  }

  if ('short_code' in body) {
    const code = body.short_code;
    if (typeof code !== 'string' || !/^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/.test(code)) {
      return NextResponse.json(
        { error: { code: 'invalid_short_code', message: 'short_code must be lowercase letters, numbers and hyphens only' } },
        { status: 400 },
      );
    }
    update.short_code = code;
  }

  if ('category' in body) {
    const category = body.category;
    if (category !== null && (typeof category !== 'string' || !VALID_CATEGORIES.has(category))) {
      return NextResponse.json(
        { error: { code: 'invalid_category', message: 'category must be one of: branding, script, audio_sample, image, video, other' } },
        { status: 400 },
      );
    }
    update.category = category;
  }

  if ('notes' in body) {
    const notes = body.notes;
    if (notes !== null && typeof notes !== 'string') {
      return NextResponse.json({ error: { code: 'invalid_notes', message: 'notes must be a string or null' } }, { status: 400 });
    }
    if (typeof notes === 'string' && notes.length > 400) {
      return NextResponse.json({ error: { code: 'invalid_notes', message: 'notes must be 400 characters or fewer' } }, { status: 400 });
    }
    update.notes = typeof notes === 'string' ? notes.trim() || null : null;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      { error: { code: 'empty_update', message: 'Provide at least one of: name, short_code, category, notes' } },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from('user_media')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json(
        { error: { code: 'short_code_taken', message: 'That short code is already in use — try another.' } },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: { code: 'db_error', message: error.message } }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Media not found' } }, { status: 404 });
  }

  return NextResponse.json({ media: data }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: { code: 'unauthenticated', message: 'Not authenticated' } }, { status: 401 });
  }

  const { data: existing, error: findError } = await supabase
    .from('user_media')
    .select('id, storage_path')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (findError) {
    return NextResponse.json({ error: { code: 'db_error', message: findError.message } }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Media not found' } }, { status: 404 });
  }

  const { error: deleteError } = await supabase
    .from('user_media')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (deleteError) {
    return NextResponse.json({ error: { code: 'db_error', message: deleteError.message } }, { status: 500 });
  }

  // Best-effort object cleanup — the row is already gone even if this fails,
  // so a storage error here is reported but not treated as a failed delete.
  const { error: storageError } = await supabase.storage.from(BUCKET).remove([existing.storage_path]);

  return NextResponse.json({ deleted: true, storage_warning: storageError?.message ?? null });
}
