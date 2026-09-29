// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Autosaved, unsubmitted skill-form drafts (supabase/migrations/20260929120000_skill_drafts.sql).
 *
 * Closes the gap where a user's typed inputs (a guest description, a
 * discussion topic, an AI-drafted dialogue script, a course URL, …) only
 * ever lived in the dashboard's React state until the FIRST successful
 * POST to /v1/skills/:slug/run. Any error before that point — a client-
 * orchestrated pre-step like make_portrait failing (exactly what a user
 * hit generating a podcast guest portrait), a network blip, an accidental
 * tab close — silently discarded everything typed or AI-drafted so far,
 * forcing a full restart from a blank form.
 *
 * One row per (user_id, skill_slug), upserted by the RunPanel on a debounce
 * as the form changes, restored on next visit to that skill's form, and
 * deleted once the form is actually submitted (at that point the same data
 * is durable in skill_runs.input, so the draft is redundant).
 *
 * Deliberately dumb storage: `form_values` is whatever JSON the client's
 * form state currently is, no schema validation, no interpretation. It is
 * never itself submitted to a skill — only ever read back into the same
 * form it came from.
 */

import type { Request, Response } from 'express';
import { supabase } from '../../server.js';
import { getSkill } from '../../skills/registry.js';

const MAX_DRAFT_BYTES = 512 * 1024; // generous for text/JSON form state; base64 photos are excluded client-side

function requireUser(req: Request, res: Response): string | null {
  const userId = (req as any).userId as string | undefined;
  if (!userId) {
    res.status(401).json({ error: 'unauthorized' });
    return null;
  }
  return userId;
}

function requireKnownSkill(req: Request, res: Response): string | null {
  const slug = String(req.params.slug ?? '');
  if (!slug || !getSkill(slug)) {
    res.status(404).json({ error: 'unknown_skill', detail: { slug } });
    return null;
  }
  return slug;
}

export async function getSkillDraftRoute(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;
  const slug = requireKnownSkill(req, res);
  if (!slug) return;

  const { data, error } = await supabase
    .from('skill_drafts')
    .select('form_values, updated_at')
    .eq('user_id', userId)
    .eq('skill_slug', slug)
    .maybeSingle();
  if (error) {
    res.status(500).json({ error: 'draft_lookup_failed', detail: error.message });
    return;
  }
  if (!data) {
    res.status(200).json({ skill: slug, draft: null });
    return;
  }
  res.status(200).json({ skill: slug, draft: { form_values: data.form_values, updated_at: data.updated_at } });
}

export async function saveSkillDraftRoute(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;
  const slug = requireKnownSkill(req, res);
  if (!slug) return;

  const formValues = req.body?.form_values;
  if (formValues === undefined || formValues === null || typeof formValues !== 'object' || Array.isArray(formValues)) {
    res.status(400).json({ error: 'invalid_input', detail: 'form_values must be a JSON object' });
    return;
  }
  const approxBytes = Buffer.byteLength(JSON.stringify(formValues), 'utf8');
  if (approxBytes > MAX_DRAFT_BYTES) {
    res.status(413).json({ error: 'draft_too_large', detail: `form_values exceeds ${MAX_DRAFT_BYTES} bytes — exclude large binary/base64 fields before saving a draft` });
    return;
  }

  const { error } = await supabase
    .from('skill_drafts')
    .upsert(
      { user_id: userId, skill_slug: slug, form_values: formValues, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,skill_slug' },
    );
  if (error) {
    res.status(500).json({ error: 'draft_save_failed', detail: error.message });
    return;
  }
  res.status(200).json({ skill: slug, saved: true });
}

export async function deleteSkillDraftRoute(req: Request, res: Response): Promise<void> {
  const userId = requireUser(req, res);
  if (!userId) return;
  const slug = requireKnownSkill(req, res);
  if (!slug) return;

  const { error } = await supabase
    .from('skill_drafts')
    .delete()
    .eq('user_id', userId)
    .eq('skill_slug', slug);
  if (error) {
    res.status(500).json({ error: 'draft_delete_failed', detail: error.message });
    return;
  }
  res.status(200).json({ skill: slug, deleted: true });
}
