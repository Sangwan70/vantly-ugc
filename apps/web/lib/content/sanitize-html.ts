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
 *  - `style` is allowed only on span/div, and only a `font-size: <n><unit>`
 *    declaration survives (matching the plan document's own scoping) --
 *    every other CSS property is stripped from the value.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'em', 'a', 'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'code', 'pre', 'img', 'figure', 'figcaption', 'span', 'div',
]);

/** Void elements never get a matching close tag. */
const VOID_TAGS = new Set(['br', 'img']);

const ATTRS_BY_TAG: Record<string, string[]> = {
  a: ['href', 'title', 'target'],
  img: ['src', 'alt', 'width', 'height'],
  span: ['style'],
  div: ['style'],
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

function sanitizeStyleValue(value: string): string | null {
  const kept = value
    .split(';')
    .map((decl) => decl.trim())
    .filter((decl) => /^font-size\s*:\s*\d{1,3}(px|pt|em|%)$/i.test(decl));
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

function filterAttributes(tagName: string, attrs: ParsedAttr[]): string {
  const allowed = ATTRS_BY_TAG[tagName];
  if (!allowed) return '';

  const out: string[] = [];
  for (const { name, value } of attrs) {
    if (!allowed.includes(name)) continue;
    // Belt-and-suspenders: never emit an event-handler attribute even if a
    // future edit to ATTRS_BY_TAG accidentally allowlists one.
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
      finalValue = /^\d{1,4}$/.test(value) ? value : null;
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

export function sanitizeStaticPageHtml(input: string): string {
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
      if (ALLOWED_TAGS.has(tagName) && !VOID_TAGS.has(tagName)) {
        out += `</${tagName}>`;
      }
      continue;
    }

    if (!ALLOWED_TAGS.has(tagName)) {
      // Dropped entirely -- text between this and its (also-dropped)
      // closing tag is kept as inert text by the rest of the scan, never
      // executed.
      continue;
    }

    const attrs = parseAttributes(attrsRaw);
    const filtered = filterAttributes(tagName, attrs);
    if (VOID_TAGS.has(tagName)) {
      out += `<${tagName}${filtered} />`;
    } else {
      out += `<${tagName}${filtered}>`;
    }
  }

  return out;
}
