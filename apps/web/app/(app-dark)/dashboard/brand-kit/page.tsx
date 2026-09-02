// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/brand-kit — folded into the Gallery page as a tab
 * (?tab=brand). This route stays only as a redirect for old bookmarks/
 * links; there's no standalone Brand Kit page or nav entry anymore.
 */

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function BrandKitRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard/gallery?tab=brand');
  }, [router]);
  return null;
}
