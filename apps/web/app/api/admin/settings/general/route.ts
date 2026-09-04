// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) return null;
  return user;
}

export async function GET() {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  const { data, error } = await adminClient()
    .from('site_settings')
    .select('website_name, support_email, seo_description, company_address, social_links, updated_at')
    .eq('id', 'default')
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    settings: data ?? {
      website_name: null, support_email: null, seo_description: null,
      company_address: null, social_links: {}, updated_at: null,
    },
  });
}

interface Body {
  website_name?: unknown;
  support_email?: unknown;
  seo_description?: unknown;
  company_address?: unknown;
  social_links?: unknown;
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t : null;
}

export async function PUT(req: NextRequest) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const socialLinks =
    body.social_links && typeof body.social_links === 'object' && !Array.isArray(body.social_links)
      ? body.social_links
      : undefined;

  const { data, error } = await adminClient()
    .from('site_settings')
    .upsert(
      {
        id: 'default',
        website_name: str(body.website_name),
        support_email: str(body.support_email),
        seo_description: str(body.seo_description),
        company_address: str(body.company_address),
        ...(socialLinks !== undefined ? { social_links: socialLinks } : {}),
        updated_by: user.id,
      },
      { onConflict: 'id' },
    )
    .select('website_name, support_email, seo_description, company_address, social_links, updated_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ settings: data });
}
