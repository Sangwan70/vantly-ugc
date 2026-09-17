// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.
//
// Milestone 1, item 2 (Video Generation Flow audit): agentRoute's retry
// behavior used to only cover a 200-with-empty-content[] response. A 60s
// timeout or a thrown network error on the FIRST call went straight to the
// client with zero retry -- this pins the generalized behavior: retry once,
// same model, on ANY first-attempt failure (thrown or ok:false), same as the
// empty-content case already covered before this change.

import { afterEach, describe, expect, it, vi } from 'vitest';

// agent.ts pulls in ../../server.js (Express app setup, Sentry, env
// assertions) purely for its `supabase` export -- stub it the same way
// list-characters.test.ts / cancel-refund.test.ts do, so this test never
// pays for or depends on that setup.
vi.mock('../server.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          is: () => ({
            order: () => ({
              limit: () => Promise.resolve({ data: [], error: null }),
            }),
          }),
        }),
      }),
    }),
  },
}));

const { agentRoute } = await import('../routes/v1/agent.js');

function mockReq(overrides: Record<string, unknown> = {}) {
  return {
    userId: 'user-1',
    body: { messages: [{ role: 'user', content: 'make a video' }] },
    headers: {},
    ...overrides,
  } as never;
}

function mockRes() {
  const res: { statusCode?: number; body?: unknown; status: (c: number) => typeof res; json: (b: unknown) => typeof res } = {
    status(c: number) {
      res.statusCode = c;
      return res;
    },
    json(b: unknown) {
      res.body = b;
      return res;
    },
  };
  return res;
}

function anthropicOk(text = 'ok'): Response {
  return new Response(
    JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text }] }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('agentRoute retry (Milestone 1: generalized past empty-content[] only)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('retries once and succeeds when the first attempt THROWS (timeout/network)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'TimeoutError' }))
      .mockResolvedValueOnce(anthropicOk('second attempt worked'));
    vi.stubGlobal('fetch', fetchMock);

    const res = mockRes();
    await agentRoute(mockReq(), res as never);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(200);
    const body = res.body as { content: Array<{ text?: string }> };
    expect(body.content[0]?.text).toBe('second attempt worked');
  });

  it('retries once and succeeds when the first attempt returns a 5xx (ok:false)', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('upstream down', { status: 503 }))
      .mockResolvedValueOnce(anthropicOk('recovered'));
    vi.stubGlobal('fetch', fetchMock);

    const res = mockRes();
    await agentRoute(mockReq(), res as never);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(200);
  });

  it('reports a 502 once BOTH attempts fail, without a third try', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const fetchMock = vi.fn().mockRejectedValue(new Error('connection reset'));
    vi.stubGlobal('fetch', fetchMock);

    const res = mockRes();
    await agentRoute(mockReq(), res as never);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(502);
  });

  it('never retries when the first attempt already succeeds', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    const fetchMock = vi.fn().mockResolvedValueOnce(anthropicOk('first try'));
    vi.stubGlobal('fetch', fetchMock);

    const res = mockRes();
    await agentRoute(mockReq(), res as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });
});
