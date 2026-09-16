import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { randomUUID } from 'node:crypto';

// This self-hosted stack's gateway (supabase/self-host-gateway/nginx.conf)
// only proxies /auth/v1, /rest/v1, /storage/v1 — there is no Edge Functions
// runtime behind it, so supabase.functions.invoke(...) below always 404'd
// for every one of these names. api-v2 has its own reimplementation of each
// as a plain route (services/api-v2/src/routes/v1/credits-check.ts and
// services/api-v2/src/routes/v1/billing/*.ts) — proxy straight to those
// instead. Every other function name still goes through the normal Edge
// Function invoke path below (this self-hosted deployment simply doesn't
// use those other functions today).
const API_V2_URL = process.env.API_V2_URL?.replace(/\/+$/, '') ?? 'https://api.vantly-ugc.com';

// Map of Edge-Function name -> its api-v2 path, for every name this
// self-hosted deployment has ported off Edge Functions so far.
const API_V2_ROUTES: Record<string, string> = {
  'credits-check': '/v1/credits-check',
  checkout: '/v1/billing/checkout',
  'cancel-subscription': '/v1/billing/cancel-subscription',
  'stripe-portal': '/v1/billing/stripe-portal',
  'billing-history': '/v1/billing/billing-history',
  'auto-topup': '/v1/billing/auto-topup',
};

async function proxyToApiV2(name: string, method: 'GET' | 'POST', body?: unknown): Promise<NextResponse> {
  const path = API_V2_ROUTES[name];
  const supabase = await createClient();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  try {
    const upstream = await fetch(`${API_V2_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
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

// upload-url is fundamentally a Supabase Storage operation (create a
// signed upload URL for a user-owned object in the private
// `generation-inputs` bucket) -- and /storage/v1 IS proxied by this
// self-hosted gateway, unlike the Edge Functions runtime. So instead of
// routing this through api-v2 (like API_V2_ROUTES above) or falling
// through to the always-404ing supabase.functions.invoke(...), handle it
// directly here with the per-request, user-authenticated Supabase client.
async function handleUploadUrl(body: unknown): Promise<NextResponse> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json(
      { error: 'unauthorized', error_description: 'Please sign in again before continuing.' },
      { status: 401 },
    );
  }

  const filename = typeof (body as { filename?: unknown })?.filename === 'string'
    ? (body as { filename: string }).filename
    : 'upload';
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200) || 'upload';
  const storagePath = `${user.id}/${randomUUID()}-${safeName}`;

  const { data, error } = await supabase.storage
    .from('generation-inputs')
    .createSignedUploadUrl(storagePath);

  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { error: 'sign_failed', error_description: error?.message ?? 'Failed to create upload URL' },
      { status: 500 },
    );
  }

  return NextResponse.json({ upload_url: data.signedUrl, storage_path: data.path });
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
  if (name in API_V2_ROUTES) {
    return proxyToApiV2(name, 'GET');
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
  const body = await req.json().catch(() => ({}));
  if (name === 'upload-url') {
    return handleUploadUrl(body);
  }
  if (name in API_V2_ROUTES) {
    return proxyToApiV2(name, 'POST', body);
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
