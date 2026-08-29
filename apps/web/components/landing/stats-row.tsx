// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Landing page — key-metrics stat row.
 *
 * Six stat pairs shown as a single-row strip beneath the hero, mirroring
 * the shape of the old agent-media.ai marketing page's metrics section
 * (same idea: quick, scannable proof points before the fold ends).
 */

const STATS: Array<{ value: string; label: string }> = [
  { value: '3x', label: 'Faster video production' },
  { value: '60%', label: 'Less manual production work' },
  { value: '12h', label: 'Saved every week' },
  { value: '30+', label: 'UGC videos created monthly' },
  { value: '20+', label: 'Videos from one campaign brief' },
  { value: '10m', label: 'From prompt to first preview' },
  { value: '3x', label: 'More campaign concepts tested' },
  { value: '70%', label: 'Faster client-ready drafts' },
];

export function StatsRow() {
  return (
    <section className="relative z-10 mx-auto max-w-6xl px-6 py-16 sm:py-20">
      <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8">
        {STATS.map((stat) => (
          <div key={stat.label} className="text-center">
            <p
              className="text-3xl font-extrabold tracking-tight sm:text-4xl"
              style={{ color: 'var(--cryptix-text)' }}
            >
              {stat.value}
            </p>
            <p
              className="mt-2 text-xs leading-5 sm:text-sm"
              style={{ color: 'var(--cryptix-text-muted)' }}
            >
              {stat.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
