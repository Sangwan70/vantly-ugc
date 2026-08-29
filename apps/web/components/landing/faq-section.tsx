'use client';

import { useState } from 'react';

type FaqEntry = {
  question: string;
  answer: string;
};

const FAQS: FaqEntry[] = [
  {
    question: 'What is Vantly UGC?',
    answer:
      'Vantly UGC is an AI UGC video production platform for agents, developers, and automated workflows.',
  },
  {
    question: 'How do I create a video?',
    answer:
      'Send a video request through your agent. Vantly UGC handles the script, actor, voice, captions, render, and export.',
  },
  {
    question: 'Which AI tools can I use?',
    answer:
      'Use Vantly UGC with tools such as Claude Code, ChatGPT, Codex, Cursor, OpenClaw, and Hermes Agent.',
  },
  {
    question: 'Do I need to write code?',
    answer:
      'Not necessarily. You can start from a supported agent, while developers can also connect through CLI, MCP, API, or SDKs.',
  },
  {
    question: 'What kinds of videos can I create?',
    answer:
      'Create creator-style UGC videos, product launches, app demos, social ads, explainers, and campaign variations.',
  },
  {
    question: 'Can I adjust the result without starting over?',
    answer:
      'Yes. Regenerate individual parts such as the script, actor, voice, captions, or format while keeping the rest unchanged.',
  },
  {
    question: 'What do I receive after generation?',
    answer:
      'You receive the final MP4, caption and subtitle files, asset links, metadata, and generation details.',
  },
  {
    question: 'How do credits work?',
    answer:
      'Credits are used when generating or regenerating video assets. Usage depends on the requested production work and is tracked in your account.',
  },
];

function FaqItem({ entry }: { entry: FaqEntry }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="rounded-2xl border px-6 py-5"
      style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'var(--cryptix-surface)' }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-4 text-left"
      >
        <span className="text-base font-medium" style={{ color: 'var(--cryptix-text)' }}>
          {entry.question}
        </span>
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-sm transition-transform"
          style={{
            background: 'var(--cryptix-surface-2)',
            color: 'var(--cryptix-purple)',
            transform: open ? 'rotate(45deg)' : 'rotate(0deg)',
          }}
        >
          +
        </span>
      </button>
      {open ? (
        <p className="mt-3 text-sm leading-relaxed" style={{ color: 'var(--cryptix-text-muted)' }}>
          {entry.answer}
        </p>
      ) : null}
    </div>
  );
}

export function FaqSection() {
  return (
    <section className="relative mx-auto w-full max-w-4xl px-6 py-24">
      <div className="mx-auto max-w-2xl text-center">
        <p
          className="text-xs font-semibold uppercase tracking-[0.2em]"
          style={{ color: 'var(--cryptix-purple)' }}
        >
          FAQ
        </p>
        <h2
          className="mt-4 text-3xl font-semibold sm:text-4xl"
          style={{ color: 'var(--cryptix-text)' }}
        >
          Frequently asked questions
        </h2>
      </div>

      <div className="mt-12 space-y-3">
        {FAQS.map((entry) => (
          <FaqItem key={entry.question} entry={entry} />
        ))}
      </div>
    </section>
  );
}
