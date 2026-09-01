// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * "Sample prompts" reference section for /dashboard/docs — one card per
 * SAMPLE_PROMPTS entry, each copyable and openable directly in the Agent
 * chat. Kept separate from the public SkillsHub component (which is also
 * rendered on the marketing /skills /mcp /cli pages) so this stays specific
 * to the signed-in docs page.
 */

import Link from 'next/link';
import { useState } from 'react';
import { Copy, Check, ArrowRight } from 'lucide-react';
import { SAMPLE_PROMPTS } from '@/lib/sample-prompts';

function PromptCard({ label, prompt }: { label: string; prompt: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-3 p-5" style={{ background: '#17171D', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12 }}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold text-white">{label}</h3>
        <button
          type="button"
          onClick={async () => {
            try { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ }
          }}
          className="inline-flex shrink-0 items-center gap-1 text-[12px] transition-colors"
          style={{ color: copied ? '#34D399' : 'rgba(255,255,255,0.5)' }}
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'copied' : 'copy'}
        </button>
      </div>
      <pre className="overflow-x-auto whitespace-pre-wrap px-3.5 py-3 text-[12.5px] leading-relaxed font-mono" style={{ background: '#08080B', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#C9D1D9' }}>
        {prompt}
      </pre>
      <Link href="/dashboard/agent" className="inline-flex items-center gap-1 self-start text-[12px]" style={{ color: '#A78BFA' }}>
        Try it in the Agent <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

export function SamplePrompts() {
  return (
    <section className="mt-16">
      <h2 className="text-2xl font-semibold text-white">Sample prompts</h2>
      <p className="mt-1 mb-6 text-sm text-white/55">
        Copy one of these into the <Link href="/dashboard/agent" className="underline" style={{ color: '#A78BFA' }}>Agent chat</Link> or a <code className="text-white/80">make_ugc</code> call — swap the script, look, or aspect ratio for your own.
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {SAMPLE_PROMPTS.map((s) => (
          <PromptCard key={s.label} label={s.label} prompt={s.prompt} />
        ))}
      </div>
    </section>
  );
}
