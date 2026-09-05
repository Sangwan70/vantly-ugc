// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import {
  Block,
  BlockAlign,
  BuilderState,
  Column,
  RawHtmlBlock,
  Row,
  SocialPlatform,
  emptyBuilderState,
  makeRawBlock,
  makeRow,
} from './types';

/**
 * BuilderState <-> HTML string, ported from AutoGPT's Mailer template
 * builder (see that repo's admin/mailer/templates/components/builder/
 * serialize.ts), now used for exactly the same purpose here: this
 * component moved from Content Management to the Mailer Templates editor
 * (see components/admin/content-builder/ContentBuilder.tsx's own doc
 * comment for why -- Content Management uses a simpler WYSIWYG instead,
 * see WysiwygEditor.tsx). Every block renders as `<table>` layout
 * (table/tbody/tr/td), matching AutoGPT's own implementation exactly,
 * because that's what actually survives real email clients -- Outlook
 * desktop's Word rendering engine and many webmail clients either ignore
 * or badly mis-render `display:flex`/`display:grid`. The rendered HTML
 * is sanitized AGAIN server-side on every save (sanitizeMailerTemplateHtml
 * in lib/content/sanitize-html.ts, which extends the static-page
 * sanitizer's allowlist with table/tbody/tr/td/th specifically for this
 * builder's output) regardless of what this function produces -- this is
 * a UX nicety, not the security boundary.
 */

const PLATFORM_LABELS: Record<SocialPlatform, string> = {
  facebook: 'f',
  instagram: 'IG',
  linkedin: 'in',
  twitter: 'X',
  youtube: 'YT',
  website: 'W',
};

const MARKER_PREFIX = '<!--CONTENT_BUILDER_STATE:';
const MARKER_SUFFIX = '-->';
// How many levels of "raw block whose html is itself a whole previous
// marker+body string" we'll unwrap in deserializeBuilderState before
// giving up -- mirrors the mailer builder's own self-healing guard.
const MAX_UNWRAP_DEPTH = 25;

/** Encodes a string as base64, safe for embedding inside an HTML comment
 * (`<!--...-->`). Deliberately NOT the same as embedding raw JSON text --
 * see `serializeBuilderState`'s doc comment for why that's unsafe: raw
 * JSON can legitimately contain a literal `-->` (e.g. inside a Raw HTML
 * block's own content), which would truncate the marker early. Base64's
 * alphabet has no `-` or `>` characters, so this can never happen. */
function toBase64(value: string): string {
  if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
    return window.btoa(unescape(encodeURIComponent(value)));
  }
  return Buffer.from(value, 'utf-8').toString('base64');
}

