import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// This self-hosted stack's gateway (supabase/self-host-gateway/nginx.conf)
// only proxies /auth/v1, /rest/v1, /storage/v1 — there is no Edge Functions
// runtime behind it, so supabase.functions.invoke('credits-check') below
// always 404'd here. api-v2 has its own reimplementation of this one
// function as a plain route (services/api-v2/src/routes/v1/credits-check.ts)
// — proxy straight to that instead for this name only. Every other function
// name still goes through the normal Edge Function invoke path below.
const API_V2_URL = process.env.API_V2_URL?.replace(/\/+$/, '') ?? 'https://api.vantly-ugc.com';

async function proxyCreditsCheckToApiV2(): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const upstream = await fetch(`${API_V2_URL}/v1/credits-check`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const text = await upstream.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: 'upstream_error', error_description: text.slice(0, 400) };
    }
    return NextResponse.json(data, { status: upstream.status });
  } catch (err) {
    return NextResponse.json(
      { error: 'upstream_unreachable', error_description: (err as Error).message },
      { status: 502 },
    );
  }
}

const ALLOWED_FUNCTIONS = new Set([
  'ugc-video',
  'job-status',
  'actors',
  'credits-check',
  'persona-list',
  'presigned-url',
  'upload-url',
  'usage-stats',
  'gallery-delete',
  'apikey-manage',
  'pricing',
  'checkout',
  'manage-subscription',
  'health-status',
  'cancel-subscription',
  'stripe-portal',
  'auto-topup',
  'subtitle-video',
  'billing-history',
  'feedback',
  'invite-redeem',
]);

const AUTH_REQUIRED_FUNCTIONS = new Set([
  'ugc-video',
  'job-status',
  'actors',
  'credits-check',
  'persona-list',
  'presigned-url',
  'upload-url',
  'usage-stats',
  'gallery-delete',
  'apikey-manage',
  'checkout',
  'manage-subscription',
  'health-status',
  'cancel-subscription',
  'stripe-portal',
  'auto-topup',
  'subtitle-video',
  'billing-history',
  'invite-redeem',
]);

async function edgeFunctionErrorResponse(error: unknown, fallbackStatus = 502) {
  const response = typeof error === 'object' && error !== null && 'context' in error
    ? (error as { context?: unknown }).context
    : null;

  if (response instanceof Response) {
    const status = response.status || fallbackStatus;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const body = await response.json().catch(() => null);
      if (body && typeof body === 'object') {
        return NextResponse.json(body, { status });
      }
    }

    const text = await response.text().catch(() => '');
    if (text) {
      return NextResponse.json(
        { error: 'edge_function_error', error_description: text.slice(0, 500) },
        { status },
      );
    }

    return NextResponse.json(
      { error: 'edge_function_error', error_description: `Edge Function returned HTTP ${status}` },
      { status },
    );
  }

  return NextResponse.json(
    {
      error: 'server_error',
      error_description: error instanceof Error ? error.message : 'Edge Function invocation failed',
    },
    { status: fallbackStatus },
  );
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!ALLOWED_FUNCTIONS.has(name)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (name === 'credits-check') {
    return proxyCreditsCheckToApiV2();
  }
  try {
    const supabase = await createClient();
    if (AUTH_REQUIRED_FUNCTIONS.has(name)) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json(
          { error: 'unauthorized', error_description: 'Please sign in again before continuing.' },
          { status: 401 },
        );
      }
    }
    const { data, error } = await supabase.functions.invoke(name, { method: 'GET' });
    if (error) {
      if (data && typeof data === 'object') return NextResponse.json(data, { status: 502 });
      return edgeFunctionErrorResponse(error);
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!ALLOWED_FUNCTIONS.has(name)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const supabase = await createClient();
    if (AUTH_REQUIRED_FUNCTIONS.has(name)) {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        return NextResponse.json(
          { error: 'unauthorized', error_description: 'Please sign in again before continuing.' },
          { status: 401 },
        );
      }
    }
    const { data, error } = await supabase.functions.invoke(name, { body });
    if (error) {
      if (data && typeof data === 'object') return NextResponse.json(data, { status: 502 });
      return edgeFunctionErrorResponse(error);
    }
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
