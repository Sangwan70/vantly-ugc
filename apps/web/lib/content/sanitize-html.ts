// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Hand-rolled HTML sanitizer for admin-authored static-page content
 * (public.static_pages.content_html -- see 20260904190000_static_pages.sql),
 * which is rendered RAW on public marketing pages via
 * dangerouslySetInnerHTML. This is the single most important piece of the
 * Content Management feature: any gap here is a stored-XSS hole reachable
 * by anyone with admin-panel access (or anyone who can trick an admin into
 * pasting poisoned rich-text content from elsewhere).
 *
 * THIS IS A DELIBERATE STOPGAP, not a permanent choice. The real plan was
 * to use the `sanitize-html` npm package (the Node analog of Python's
 * `bleach`, which AutoGPT's own admin CMS uses) -- but installing any new
 * dependency in this pnpm workspace currently fails with
 * ERR_PNPM_PUBLIC_HOIST_PATTERN_DIFF, which only resolves via a full
 * `pnpm install` across the whole monorepo (same blocker hit earlier this
 * session when the `stripe` package was needed for Admin Plans, and
 * deliberately not run blindly there either, given other uncommitted
 * work sitting in this repo). Ram chose to ship this hand-rolled version
 * now and swap in `sanitize-html` later once a full `pnpm install` has
 * been run deliberately. TO SWAP LATER: replace the body of
 * `sanitizeStaticPageHtml` with a call to `sanitizeHtml(input, { allowedTags:
 * [...ALLOWED_TAGS], allowedAttributes: ATTRS_BY_TAG, ... })` from the real
 * package and delete the tokenizer below.
 *
 * Design, so a future reviewer can audit it:
 *  - Single left-to-right scan, byte-for-byte over the input string. No
 *    HTML-entity decoding is EVER performed -- an entity like `&#60;` stays
 *    exactly as those five characters in the output, so it can only ever
 *    render as the literal text "<", never as a real "<" character that a
 *    browser could reparse into a tag. This is the single property that
 *    makes the rest of the tokenizer's edge cases safe to get slightly
 *    "wrong" (e.g. a malformed tag falling through to be treated as text)
 *    -- falling through to text can only ever produce inert text, never a
 *    live tag, because text is never re-parsed.
 *  - A tag is only ever recognized as `<` immediately followed by a letter
 *    (open), `/`+letter (close), `!` (comment/doctype), or `?` (processing
 *    instruction). Anything else starting with `<` is emitted as the
 *    literal text "&lt;" and reprocessed one character at a time.
 *  - Every tag NOT on ALLOWED_TAGS is dropped entirely (including all of
 *    its attributes) -- this is an allowlist, not a denylist. <script>,
 *    <style>, <iframe>, <object>, <embed>, <form>, <svg>, <link>, <meta>,
 *    <base>, event-handler-bearing tags, all of it, gone. Text BETWEEN a
 *    dropped tag's open and close (e.g. `<script>alert(1)</script>`) is
 *    kept as inert, escaped text -- it is never executed, since it was
 *    never a real DOM node to begin with once content_html is rendered.
 *  - Every attribute NOT on that specific tag's allowlist (ATTRS_BY_TAG)
 *    is dropped, whatever its name -- there is no denylist of "known bad"
 *    attribute names to bypass; nothing gets through unless explicitly
 *    allowed for that exact tag.
 *  - Every attribute value that survives is re-escaped (&, ", <, >) before
 *    being written back out inside a double-quoted attribute, regardless
 *    of whether the original source used double quotes, single quotes, or
 *    was unquoted -- a single-quoted source value containing a literal `"`
 *    character cannot break out of the double quotes this sanitizer always
 *    writes.
 *  - `href`/`src` values go through sanitizeUrl(): only http:, https:,
 *    mailto:, tel:, and scheme-relative/relative paths are allowed for
 *    href; src additionally allows `data:image/{png,jpeg,jpg,gif,webp}`
 *    (base64 only) for pasted images. `data:image/svg+xml` is explicitly
 *    REJECTED even though some sanitizers (including the one described in
 *    the admin-replication-plan this feature is based on) allow `data:`
 *    generally for pasted images -- an SVG can carry its own <script> or
 *    event-handler attributes inside its XML, so allowing it here would
 *    reopen exactly the hole this function exists to close. `javascript:`,
 *    `vbscript:`, and every other scheme are rejected outright.
 *  - `style` is allowed on span/div/a (plus table/tr/td/th for the Mailer
 *    variant below), validated declaration-by-declaration against
 *    STYLE_VALIDATORS below (added for the drag-and-drop Content Builder --
 *    see lib/content/builder/ -- which needs layout/color styling, not
 *    just font-size). Every declaration is matched against a
 *    property-specific, fully-anchored (`^...$`) regex; a value that
 *    doesn't match is dropped, the rest of the style string is unaffected.
 *    None of these regexes ever allow `(` except inside the tightly-scoped
 *    `rgba(...)` / `border: Npx solid rgba(...)` patterns (digits, commas,
 *    dots, spaces only inside those parens) -- so `url(...)`,
 *    `expression(...)`, `javascript:`, `-moz-binding`, `behavior:`, and
 *    `@import` can never appear in surviving output. Unknown properties
 *    (anything not in STYLE_VALIDATORS) are dropped outright, same as an
 *    unknown attribute.
 *
 * TWO entry points share the tokenizer below (see sanitizeHtml): the
 * original sanitizeStaticPageHtml (ALLOWED_TAGS -- no table tags, static
 * pages/blog posts render as a normal browser page) and
 * sanitizeMailerTemplateHtml (MAILER_ALLOWED_TAGS -- adds table/tbody/tr/
 * td/th, because the Mailer Template builder needs real `<table>` layout
 * to survive actual email clients). Everything else in this doc comment
 * applies equally to both.
 */

// See the `<!--` branch of sanitizeStaticPageHtml's scan loop -- the one
// narrow exception to "all HTML comments are stripped": the Content
// Builder's own leading state marker (lib/content/builder/serialize.ts),
// matched only at input position 0, only against this fixed
// prefix+base64-alphabet shape.
const CONTENT_BUILDER_MARKER_RE = /^CONTENT_BUILDER_STATE:[A-Za-z0-9+/=]*$/;

const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'code', 'pre', 'img', 'figure', 'figcaption', 'span', 'div',
]);

