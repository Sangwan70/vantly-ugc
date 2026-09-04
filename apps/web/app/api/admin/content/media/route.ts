// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createAdminClient } from '@supabase/supabase-js';
import { isAdminEmail } from '@/lib/admin-allowlist';
import { publicStorageUrl } from '@/lib/media-url';

function adminClient() {
  return createAdminClient(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

const BUCKET = 'user-media';
const MAX_BYTES = 8 * 1024 * 1024; // 8 MiB -- hero/inline images only, not video

// Checked against the file's actual bytes, not its claimed Content-Type or
// filename extension -- a renamed .html-as-.png would fail this check even
// if the browser sent image/png as the form field's type. The plan
// document's own "biggest gotcha" for this feature is skipping exactly
// this check.
const SIGNATURES: { mime: string; ext: string; check: (b: Buffer) => boolean }[] = [
  { mime: 'image/png', ext: 'png', check: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: 'image/jpeg', ext: 'jpg', check: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', ext: 'gif', check: (b) => b.length >= 4 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  {
    mime: 'image/webp', ext: 'webp',
    check: (b) => b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP',
  },
];

function safeFileNameSegment(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Uploads one hero/inline image for the content editor. Multipart form field "file". */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email || !isAdminEmail(user.email)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: 'A "file" form field is required' }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File must be between 1 byte and ${MAX_BYTES / (1024 * 1024)} MiB` }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const signature = SIGNATURES.find((s) => s.check(bytes));
  if (!signature) {
    return NextResponse.json({ error: 'File is not a recognized PNG, JPEG, GIF, or WEBP image (checked by file signature, not extension)' }, { status: 400 });
  }

  const storagePath = `site-content/${safeFileNameSegment()}.${signature.ext}`;
  const admin = adminClient();
  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, bytes, { contentType: signature.mime, upsert: false });

  if (uploadError) {
    return NextResponse.json({ error: 'Upload failed', details: uploadError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, url: publicStorageUrl(BUCKET, storagePath), storage_path: storagePath });
}
