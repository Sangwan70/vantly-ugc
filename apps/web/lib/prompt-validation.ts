// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Shared body validation for POST /api/dashboard/prompts and
 * PATCH /api/dashboard/prompts/:id — both accept the same full-form shape
 * (the My Prompts tab always re-submits every field, edit or create alike).
 */

export type PersonMode = 'describe' | 'my-character' | 'stock-actor' | 'upload';
export type Look = 'natural' | 'commercial' | 'raw_iphone';
export type AspectRatio = '9:16' | '1:1';
export type CaptionStyle = 'hormozi' | 'tiktok' | 'minimal';

export interface PromptFields {
  name: string;
  pitch: string | null;
  script: string;
  person_mode: PersonMode;
  person_text: string | null;
  person_ref_id: string | null;
  person_ref_name: string | null;
  person_image_url: string | null;
  look: Look;
  aspect_ratio: AspectRatio;
  name_hint: string | null;
  captions: boolean;
  caption_style: CaptionStyle;
  music: boolean;
  music_text: string | null;
  broll_url: string | null;
}

export interface ParsedPromptBody {
  fields: PromptFields;
  /** A fresh `data:` URL from the photo-upload picker, when person_mode is
   *  'upload' and the user picked a new file — the route handler uploads
   *  this to Storage and overwrites fields.person_image_url with the
   *  resulting public URL. Null when unset or already a plain URL (an
   *  unchanged photo on an edit — fields.person_image_url already has it). */
  uploadDataUrl: string | null;
}

const PERSON_MODES = new Set<PersonMode>(['describe', 'my-character', 'stock-actor', 'upload']);
const LOOKS = new Set<Look>(['natural', 'commercial', 'raw_iphone']);
const ASPECT_RATIOS = new Set<AspectRatio>(['9:16', '1:1']);
const CAPTION_STYLES = new Set<CaptionStyle>(['hormozi', 'tiktok', 'minimal']);

function str(body: Record<string, unknown>, key: string): string {
  const v = body[key];
  return typeof v === 'string' ? v.trim() : '';
}
function optStr(body: Record<string, unknown>, key: string, maxLen: number): string | null {
  const v = str(body, key);
  return v ? v.slice(0, maxLen) : null;
}

export function parsePromptBody(body: Record<string, unknown>): { ok: true; value: ParsedPromptBody } | { ok: false; error: string } {
  const name = str(body, 'name');
  if (!name) return { ok: false, error: 'name is required' };
  if (name.length > 80) return { ok: false, error: 'name must be 80 characters or fewer' };

  const script = str(body, 'script');
  if (!script) return { ok: false, error: 'script is required' };
  if (script.length > 1200) return { ok: false, error: 'script must be 1200 characters or fewer' };

  const personModeRaw = str(body, 'person_mode') as PersonMode;
  const person_mode = PERSON_MODES.has(personModeRaw) ? personModeRaw : 'describe';

  const lookRaw = str(body, 'look') as Look;
  const look = LOOKS.has(lookRaw) ? lookRaw : 'natural';

  const aspectRaw = str(body, 'aspect_ratio') as AspectRatio;
  const aspect_ratio = ASPECT_RATIOS.has(aspectRaw) ? aspectRaw : '9:16';

  const captionStyleRaw = str(body, 'caption_style') as CaptionStyle;
  const caption_style = CAPTION_STYLES.has(captionStyleRaw) ? captionStyleRaw : 'hormozi';

  let person_text: string | null = null;
  let person_ref_id: string | null = null;
  let person_ref_name: string | null = null;
  let person_image_url: string | null = null;
  let uploadDataUrl: string | null = null;

  if (person_mode === 'describe') {
    person_text = optStr(body, 'person_text', 400);
  } else if (person_mode === 'my-character' || person_mode === 'stock-actor') {
    person_ref_id = optStr(body, 'person_ref_id', 200);
    person_ref_name = optStr(body, 'person_ref_name', 200);
    person_image_url = optStr(body, 'person_image_url', 2000);
    if (!person_image_url) {
      return {
        ok: false,
        error: person_mode === 'my-character' ? 'Pick one of your characters.' : 'Pick a stock actor.',
      };
    }
  } else if (person_mode === 'upload') {
    const raw = str(body, 'upload_data_url') || str(body, 'person_image_url');
    if (!raw) return { ok: false, error: 'Upload a photo.' };
    if (/^data:/i.test(raw)) uploadDataUrl = raw;
    else person_image_url = raw;
  }

  const broll_url = optStr(body, 'broll_url', 500);
  if (broll_url && !/^https:\/\//i.test(broll_url)) {
    return { ok: false, error: 'B-roll URL must start with https://' };
  }

  return {
    ok: true,
    value: {
      fields: {
        name,
        pitch: optStr(body, 'pitch', 400),
        script,
        person_mode,
        person_text,
        person_ref_id,
        person_ref_name,
        person_image_url,
        look,
        aspect_ratio,
        name_hint: optStr(body, 'name_hint', 80),
        captions: body.captions === true,
        caption_style,
        music: body.music === true,
        music_text: optStr(body, 'music_text', 120),
        broll_url,
      },
      uploadDataUrl,
    },
  };
}