function fromBase64(value: string): string {
  if (typeof window !== 'undefined' && typeof window.atob === 'function') {
    return decodeURIComponent(escape(window.atob(value)));
  }
  return Buffer.from(value, 'base64').toString('utf-8');
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function alignToImageStyle(align: BlockAlign): string {
  if (align === 'center') return 'display:block;margin-left:auto;margin-right:auto;';
  if (align === 'right') return 'display:block;margin-left:auto;margin-right:0;';
  return 'display:block;margin-right:auto;';
}

// Table-based rendering, line-for-line matching AutoGPT's actual Mailer
// template builder (see this file's own doc comment for why) -- role=
// "presentation" + cellpadding/cellspacing/border="0" on every layout
// table is the standard email-HTML convention for "this table is layout,
// not tabular data", recognized by every major email client and screen
// reader.
function renderBlock(block: Block): string {
  switch (block.type) {
    case 'text': {
      const color = block.textColor ? `color:${block.textColor};` : '';
      return `<div style="text-align:${block.align};${color}">${block.html}</div>`;
    }
    case 'image': {
      if (!block.src) return '';
      const widthStyle = block.width ? `width:${block.width}px;max-width:100%;` : 'width:100%;';
      const style = `${widthStyle}${alignToImageStyle(block.align)}border:0;`;
      const widthAttr = block.width ? ` width="${block.width}"` : '';
      let img = `<img src="${escapeAttr(block.src)}" alt="${escapeAttr(block.alt)}"${widthAttr} style="${style}" />`;
      if (block.link) {
        img = `<a href="${escapeAttr(block.link)}">${img}</a>`;
      }
      return img;
    }
    case 'button': {
      const margin =
        block.align === 'center' ? 'margin:0 auto;' : block.align === 'right' ? 'margin:0 0 0 auto;' : 'margin:0 auto 0 0;';
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;">` +
        `<tbody><tr><td align="${block.align}" style="text-align:${block.align};padding:0;">` +
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${margin}">` +
        `<tbody><tr><td style="background-color:${block.bgColor};border-radius:${block.borderRadius}px;text-align:center;">` +
        `<a href="${escapeAttr(block.url)}" style="display:block;padding:12px 28px;color:${block.textColor};text-decoration:none;font-weight:bold;">${escapeAttr(block.label)}</a>` +
        `</td></tr></tbody></table></td></tr></tbody></table>`
      );
    }
    case 'divider':
      return `<div style="border-top:${block.thickness}px solid ${block.color};margin:${block.spacing}px 0;"></div>`;
    case 'spacer':
      return `<div style="height:${block.height}px;"></div>`;
    case 'quote': {
      const lines = block.quote
        .split('\n')
        .map((line) => escapeAttr(line))
        .join('<br />');
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;">` +
        `<tbody><tr><td style="text-align:${block.align};padding:4px 0 4px 16px;border-left:4px solid ${block.accentColor};">` +
        `<div style="font-size:1.1rem;line-height:1.6;"><em>${lines}</em></div>` +
        `<div style="margin-top:8px;font-size:0.9rem;font-weight:bold;">&mdash; ${escapeAttr(block.attribution)}</div>` +
        `</td></tr></tbody></table>`
      );
    }
    case 'social': {
      const badges = block.links
        .map((link) => {
          const label = PLATFORM_LABELS[link.platform] || '•';
          return (
            `<td style="padding:0 6px;">` +
            `<a href="${escapeAttr(link.url)}" style="display:block;width:32px;height:32px;line-height:32px;border-radius:16px;background-color:${block.badgeColor};color:#ffffff;text-align:center;font-size:0.8rem;font-weight:bold;text-decoration:none;">${escapeAttr(label)}</a>` +
            `</td>`
          );
        })
        .join('');
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;">` +
        `<tbody><tr><td align="${block.align}" style="text-align:${block.align};padding:0;">` +
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0;"><tbody><tr>${badges}</tr></tbody></table>` +
        `</td></tr></tbody></table>`
      );
    }
    case 'stats': {
      const n = block.items.length || 1;
      const widthPercent = (100 / n).toFixed(2);
      const cells = block.items
        .map(
          (item) =>
            `<td width="${widthPercent}%" style="text-align:center;padding:8px 4px;">` +
            `<div style="font-size:1.75rem;font-weight:bold;line-height:1.2;color:${block.accentColor};">${escapeAttr(item.value)}</div>` +
            `<div style="font-size:0.75rem;letter-spacing:0.5px;text-transform:uppercase;color:${block.accentColor};margin-top:4px;">${escapeAttr(item.label)}</div>` +
            `</td>`,
        )
        .join('');
      return (
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0;">` +
        `<tbody><tr>${cells}</tr></tbody></table>`
      );
    }
    case 'raw':
      return block.html;
    default:
      return '';
  }
}

function renderColumn(col: Column, paddingY: number): string {
  const content = col.blocks.map(renderBlock).join('');
  return `<td width="${col.widthPercent}%" valign="top" style="padding:${paddingY}px 10px;">${content}</td>`;
}

function renderRow(row: Row): string {
  const bg = row.bgColor ? `background-color:${row.bgColor};` : '';
  const cols = row.columns.map((c) => renderColumn(c, row.paddingY)).join('');
  return (
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${bg}margin:0;">` +
    `<tbody><tr>${cols}</tr></tbody></table>`
  );
}

/** state -> HTML string, the value actually saved as
 * `email_templates.html_content` and later rendered by mail clients when
 * a campaign sends it (and in the admin's own preview/send-test flows) --
 * this builder is only a friendlier way to produce that same string,
 * nothing downstream needed to change.
 *
 * The JSON state is base64-encoded before being embedded in the leading
 * `<!--CONTENT_BUILDER_STATE:...-->` marker comment. Raw JSON text can
 * legitimately contain a literal `-->` substring (e.g. a Raw HTML block
 * whose content includes an HTML comment), which would confuse a naive
 * "find the first -->" boundary search in `deserializeBuilderState` and
 * truncate the JSON. Base64's alphabet has no `-` or `>` characters, so
 * the marker's closing `-->` can never be confused with anything inside
 * the payload -- this is the same fix AutoGPT's own mailer builder
 * shipped after hitting exactly that bug in production. Never throws:
 * if `JSON.stringify` somehow fails, falls back to saving the body with
 * no marker rather than crashing the editor. */
export function serializeBuilderState(state: BuilderState): string {
  const body = state.rows.map(renderRow).join('\n');
  try {
    const marker = `${MARKER_PREFIX}${toBase64(JSON.stringify(state))}${MARKER_SUFFIX}`;
    return `${marker}\n${body}`;
  } catch (err) {
    console.error(
      'serializeBuilderState: failed to embed builder-state marker (state too large?); saving body only',
      err,
    );
    return body;
  }
}

