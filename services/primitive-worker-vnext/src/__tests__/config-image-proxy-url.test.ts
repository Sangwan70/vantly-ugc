// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.
//
// Regression test for the imageProxyUrl fallback chain (config.ts): a
// self-host deploy via docker-compose.yml never sets API_V2_INTERNAL_URL
// (only the hosted Railway deployment did), so getConfig() used to fall
// straight through to a '.railway.internal' literal that cannot resolve
// outside Railway's own private network -- silently breaking every
// character_sheet_gpt2 / portrait_gpt2 image call on a self-hosted stack.
// docker-compose.yml already sets API_V2_URL correctly on this exact
// service, so it's now the second choice before that Railway-only literal.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConfig } from '../config.js';

const ENV_KEYS = [
  'SIMULATE_OPENAI',
  'TEMPORAL_ADDRESS',
  'TEMPORAL_NAMESPACE',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'S3_ENDPOINT',
  'API_V2_INTERNAL_URL',
  'API_V2_URL',
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  // A minimal, valid config baseline (simulate mode sidesteps the
  // ANTHROPIC/OPENAI/INTERNAL_API_SECRET requirement entirely).
  process.env.SIMULATE_OPENAI = 'true';
  process.env.TEMPORAL_ADDRESS = 'localhost:7233';
  process.env.TEMPORAL_NAMESPACE = 'default';
  process.env.SUPABASE_URL = 'https://example.supabase.local';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.R2_ACCESS_KEY_ID = 'test-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
  process.env.S3_ENDPOINT = 'http://minio:9000';
  delete process.env.API_V2_INTERNAL_URL;
  delete process.env.API_V2_URL;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('getConfig().openai.imageProxyUrl fallback chain', () => {
  it('uses API_V2_URL (the value docker-compose.yml actually sets) when API_V2_INTERNAL_URL is unset', () => {
    process.env.API_V2_URL = 'http://api-v2:3001';
    expect(getConfig().openai.imageProxyUrl).toBe('http://api-v2:3001');
  });

  it('prefers an explicit API_V2_INTERNAL_URL over API_V2_URL when both are set', () => {
    process.env.API_V2_INTERNAL_URL = 'http://api-v2.railway.internal:3001';
    process.env.API_V2_URL = 'http://api-v2:3001';
    expect(getConfig().openai.imageProxyUrl).toBe('http://api-v2.railway.internal:3001');
  });

  it('falls back to the Railway-only literal only when NEITHER var is set', () => {
    expect(getConfig().openai.imageProxyUrl).toBe('http://api-v2.railway.internal:3001');
  });
});