/** Void elements never get a matching close tag. */
const VOID_TAGS = new Set(['br', 'img']);

const ATTRS_BY_TAG: Record<string, string[]> = {
  a: ['href', 'title', 'target', 'style'],
  // 'style' added for the Content Builder's full-width images (an <img>
  // has no CSS of its own without a stylesheet, so "fill the column"
  // needs an inline `width: 100%` -- the plain `width` attribute below is
  // numeric-pixels-only, see filterAttributes, so it can't express a
  // percentage). Goes through the same STYLE_VALIDATORS allowlist as
  // span/div/a -- only width/max-width/height (among others) can ever
  // apply here in practice.
  img: ['src', 'alt', 'width', 'height', 'style'],
  span: ['style'],
  div: ['style'],
};

/**
 * Mailer Template HTML (email_templates.html_content) -- a SEPARATE,
 * wider allowlist used only by sanitizeMailerTemplateHtml below, never by
 * sanitizeStaticPageHtml. The Mailer Template builder (ContentBuilder --
 * moved here from Content Management, see that component's own doc
 * comment) renders its rows/columns/blocks as `<table>` layout, not
 * flexbox, because that's what actually survives real email clients
 * (Outlook desktop's Word rendering engine and many webmail clients
 * either ignore or badly mis-render `display:flex`) -- the same reason
 * AutoGPT's own Mailer template builder uses `<table>` while its
 * Content-Management builder doesn't. Static pages keep the narrower
 * table-free ALLOWED_TAGS/ATTRS_BY_TAG above unchanged; nothing here
 * affects that path.
 */
const MAILER_ALLOWED_TAGS = new Set([...ALLOWED_TAGS, 'table', 'tbody', 'tr', 'td', 'th']);

const MAILER_ATTRS_BY_TAG: Record<string, string[]> = {
  ...ATTRS_BY_TAG,
  table: ['role', 'width', 'cellpadding', 'cellspacing', 'border', 'align', 'style'],
  tbody: [],
  tr: ['style'],
  td: ['width', 'align', 'valign', 'colspan', 'rowspan', 'style'],
  th: ['width', 'align', 'valign', 'colspan', 'rowspan', 'style'],
};

