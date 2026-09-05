// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SubscribeForm({ slug }: { slug: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const r = await fetch(`/api/mailer/newsletter/${encodeURIComponent(slug)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? 'Something went wrong -- please try again.'); return; }
      if (j.redirect_url) { router.push(j.redirect_url); return; }
      setMessage(j.message ?? "Thanks -- you're subscribed.");
    } catch {
      setError('Something went wrong -- please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (message) {
    return (
      <p className="text-center text-sm font-medium" style={{ color: 'var(--cryptix-text)' }}>{message}</p>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 sm:flex-row">
      <input
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="you@example.com"
        className="min-w-0 flex-1 rounded-lg px-3 py-2.5 text-sm outline-none"
        style={{ background: 'rgba(255,255,255,0.05)', color: 'var(--cryptix-text)', border: '1px solid rgba(255,255,255,0.12)' }}
      />
      <button
        type="submit"
        disabled={busy}
        className="rounded-lg px-4 py-2.5 text-sm font-medium"
        style={{ background: 'var(--cryptix-purple)', color: '#191A22' }}
      >
        {busy ? 'Submitting…' : 'Sign up'}
      </button>
      {error ? <p className="text-sm sm:basis-full" style={{ color: '#F87171' }}>{error}</p> : null}
    </form>
  );
}
