// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * GET /api/dashboard/characters/:id/download
 *
 * Forces a real file download of a character's image (character_sheet_url)
 * instead of the browser just navigating to the R2 URL — a plain
 * `<a href download>` doesn't reliably force a download for a
 * cross-origin URL (R2 is a different origin than app.vantly-ugc.com), so
 * this proxies the bytes through our own origin with a Content-Disposition:
 * attachment header, which every browser honors regardless of origin.
 *
 * :id is either a real user_characters.id (the caller must own it) or a
 * `share-<character_shares.id>` id (see GET /api/dashboard/characters —
 * the same prefix convention that route uses for merged-in shared rows),
 * which the caller must have been the recipient of. Either way, ownership
 * is re-checked here — never trust the id alone.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function contentTypeFor(url: string): string {
  if (/\.png(\?|$)/i.test(url)) return 'image/png';
  if (/\.(jpe?g)(\?|$)/i.test(url)) return 'image/jpeg';
  if (/\.webp(\?|$)/i.test(url)) return 'image/webp';
  if (/\.gif(\?|$)/i.test(url)) return 'image/gif';
  return 'application/octet-stream';
}

function filenameFor(name: string | null, url: string): string {
  const ext = contentTypeFor(url) === 'image/jpeg' ? 'jpg'
    : contentTypeFor(url) === 'image/webp' ? 'webp'
    : contentTypeFor(url) === 'image/gif' ? 'gif'
    : 'png';
  const base = (name ?? 'character').trim().replace(/[^a-z0-9\- _]/gi, '').slice(0, 60) || 'character';
  return `${base}.${ext}`;
}

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: { code: 'unauthenticated' } }, { status: 401 });
  }

  let imageUrl: string | null = null;
  let name: string | null = null;

  if (id.startsWith('share-')) {
    const shareId = id.slice('share-'.length);
    const admin = adminClient();
    const { data, error } = await admin
      .from('character_shares')
      .select('shared_with_user_id, name, character_sheet_url')
      .eq('id', shareId)
      .maybeSingle();
    if (error || !data || data.shared_with_user_id !== user.id) {
      return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    }
    imageUrl = data.character_sheet_url as string;
    name = (data.name as string | null) ?? null;
  } else {
    const { data, error } = await supabase
      .from('user_characters')
      .select('user_id, name, character_sheet_url')
      .eq('id', id)
      .maybeSingle();
    if (error || !data || data.user_id !== user.id) {
      return NextResponse.json({ error: { code: 'not_found' } }, { status: 404 });
    }
    imageUrl = data.character_sheet_url as string;
    name = (data.name as string | null) ?? null;
  }

  if (!imageUrl) {
    return NextResponse.json({ error: { code: 'no_image' } }, { status: 404 });
  }

  try {
    const upstream = await fetch(imageUrl);
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json({ error: { code: 'fetch_failed', status: upstream.status } }, { status: 502 });
    }
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        'Content-Type': contentTypeFor(imageUrl),
        'Content-Disposition': `attachment; filename="${filenameFor(name, imageUrl)}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    return NextResponse.json({ error: { code: 'proxy_failed', message: (err as Error).message } }, { status: 502 });
  }
}
