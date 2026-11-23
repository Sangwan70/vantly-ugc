// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/** Bring-your-own ElevenLabs key: unlocks your own (cloned) voices; TTS on your key is not charged credits. */

import { useEffect, useState } from 'react';
import { KeyRound, Loader2, Trash2, X } from 'lucide-react';
import { studioApi } from '../_lib/api';
import { Btn, C, Input } from './ui';

export function SettingsDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [state, setState] = useState<{ supported: boolean; configured: boolean; last4?: string } | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    studioApi.getKey().then((r) => setState({ supported: r.supported, ...r.elevenlabs })).catch((e: Error) => setErr(e.message));
  }, []);

  async function save() {
    setBusy(true); setErr(null);
    try {
      const r = await studioApi.saveKey(key.trim());
      setState((s) => ({ supported: s?.supported ?? true, configured: true, last4: r.elevenlabs.last4 }));
      setKey('');
      onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true); setErr(null);
    try { await studioApi.deleteKey(); setState((s) => ({ supported: s?.supported ?? true, configured: false })); onChanged(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.line2}` }} onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center gap-2">
          <KeyRound className="h-4 w-4" style={{ color: C.accent }} />
          <p className="text-sm font-semibold" style={{ color: C.text }}>Your ElevenLabs account</p>
          <button type="button" className="ml-auto" onClick={onClose} style={{ color: C.muted }}><X className="h-4 w-4" /></button>
        </div>
        <p className="text-xs leading-relaxed" style={{ color: C.muted }}>
          Paste an ElevenLabs API key to narrate with <b style={{ color: C.text }}>your own voice</b> (Instant/Professional Voice Clones) and anything in your ElevenLabs voice library.
          Generations on your key use your ElevenLabs quota and cost no Vantly credits. The key is encrypted and never shown again.
        </p>
        {state === null && !err ? <Loader2 className="mt-4 h-4 w-4 animate-spin" style={{ color: C.muted }} /> : null}
        {state && !state.supported ? (
          <p className="mt-4 text-xs" style={{ color: '#FCD34D' }}>Personal keys aren&rsquo;t enabled on this server (PROVIDER_KEYS_SECRET is not set).</p>
        ) : null}
        {state?.supported && state.configured ? (
          <div className="mt-4 flex items-center gap-2 rounded-lg p-2 text-xs" style={{ background: C.bg, color: C.text }}>
            Connected · key ending <span className="font-mono">…{state.last4}</span>
            <button type="button" disabled={busy} onClick={remove} className="ml-auto inline-flex items-center gap-1" style={{ color: '#FCA5A5' }}><Trash2 className="h-3.5 w-3.5" /> Remove</button>
          </div>
        ) : null}
        {state?.supported ? (
          <div className="mt-4 space-y-2">
            <Input type="password" autoComplete="off" placeholder={state.configured ? 'Replace with a new key' : 'sk_…'} value={key} onChange={(e) => setKey(e.target.value)} />
            <p className="text-[11px]" style={{ color: C.faint }}>Needs “Voices: read” and “Text to Speech” permissions. Create one at elevenlabs.io → Developers → API keys.</p>
            <div className="flex justify-end"><Btn primary disabled={busy || key.trim().length < 20} onClick={save}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} Verify & save</Btn></div>
          </div>
        ) : null}
        {err ? <p className="mt-2 text-xs" style={{ color: '#FCA5A5' }}>{err}</p> : null}
      </div>
    </div>
  );
}
