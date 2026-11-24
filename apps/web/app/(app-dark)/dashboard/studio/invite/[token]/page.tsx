// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/** /dashboard/studio/invite/[token] — accept a workspace invite (must be signed in as the invited email). */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { studioApi } from '../../_lib/api';
import { C } from '../../_components/ui';

export default function AcceptInvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    studioApi.acceptInvite(token).then((r) => router.replace(`/dashboard/studio?workspace=${r.workspace_id}`)).catch((e: Error) => setErr(e.message));
  }, [token, router]);
  return (
    <div className="flex h-72 flex-col items-center justify-center gap-3 text-sm" style={{ color: C.muted }}>
      {err ? <><p style={{ color: '#FCA5A5' }}>{err}</p><Link href="/dashboard/studio" className="underline">Go to Voiceover Studio</Link></> : <><Loader2 className="h-5 w-5 animate-spin" /> Joining workspace…</>}
    </div>
  );
}
