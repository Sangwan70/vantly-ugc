// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { describe, expect, it, vi } from 'vitest';

// studio-access / studio-storage import the server's supabase client; stub it.
vi.mock('../server.js', () => ({ supabase: {} }));

const { presignS3Url } = await import('../lib/studio-storage.js');
const { roleCan, signedInWithSso } = await import('../lib/studio-access.js');
const { alignmentToWords } = await import('../lib/elevenlabs.js');

describe('SigV4 presigning (direct-to-bucket uploads)', () => {
  it('reproduces the AWS documentation example signature', () => {
    const url = presignS3Url(
      { endpoint: 'https://examplebucket.s3.amazonaws.com', bucket: '', region: 'us-east-1' },
      'GET', 'test.txt', {}, 86400, new Date('2013-05-24T00:00:00Z'),
      { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' },
    );
    expect(url.split('X-Amz-Signature=')[1]).toBe('aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
  });
  it('signs part uploads path-style with uploadId + partNumber', () => {
    const url = presignS3Url({ endpoint: 'https://acct.r2.cloudflarestorage.com', bucket: 'b', region: 'auto' }, 'PUT', 'studio/u/x.mp4', { partNumber: '3', uploadId: 'abc' }, 3600, new Date(), { accessKeyId: 'k', secretAccessKey: 's' });
    expect(url).toMatch(/^https:\/\/acct\.r2\.cloudflarestorage\.com\/b\/studio\/u\/x\.mp4\?/);
    expect(url).toContain('partNumber=3');
    expect(url).toContain('uploadId=abc');
  });
});

describe('workspace roles', () => {
  it('enforces the permission matrix', () => {
    expect(roleCan('viewer', 'view')).toBe(true);
    expect(roleCan('viewer', 'comment')).toBe(false);
    expect(roleCan('reviewer', 'approve')).toBe(true);
    expect(roleCan('reviewer', 'edit')).toBe(false);
    expect(roleCan('editor', 'render')).toBe(true);
    expect(roleCan('editor', 'manage')).toBe(false);
    expect(roleCan('admin', 'manage')).toBe(true);
  });
  it('detects SSO sessions from the JWT amr claim', () => {
    const jwt = (amr: unknown) => `h.${Buffer.from(JSON.stringify({ amr })).toString('base64url')}.s`;
    expect(signedInWithSso({ authToken: jwt([{ method: 'sso/saml' }]) } as never)).toBe(true);
    expect(signedInWithSso({ authToken: jwt([{ method: 'otp' }]) } as never)).toBe(false);
    expect(signedInWithSso({ authToken: 'ma_key' } as never)).toBe(true);
  });
});

describe('caption timing ignores SSML pause tags', () => {
  it('skips <break .../> in the alignment', () => {
    const text = 'Hi <break time="0.5s" /> there';
    const chars = text.split('');
    const t = chars.map((_, i) => i * 0.05);
    expect(alignmentToWords({ characters: chars, character_start_times_seconds: t, character_end_times_seconds: t }).map((w) => w.word)).toEqual(['Hi', 'there']);
  });
});
