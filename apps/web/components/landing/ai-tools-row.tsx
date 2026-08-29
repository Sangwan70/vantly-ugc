'use client';

type ToolEntry = {
  title: string;
  description: string;
  iconUrl?: string;
  initials?: string;
};

const FEATURED_TOOLS: ToolEntry[] = [
  {
    title: 'ChatGPT',
    description: 'Describe the video you need and send the request into the Vantly UGC production flow.',
    iconUrl: '/agent-icons/openai-light.png',
  },
  {
    title: 'Claude',
    description: 'Ask for a video in plain language. Vantly UGC handles the production steps and returns the result.',
    iconUrl: '/agent-icons/claude.png',
  },
  {
    title: 'Claude Code',
    description: 'Turn release notes, product files, or repository context into launch videos without leaving your workflow.',
    iconUrl: '/agent-icons/claudecode.png',
  },
  {
    title: 'HTTP API',
    description: 'Send an HTTP request to Vantly UGC and receive a ready-to-use video response.',
    initials: '{ }',
  },
];

const ALSO_WORKS_WITH: ToolEntry[] = [
  { title: 'Codex', description: '', iconUrl: '/agent-icons/codex.png' },
  { title: 'Cursor', description: '', initials: 'CU' },
  { title: 'OpenClaw', description: '', initials: 'OC' },
  { title: 'Hermes Agent', description: '', initials: 'HA' },
];

function ToolIcon({ tool }: { tool: ToolEntry }) {
  return (
    <div
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl"
      style={{ background: 'var(--cryptix-surface-2)' }}
    >
      {tool.iconUrl ? (
        <img src={tool.iconUrl} alt={tool.title} className="h-7 w-7 object-contain" />
      ) : (
        <span className="text-sm font-semibold" style={{ color: 'var(--cryptix-purple)' }}>
          {tool.initials}
        </span>
      )}
    </div>
  );
}

export function AiToolsRow() {
  return (
    <section className="relative mx-auto w-full max-w-6xl px-6 py-24">
      <div className="mx-auto max-w-2xl text-center">
        <p
          className="text-xs font-semibold uppercase tracking-[0.2em]"
          style={{ color: 'var(--cryptix-purple)' }}
        >
          Works with your stack
        </p>
        <h2
          className="mt-4 text-3xl font-semibold sm:text-4xl"
          style={{ color: 'var(--cryptix-text)' }}
        >
          Drive it from any agent you already use
        </h2>
      </div>

      <div className="mt-14 grid gap-4 sm:grid-cols-2">
        {FEATURED_TOOLS.map((tool) => (
          <div
            key={tool.title}
            className="flex items-start gap-4 rounded-2xl border px-6 py-6"
            style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'var(--cryptix-surface)' }}
          >
            <ToolIcon tool={tool} />
            <div>
              <p className="text-base font-semibold" style={{ color: 'var(--cryptix-text)' }}>
                {tool.title}
              </p>
              <p className="mt-1 text-sm leading-relaxed" style={{ color: 'var(--cryptix-text-muted)' }}>
                {tool.description}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
        <span className="text-xs font-medium uppercase tracking-[0.15em]" style={{ color: 'var(--cryptix-text-muted)' }}>
          Also works with
        </span>
        <div className="flex flex-wrap items-center justify-center gap-3">
          {ALSO_WORKS_WITH.map((tool) => (
            <div
              key={tool.title}
              className="flex items-center gap-2 rounded-full border px-4 py-2"
              style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'var(--cryptix-surface)' }}
            >
              {tool.iconUrl ? (
                <img src={tool.iconUrl} alt={tool.title} className="h-4 w-4 object-contain" />
              ) : (
                <span className="text-xs font-semibold" style={{ color: 'var(--cryptix-purple)' }}>
                  {tool.initials}
                </span>
              )}
              <span className="text-sm" style={{ color: 'var(--cryptix-text)' }}>
                {tool.title}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
