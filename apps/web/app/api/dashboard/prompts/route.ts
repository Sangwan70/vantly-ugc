// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * GET  /api/dashboard/prompts — list the caller's saved My Prompts presets.
 * POST /api/dashboard/prompts — create one.
 *
 * These are CRUD-only: creating or editing a prompt here never calls
 * make_ugc. A saved prompt is picked up and run from the agent chat
 * (/dashboard/agent's "+" menu → "Use a saved prompt", which drops it into
 * the composer as a normal message) — see supabase/migrations/
 * 20260903120000_user_prompts.sql for why the tab and the run path are
 * kept separate.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { parsePromptBody } from '@/lib/prompt-validation';
import { uploadPromptPhoto } from '@/lib/prompt-photo-upload';

const SELECT_COLUMNS =
  'id, name, pitch, script, person_mode, person_text, person_ref_id, person_ref_name, ' +
  'person_image_url, look, aspect_ratio, name_hint, captions, caption_style, music, ' +
  'music_text, broll_url, created_at, updated_at';

export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: { code: 'unauthenticated', message: 'Not authenticated' } }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('user_prompts')
    .select(SELECT_COLUMNS)
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: { code: 'db_error', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ prompts: data ?? [] }, { headers: { 'Cache-Control': 'no-store' } });
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
    .insert({ ...fields, user_id: user.id })
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    return NextResponse.json({ error: { code: 'db_error', message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ prompt: data }, { status: 201 });
}