const SAFE_HREF_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:']);
const SAFE_IMG_DATA_MIME = /^data:image\/(png|jpe?g|gif|webp);base64,[a-zA-Z0-9+/=]+$/;

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Reject anything that isn't a plainly safe URL. Applies to both href and (non-data:) src. */
function isSafeNonDataUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === '') return false;
  // Relative / scheme-relative / fragment / path URLs (no "scheme:" prefix
  // before the first '/', '?', or '#') are allowed as-is.
  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(trimmed);
  if (!schemeMatch) return true;
  const scheme = schemeMatch[1].toLowerCase() + ':';
  return SAFE_HREF_SCHEMES.has(scheme);
}

function sanitizeHrefValue(value: string): string | null {
  return isSafeNonDataUrl(value) ? value.trim() : null;
}

function sanitizeSrcValue(value: string): string | null {
  const trimmed = value.trim();
  if (/^data:/i.test(trimmed)) {
    return SAFE_IMG_DATA_MIME.test(trimmed) ? trimmed : null;
  }
  return isSafeNonDataUrl(trimmed) ? trimmed : null;
}

// Fully-anchored color pattern shared by color/background-color/border-*:
// hex (#abc / #abcd / #aabbcc / #aabbccdd), a numeric-only rgb()/rgba(), or
// the two safe keywords. No other characters (no `url(`, no letters beyond
// hex digits) can appear inside, including inside the rgba() parens.
const COLOR_PATTERN =
  '(#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgba?\\(\\s*\\d{1,3}\\s*,\\s*\\d{1,3}\\s*,\\s*\\d{1,3}\\s*(,\\s*(0|1|0?\\.\\d{1,3}))?\\s*\\)|transparent|inherit)';
const COLOR_RE = new RegExp(`^${COLOR_PATTERN}$`);
const BORDER_RE = new RegExp(`^\\d{1,2}(\\.\\d+)?px solid ${COLOR_PATTERN}$`);
const LENGTH_PX_PT_EM_PCT = /^\d{1,3}(\.\d+)?(px|pt|em|rem|%)$/;
const LENGTH_PX_PCT_UP_TO_4 = /^\d{1,4}(\.\d+)?(px|%)$/;
const LENGTH_PX = /^\d{1,3}(\.\d+)?px$/;
const SPACING_PX = /^\d{1,3}(\.\d+)?px(\s+\d{1,3}(\.\d+)?px){0,3}$/;

/** Property-by-property allowlist for the `style` attribute on span/div/a.
 * Each regex is fully anchored (`^...$`) against the WHOLE trimmed
 * declaration value -- there is no substring matching anywhere here, so a
 * value like "10px; background:url(javascript:evil)" can never partially
 * match and leak the dangerous half through, since the whole string
 * (including everything after the first `;`, which the caller already
 * splits out before calling this) must match exactly. Widened from the
 * original font-size-only allowlist to support the drag-and-drop Content
 * Builder's rows/columns/blocks (see lib/content/builder/serialize.ts),
 * which lays pages out with flexbox + these color/spacing properties
 * instead of the `<table>` layout an email-oriented builder would need
 * (table/tbody/tr/td are deliberately NOT in ALLOWED_TAGS here). */
const STYLE_VALIDATORS: Record<string, RegExp> = {
  'font-size': LENGTH_PX_PT_EM_PCT,
  color: COLOR_RE,
  'background-color': COLOR_RE,
  'text-align': /^(left|center|right|justify)$/,
  'text-decoration': /^(none|underline)$/,
  'font-weight': /^(normal|bold|[1-9]00)$/,
  'line-height': /^\d(\.\d+)?$/,
  border: BORDER_RE,
  'border-top': BORDER_RE,
  'border-bottom': BORDER_RE,
  'border-left': BORDER_RE,
  'border-right': BORDER_RE,
  'border-radius': LENGTH_PX_PT_EM_PCT,
  display: /^(flex|block|inline-block|inline)$/,
  'flex-direction': /^(row|column)$/,
  'flex-wrap': /^(wrap|nowrap)$/,
  'justify-content': /^(flex-start|center|flex-end|space-between|space-around)$/,
  'align-items': /^(flex-start|center|flex-end|stretch)$/,
  gap: LENGTH_PX,
  width: LENGTH_PX_PT_EM_PCT,
  'max-width': LENGTH_PX_PCT_UP_TO_4,
  height: LENGTH_PX_PCT_UP_TO_4,
  padding: SPACING_PX,
  'padding-top': LENGTH_PX,
  'padding-bottom': LENGTH_PX,
  'padding-left': LENGTH_PX,
  'padding-right': LENGTH_PX,
  margin: SPACING_PX,
  'margin-top': LENGTH_PX,
  'margin-bottom': LENGTH_PX,
  'margin-left': LENGTH_PX,
  'margin-right': LENGTH_PX,
  'box-sizing': /^border-box$/,
  // Added for the Mailer Template builder's Stats block (uppercase,
  // letter-spaced labels) -- see lib/content/builder/serialize.ts.
  'letter-spacing': LENGTH_PX,
  'text-transform': /^(uppercase|lowercase|capitalize|none)$/,
};