function isValidBuilderState(value: unknown): value is BuilderState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<BuilderState>;
  return v.version === 1 && Array.isArray(v.rows);
}

/** Scans a JSON text starting at the opening `{`/`[` at `start` and
 * returns the index right after its matching closing brace/bracket --
 * i.e. the true end of that one JSON value -- tracking string-literal
 * state (respecting `\"` escapes) so a `-->` sitting inside a string
 * value can never be mistaken for structural JSON. Returns -1 if
 * `start` isn't `{`/`[` or the value is unbalanced/truncated. */
function findJsonValueEnd(text: string, start: number): number {
  let i = start;
  while (i < text.length && /\s/.test(text[i])) i++;
  if (text[i] !== '{' && text[i] !== '[') return -1;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1; // unbalanced/truncated
}

/** Parses one marker layer (if `html` starts with one). Fast path: the
 * current format's payload is base64, which can never itself contain a
 * literal `-->`, so the FIRST `-->` after the prefix is always the
 * correct boundary. Legacy/corrupted-input path: falls back to a
 * brace/bracket-and-string-aware scan via `findJsonValueEnd` in case a
 * raw (non-base64) JSON payload with an embedded `-->` is ever
 * encountered. */
function tryParseMarkerLayer(html: string): BuilderState | null {
  const trimmed = (html || '').trimStart();
  if (!trimmed.startsWith(MARKER_PREFIX)) return null;
  const payloadStart = MARKER_PREFIX.length;

  const firstEnd = trimmed.indexOf(MARKER_SUFFIX, payloadStart);
  if (firstEnd !== -1) {
    try {
      const parsed = JSON.parse(fromBase64(trimmed.slice(payloadStart, firstEnd)));
      if (isValidBuilderState(parsed)) return parsed;
    } catch {
      // not (valid) base64 at this boundary -- fall through to the
      // JSON-aware legacy scan below
    }
  }

  const jsonEnd = findJsonValueEnd(trimmed, payloadStart);
  if (jsonEnd !== -1 && trimmed.startsWith(MARKER_SUFFIX, jsonEnd)) {
    try {
      const parsed = JSON.parse(trimmed.slice(payloadStart, jsonEnd));
      if (isValidBuilderState(parsed)) return parsed;
    } catch {
      // malformed/truncated -- give up on this layer
    }
  }

  return null;
}

/** If `state` is exactly one row/one column/one Raw HTML block, returns
 * that block's html -- used to detect (and unwrap) an accidentally
 * double-wrapped marker so a page self-heals rather than doubling in
 * size on every open+save cycle. */
function singleRawBlockHtml(state: BuilderState): string | null {
  if (
    state.rows.length === 1 &&
    state.rows[0].columns.length === 1 &&
    state.rows[0].columns[0].blocks.length === 1 &&
    state.rows[0].columns[0].blocks[0].type === 'raw'
  ) {
    return (state.rows[0].columns[0].blocks[0] as RawHtmlBlock).html;
  }
  return null;
}

/** HTML string -> state. Only content this builder itself produced
 * (identified by the leading JSON marker comment) round-trips as real,
 * editable blocks. Anything else -- a page saved before this feature
 * existed (plain hand-typed HTML, or the pre-builder textarea's output),
 * or hand-edited via Source Code mode in a way that changed the
 * structure -- gets wrapped as a single "Raw HTML" block in a
 * single-column row, so nothing already saved is ever silently lost. */
export function deserializeBuilderState(html: string): {
  state: BuilderState;
  recognized: boolean;
} {
  let current = html;
  let sawAnyMarker = false;

  for (let depth = 0; depth < MAX_UNWRAP_DEPTH; depth++) {
    const parsed = tryParseMarkerLayer(current);
    if (!parsed) break;
    sawAnyMarker = true;
    const nested = singleRawBlockHtml(parsed);
    if (nested && nested.trimStart().startsWith(MARKER_PREFIX)) {
      current = nested; // one more layer of historical doubling -- keep unwrapping
      continue;
    }
    return { state: parsed, recognized: true };
  }

  if (sawAnyMarker) {
    const parsed = tryParseMarkerLayer(current);
    if (parsed) return { state: parsed, recognized: true };
  }

  if (!current || !current.trim()) {
    return { state: emptyBuilderState(), recognized: true };
  }

  const row = makeRow(1);
  row.columns[0].blocks = [makeRawBlock(current)];
  return { state: { version: 1, rows: [row] }, recognized: false };
}
