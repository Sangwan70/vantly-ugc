// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * PATCH  /api/dashboard/prompts/:id — edit a saved prompt (full-form replace).
 * DELETE /api/dashboard/prompts/:id — remove it.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { parsePromptBody } from '@/lib/prompt-validation';
import { uploadPromptPhoto } from '@/lib/prompt-photo-upload';

type Params = { params: Promise<{ id: string }> };

const SELECT_COLUMNS =
  'id, name, pitch, script, person_mode, person_text, person_ref_id, person_ref_name, ' +
  'person_image_url, look, aspect_ratio, name_hint, captions, caption_style, music, ' +
  'music_text, broll_url, created_at, updated_at';

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

  const parsed = parsePromptBody(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: { code: 'invalid_body', message: parsed.error } }, { status: 400 });
  }
  const { fields, uploadDataUrl } = parsed.value;

  if (uploadDataUrl) {
    try {
      fields.person_image_url = await uploadPromptPhoto(supabase, user.id, uploadDataUrl);
    } catch (e) {
      return NextResponse.json({ error: { code: 'upload_failed', message: (e as Error).message } }, { status: 500 });
    }
  }

  const { data, error } = await supabase
    .from('user_prompts')
    .update(fields)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(SELECT_COLUMNS)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: { code: 'db_error', message: error.message } }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Prompt not found' } }, { status: 404 });
  }

  return NextResponse.json({ prompt: data }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: { code: 'unauthenticated', message: 'Not authenticated' } }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('user_prompts')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id')
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: { code: 'db_error', message: error.message } }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: { code: 'not_found', message: 'Prompt not found' } }, { status: 404 });
  }

  return NextResponse.json({ deleted: true });
}