function sanitizeStyleValue(value: string): string | null {
  const kept = value
    .split(';')
    .map((decl) => decl.trim())
    .filter(Boolean)
    .map((decl) => {
      const idx = decl.indexOf(':');
      if (idx === -1) return null;
      const prop = decl.slice(0, idx).trim().toLowerCase();
      const val = decl.slice(idx + 1).trim();
      const validator = STYLE_VALIDATORS[prop];
      if (!validator || !validator.test(val)) return null;
      return `${prop}: ${val}`;
    })
    .filter((decl): decl is string => decl !== null);
  return kept.length ? kept.join('; ') : null;
}

interface ParsedAttr {
  name: string;
  value: string;
}

/** Parses the raw text between a tag name and its closing '>' / '/>' into name/value pairs. */
function parseAttributes(raw: string): ParsedAttr[] {
  const attrs: ParsedAttr[] = [];
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    const name = m[1].toLowerCase();
    const value = m[3] ?? m[4] ?? m[5] ?? '';
    attrs.push({ name, value });
  }
  return attrs;
}

function filterAttributes(tagName: string, attrs: ParsedAttr[], attrsByTag: Record<string, string[]>): string {
  const allowed = attrsByTag[tagName];
  if (!allowed) return '';

  const out: string[] = [];
  for (const { name, value } of attrs) {
    if (!allowed.includes(name)) continue;
    // Belt-and-suspenders: never emit an event-handler attribute even if a
    // future edit to ATTRS_BY_TAG/MAILER_ATTRS_BY_TAG accidentally
    // allowlists one.
    if (name.startsWith('on')) continue;

    let finalValue: string | null = value;
    if (tagName === 'a' && name === 'href') {
      finalValue = sanitizeHrefValue(value);
    } else if (tagName === 'img' && name === 'src') {
      finalValue = sanitizeSrcValue(value);
    } else if (name === 'style') {
      finalValue = sanitizeStyleValue(value);
    } else if (name === 'target') {
      finalValue = value === '_blank' ? '_blank' : null;
    } else if (name === 'width' || name === 'height') {
      // Percent form (e.g. a <td width="50%">) added for the Mailer
      // Template builder's table columns -- a plain numeric-pixels string
      // (the only shape img width/height ever uses) still matches too.
      finalValue = /^\d{1,4}(\.\d+)?%?$/.test(value) ? value : null;
    } else if (name === 'role') {
      // Only ever emitted by the Mailer builder as role="presentation" on
      // layout tables (an accessibility hint, not a security-relevant
      // value) -- reject anything else outright rather than allowlist
      // ARIA roles generally.
      finalValue = value === 'presentation' ? value : null;
    } else if (name === 'cellpadding' || name === 'cellspacing' || name === 'border') {
      finalValue = /^\d{1,2}$/.test(value) ? value : null;
    } else if (name === 'align') {
      finalValue = /^(left|center|right)$/.test(value) ? value : null;
    } else if (name === 'valign') {
      finalValue = /^(top|middle|bottom)$/.test(value) ? value : null;
    } else if (name === 'colspan' || name === 'rowspan') {
      finalValue = /^\d{1,2}$/.test(value) ? value : null;
    }

    if (finalValue === null) continue;
    out.push(`${name}="${escapeAttr(finalValue)}"`);
  }

  // target="_blank" without rel="noopener noreferrer" lets the opened page
  // control window.opener (reverse tabnabbing) -- always pair them, and
  // never trust an admin-supplied rel value instead.
  if (tagName === 'a' && out.some((a) => a.startsWith('target='))) {
    out.push('rel="noopener noreferrer"');
  }

  return out.length ? ' ' + out.join(' ') : '';
}

