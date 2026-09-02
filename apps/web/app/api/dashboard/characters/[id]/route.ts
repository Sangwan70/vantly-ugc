// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * PATCH /api/dashboard/characters/:id
 *
 * Updates editable metadata on one of the caller's own user_characters
 * rows. Identity fields (source_image_url, character_sheet_url,
 * thumbnail_url, actor_slug, source_kind, portrait_url, seedance_seed) are
 * deliberately immutable — they ARE the character — so only the free-text
 * fields below are accepted here.
 *
 * RLS already scopes UPDATE to `auth.uid() = user_id` (see
 * supabase/migrations/20260508120000_user_characters.sql), so this route
 * uses the same cookie-session client as GET /api/dashboard/characters —
 * no service-role key needed. The `.eq('user_id', user.id)` below is
 * belt-and-suspenders on top of RLS, not a substitute for it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

type Params = { params: Promise<{ id: string }> };

const SELECT_COLUMNS =
  'id, name, source_kind, actor_slug, source_image_url, description, character_sheet_url, thumbnail_url, voice_brief, preset_default, signature_look, created_at';

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: { code: 'unauthenticated', message: 'Not authenticated' } },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'invalid_json', message: 'Invalid JSON body' } },
      { status: 400 },
    );
  }

  // Each field is optional in the body — only the ones present get
  // validated and written. `null` clears an optional field; `name`
  // cannot be cleared (it's NOT NULL on the table).
  const update: Record<string, string | null> = {};

  const stringField = (
    key: 'name' | 'description' | 'voice_brief' | 'preset_default' | 'signature_look',
    maxLen: number,
    required: boolean,
  ): NextResponse | null => {
    if (!(key in body)) return null;
    const raw = body[key];
    if (raw === null) {
      if (required) {
        return NextResponse.json(
          { error: { code: `invalid_${key}`, message: `${key} cannot be cleared` } },
          { status: 400 },
        );
      }
      update[key] = null;
      return null;
    }
    if (typeof raw !== 'string') {
      return NextResponse.json(
        { error: { code: `invalid_${key}`, message: `${key} must be a string${required ? '' : ' or null'}` } },
        { status: 400 },
      );
    }
    const trimmed = raw.trim();
    if (required && !trimmed) {
      return NextResponse.json(
        { error: { code: `invalid_${key}`, message: `${key} must not be empty` } },
        { status: 400 },
      );
    }
    if (trimmed.length > maxLen) {
      return NextResponse.json(
        { error: { code: `invalid_${key}`, message: `${key} must be ${maxLen} characters or fewer` } },
        { status: 400 },
      );
    }
    update[key] = trimmed || null;
    return null;
  };

  const errors = [
    stringField('name', 80, true),
    stringField('description', 400, false),
    stringField('voice_brief', 240, false),
    stringField('signature_look', 240, false),
    stringField('preset_default', 60, false),
  ].filter((e): e is NextResponse => e !== null);
  if (errors.length > 0) return errors[0];

  if (Object.keys(update).length === 0) {
    return NextResponse.json(
      {
        error: {
          code: 'empty_update',
          message: 'Provide at least one of: name, description, voice_brief, signature_look, preset_default',
        },
      },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from('user_characters')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: { code: 'db_error', message: error.message } }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json(
      { error: { code: 'not_found', message: 'Character not found' } },
      { status: 404 },
    );
  }

  return NextResponse.json({ character: data }, { headers: { 'Cache-Control': 'no-store' } });
}
