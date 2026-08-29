'use client';

import { useEffect, useState, type MouseEvent } from 'react';

import { Home2CTAButton } from '@/components/home2-cta-button';
import { useLogin } from '@/components/login-context';
import { HeroClipGrid } from '@/components/landing/hero-clip-grid';

// Same tool line-up the pipeline visualization below cycles through -
// mirrors the live site's rotating agent-name headline.
const TOOL_NAMES = [
  'Claude Code',
  'ChatGPT',
  'Codex',
  'OpenClaw',
  'Hermes Agent',
  'Claude',
  'Cursor',
  'Gemini',
];

function RotatingTool() {
  const [i, setI] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setI((n) => (n + 1) % TOOL_NAMES.length), 1800);
    return () => clearInterval(id);
  }, []);

  return (
    <span
      className="inline-block bg-gradient-to-r bg-clip-text text-transparent"
      style={{ backgroundImage: 'linear-gradient(90deg, #9162FF, #CB3DFF)' }}
    >
      {TOOL_NAMES[i]}
    </span>
  );
}

export function HeroSection() {
  const { openLogin } = useLogin();

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    openLogin();
  };

  return (
    <section className="relative z-10 mx-auto w-full max-w-4xl px-6 pb-6 pt-20 text-center sm:pt-28">
      <h1
        className="mx-auto max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-6xl"
        style={{ color: 'var(--cryptix-text)' }}
      >
        Run agentic UGC video
        <br />
        with <RotatingTool />
      </h1>
      <p
        className="mx-auto mt-6 max-w-2xl text-base sm:text-lg"
        style={{ color: 'var(--cryptix-text-muted)' }}
      >
        Trigger a full UGC video pipeline, from prompt to preview to
        export-ready assets.
      </p>
      <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
        <div onClick={handleClick}>
          <Home2CTAButton href="#" variant="dark" size="lg">
            Start generating
          </Home2CTAButton>
        </div>
      </div>

      <HeroClipGrid />
    </section>
  );
}