/**
 * Shared tokenizer core for both sanitizeStaticPageHtml and
 * sanitizeMailerTemplateHtml -- identical scanning/escaping logic, only
 * the tag/attribute allowlists differ (see MAILER_ALLOWED_TAGS's doc
 * comment for why Mailer Templates need a wider, table-inclusive one).
 * Keeping one tokenizer instead of two copies means every hardening fix
 * made here (quote handling, comment stripping, entity non-decoding)
 * automatically applies to both callers -- exactly the property the rest
 * of this file's doc comment above relies on.
 */
function sanitizeHtml(input: string, allowedTags: ReadonlySet<string>, attrsByTag: Record<string, string[]>): string {
  if (typeof input !== 'string' || input.length === 0) return '';

  let out = '';
  let i = 0;
  const n = input.length;

  while (i < n) {
    const ch = input[i];

    if (ch !== '<') {
      out += ch;
      i += 1;
      continue;
    }

    if (input.startsWith('<!--', i)) {
      const end = input.indexOf('-->', i + 4);
      if (end !== -1 && i === 0) {
        const commentBody = input.slice(i + 4, end);
        if (CONTENT_BUILDER_MARKER_RE.test(commentBody)) {
          out += input.slice(i, end + 3);
          i = end + 3;
          continue;
        }
      }
      i = end === -1 ? n : end + 3;
      continue;
    }
    if (input[i + 1] === '!' || input[i + 1] === '?') {
      const end = input.indexOf('>', i);
      i = end === -1 ? n : end + 1;
      continue;
    }

    const isClosing = input[i + 1] === '/';
    const nameRe = isClosing ? /^<\/([a-zA-Z][a-zA-Z0-9]*)/ : /^<([a-zA-Z][a-zA-Z0-9]*)/;
    const nameMatch = nameRe.exec(input.slice(i));
    if (!nameMatch) {
      // Not a real tag start -- emit '<' as inert text and move on one char.
      out += '&lt;';
      i += 1;
      continue;
    }

    const tagName = nameMatch[1].toLowerCase();
    const afterName = i + nameMatch[0].length;

    // Scan to the closing '>' of this tag, correctly skipping '>' inside
    // quoted attribute values so an attribute like alt=">evil" can't
    // truncate the tag early.
    let j = afterName;
    let quote: string | null = null;
    while (j < n) {
      const c = input[j];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '>') {
        break;
      }
      j += 1;
    }
    if (j >= n) {
      // Unterminated tag -- drop the rest of the input rather than guess.
      break;
    }

    let attrsRaw = input.slice(afterName, j);
    const selfClosing = /\/\s*$/.test(attrsRaw);
    if (selfClosing) attrsRaw = attrsRaw.replace(/\/\s*$/, '');
    i = j + 1;

    if (isClosing) {
      if (allowedTags.has(tagName) && !VOID_TAGS.has(tagName)) {
        out += `</${tagName}>`;
      }
      continue;
    }

    if (!allowedTags.has(tagName)) {
      // Dropped entirely -- text between this and its (also-dropped)
      // closing tag is kept as inert text by the rest of the scan, never
      // executed.
      continue;
    }

    const attrs = parseAttributes(attrsRaw);
    const filtered = filterAttributes(tagName, attrs, attrsByTag);
    if (VOID_TAGS.has(tagName)) {
      out += `<${tagName}${filtered} />`;
    } else {
      out += `<${tagName}${filtered}>`;
    }
  }

  return out;
}

export function sanitizeStaticPageHtml(input: string): string {
  return sanitizeHtml(input, ALLOWED_TAGS, ATTRS_BY_TAG);
}

/**
 * Mailer Template HTML (email_templates.html_content) -- the Mailer
 * Template builder's table-based output, see MAILER_ALLOWED_TAGS's doc
 * comment above. Used by app/api/admin/mailer/templates/route.ts and
 * .../[id]/route.ts on every create/update, same "sanitize again on the
 * server regardless of what the client-side builder already produced"
 * posture as sanitizeStaticPageHtml.
 */
export function sanitizeMailerTemplateHtml(input: string): string {
  return sanitizeHtml(input, MAILER_ALLOWED_TAGS, MAILER_ATTRS_BY_TAG);
}
