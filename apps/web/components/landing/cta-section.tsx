'use client';

import type { MouseEvent } from 'react';

import { Home2CTAButton } from '@/components/home2-cta-button';
import { useLogin } from '@/components/login-context';

export function CtaSection() {
  const { openLogin } = useLogin();

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    openLogin();
  };

  return (
    <section className="relative mx-auto w-full max-w-4xl px-6 py-24 text-center">
      <div
        className="rounded-[32px] border px-8 py-16 sm:px-16"
        style={{
          borderColor: 'rgba(255,255,255,0.08)',
          background:
            'radial-gradient(120% 140% at 50% 0%, rgba(145,98,255,0.18) 0%, rgba(0,0,0,0) 60%), var(--cryptix-surface)',
        }}
      >
        <h2
          className="text-3xl font-semibold sm:text-4xl"
          style={{ color: 'var(--cryptix-text)' }}
        >
          The developer-first AI UGC video platform
        </h2>
        <p
          className="mx-auto mt-4 max-w-xl text-base"
          style={{ color: 'var(--cryptix-text-muted)' }}
        >
          Create production-ready UGC videos from AI agents, CLI, MCP, API,
          or the web app.
        </p>
        <div className="mt-10 flex justify-center" onClick={handleClick}>
          <Home2CTAButton href="#" variant="dark" size="lg">
            Start generating
          </Home2CTAButton>
        </div>
      </div>
    </section>
  );
}
