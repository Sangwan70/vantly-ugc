// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Voiceover Studio storage: data-residency regions + direct-to-bucket
 * multipart uploads (recordings up to 5 GB never pass through api-v2).
 *
 * Regions: STUDIO_STORAGE_REGIONS='{"eu":{"bucket":"vantly-eu","publicUrl":"https://eu-media.example.com"}}'
 * Every region shares the R2_* / S3_* credentials and endpoint (override
 * per region with "endpoint"). The default region is R2_BUCKET/R2_PUBLIC_URL.
 *
 * Browser uploads PUT each part to a presigned URL, so the bucket's CORS must
 * allow PUT from the dashboard origin and EXPOSE the ETag header.
 */

import {
  S3Client,
  PutObjectCommand,
  CreateMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { createHash, createHmac, randomUUID } from 'node:crypto';

export interface StudioRegion {
  key: string;
  bucket: string;
  publicUrl: string;
  endpoint: string;
  region: string;
  forcePathStyle: boolean;
}

function creds(): { accessKeyId: string; secretAccessKey: string } {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  if (!accessKeyId || !secretAccessKey) throw new Error('studio storage: R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY missing');
  return { accessKeyId, secretAccessKey };
}

function defaultEndpoint(): string {
  return process.env.S3_ENDPOINT?.trim() || `https://${process.env.R2_ACCOUNT_ID ?? ''}.r2.cloudflarestorage.com`;
}

export function studioRegions(): Record<string, StudioRegion> {
  const base: StudioRegion = {
    key: 'default',
    bucket: process.env.R2_BUCKET || 'vantly-ugc',
    publicUrl: (process.env.R2_PUBLIC_URL || 'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev').replace(/\/+$/, ''),
    endpoint: defaultEndpoint().replace(/\/+$/, ''),
    region: process.env.S3_REGION?.trim() || 'auto',
    forcePathStyle: true,
  };
  const out: Record<string, StudioRegion> = { default: base };
  try {
    const raw = JSON.parse(process.env.STUDIO_STORAGE_REGIONS ?? '{}') as Record<string, Partial<StudioRegion>>;
    for (const [k, v] of Object.entries(raw)) {
      if (v?.bucket && v.publicUrl) {
        out[k] = { ...base, ...v, key: k, publicUrl: v.publicUrl.replace(/\/+$/, ''), endpoint: (v.endpoint ?? base.endpoint).replace(/\/+$/, '') };
      }
    }
  } catch { /* malformed → default only */ }
  return out;
}

export function regionFor(key: string | null | undefined): StudioRegion {
  const all = studioRegions();
  return all[key ?? 'default'] ?? all.default;
}

/** True when the URL is one of OUR objects in any region. */
export function isStudioHosted(url: string): boolean {
  return Object.values(studioRegions()).some((r) => url.startsWith(r.publicUrl + '/'));
}

export function regionOfUrl(url: string): StudioRegion | null {
  return Object.values(studioRegions()).find((r) => url.startsWith(r.publicUrl + '/')) ?? null;
}

const clients = new Map<string, S3Client>();
function client(r: StudioRegion): S3Client {
  let c = clients.get(r.key);
  if (!c) {
    c = new S3Client({ region: r.region, endpoint: r.endpoint, forcePathStyle: r.forcePathStyle, credentials: creds() });
    clients.set(r.key, c);
  }
  return c;
}

export async function putStudioObject(
  regionKey: string | null | undefined,
  key: string,
  body: Buffer,
  contentType: string,
): Promise<{ url: string; key: string }> {
  const r = regionFor(regionKey);
  await client(r).send(new PutObjectCommand({ Bucket: r.bucket, Key: key, Body: body, ContentType: contentType }));
  return { url: `${r.publicUrl}/${key}`, key };
}

/** Delete our objects (any region) by public URL; foreign URLs are ignored. */
export async function deleteStudioObjectsByUrl(urls: Array<string | null | undefined>): Promise<number> {
  const byRegion = new Map<string, { r: StudioRegion; keys: string[] }>();
  for (const u of urls) {
    if (!u) continue;
    const r = regionOfUrl(u);
    if (!r) continue;
    const e = byRegion.get(r.key) ?? { r, keys: [] };
    e.keys.push(decodeURIComponent(u.slice(r.publicUrl.length + 1)));
    byRegion.set(r.key, e);
  }
  let n = 0;
  for (const { r, keys } of byRegion.values()) {
    await client(r).send(new DeleteObjectsCommand({ Bucket: r.bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }));
    n += keys.length;
  }
  return n;
}

// ── Multipart ───────────────────────────────────────────────────────────────

export const PART_SIZE = 16 * 1024 * 1024;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;

export async function startMultipart(regionKey: string | null | undefined, userId: string, filename: string, contentType: string, bytes: number) {
  const r = regionFor(regionKey);
  const ext = (/\.(mp4|mov|webm|m4v|mp3|wav|m4a|png|jpe?g|ttf|otf)$/i.exec(filename)?.[1] ?? (contentType.startsWith('video/') ? 'mp4' : 'bin')).toLowerCase();
  const key = `studio/uploads/${userId}/${randomUUID()}.${ext}`;
  const res = await client(r).send(new CreateMultipartUploadCommand({ Bucket: r.bucket, Key: key, ContentType: contentType }));
  if (!res.UploadId) throw new Error('multipart: no UploadId');
  const parts = Math.max(1, Math.ceil(bytes / PART_SIZE));
  const urls = Array.from({ length: parts }, (_, i) =>
    presignS3Url(r, 'PUT', key, { partNumber: String(i + 1), uploadId: res.UploadId! }, 6 * 3600),
  );
  return { region: r.key, key, upload_id: res.UploadId, part_size: PART_SIZE, part_urls: urls, public_url: `${r.publicUrl}/${key}` };
}

export async function completeMultipart(regionKey: string | null | undefined, key: string, uploadId: string, parts: Array<{ part_number: number; etag: string }>) {
  const r = regionFor(regionKey);
  await client(r).send(
    new CompleteMultipartUploadCommand({
      Bucket: r.bucket,
      Key: key,
      UploadId: uploadId,
      MultipartUpload: { Parts: parts.sort((a, b) => a.part_number - b.part_number).map((p) => ({ PartNumber: p.part_number, ETag: p.etag })) },
    }),
  );
  return { url: `${r.publicUrl}/${key}` };
}

export async function abortMultipart(regionKey: string | null | undefined, key: string, uploadId: string): Promise<void> {
  const r = regionFor(regionKey);
  await client(r).send(new AbortMultipartUploadCommand({ Bucket: r.bucket, Key: key, UploadId: uploadId })).catch(() => {});
}

// ── SigV4 query-string presigning (no extra dependency) ─────────────────────

const enc = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const hmac = (k: Buffer | string, s: string) => createHmac('sha256', k).update(s).digest();

export function presignS3Url(
  r: Pick<StudioRegion, 'endpoint' | 'bucket' | 'region'>,
  method: 'PUT' | 'GET',
  key: string,
  extraQuery: Record<string, string>,
  expiresSeconds: number,
  now = new Date(),
  credentials = creds(),
): string {
  const host = new URL(r.endpoint).host;
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const scope = `${date}/${r.region}/s3/aws4_request`;
  const path = `${r.bucket ? `/${r.bucket}` : ''}/${key.split('/').map(enc).join('/')}`;
  const query: Record<string, string> = {
    ...extraQuery,
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${credentials.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresSeconds),
    'X-Amz-SignedHeaders': 'host',
  };
  const canonicalQuery = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join('&');
  const canonical = [method, path, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
  const kDate = hmac(`AWS4${credentials.secretAccessKey}`, date);
  const kSigning = hmac(hmac(hmac(kDate, r.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');
  return `${r.endpoint}${path}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
