// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Voiceover Studio — team workspaces and governance.
 *
 *   GET/POST   /v1/studio/workspaces
 *   GET/PATCH  /v1/studio/workspaces/:id                       settings (policies) — admins
 *   POST       /v1/studio/workspaces/:id/invites               { email, role }
 *   DELETE     /v1/studio/workspaces/:id/invites/:invite_id
 *   POST       /v1/studio/invites/:token/accept
 *   PATCH/DELETE /v1/studio/workspaces/:id/members/:user_id
 *   PUT/DELETE /v1/studio/workspaces/:id/provider-key          shared ElevenLabs account
 *   GET        /v1/studio/workspaces/:id/usage?month=YYYY-MM   (&format=csv)
 *   GET        /v1/studio/workspaces/:id/audit
 *   POST       /internal/studio/retention-sweep                (cron, x-internal-secret)
 */

import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { supabase } from '../../server.js';
import { verifyElevenLabsKey } from '../../lib/elevenlabs.js';
import {
  deleteWorkspaceProviderKey,
  getWorkspaceProviderKeyMeta,
  providerKeysConfigured,
  saveWorkspaceProviderKey,
} from '../../lib/provider-keys.js';
import { deleteStudioObjectsByUrl, studioRegions } from '../../lib/studio-storage.js';
import {
  DEFAULT_WORKSPACE_SETTINGS,
  StudioError,
  audit,
  isUuid,
  requireWorkspace,
  studioRoute,
  workspaceSpend,
  type StudioRole,
} from '../../lib/studio-access.js';

const uid = (req: Request) => (req as unknown as { userId: string }).userId;
const email = (req: Request) => ((req as unknown as { userEmail?: string }).userEmail ?? '').toLowerCase();
const ROLES = ['owner', 'admin', 'editor', 'reviewer', 'viewer'] as const;

export const listWorkspacesRoute = studioRoute(async (req, res) => {
  const { data: mem } = await supabase.from('studio_workspace_members').select('role, studio_workspaces(id, name, settings)').eq('user_id', uid(req));
  const workspaces = (mem ?? []).map((m) => {
    const w = m.studio_workspaces as unknown as { id: string; name: string; settings: Record<string, unknown> };
    return { id: w.id, name: w.name, role: m.role, settings: { ...DEFAULT_WORKSPACE_SETTINGS, ...(w.settings ?? {}) } };
  });
  const { data: inv } = email(req)
    ? await supabase.from('studio_workspace_invites').select('token, role, studio_workspaces(id, name)').eq('email', email(req)).is('accepted_at', null)
    : { data: [] };
  res.json({
    workspaces,
    invites: (inv ?? []).map((i) => ({ token: i.token, role: i.role, workspace: i.studio_workspaces })),
    regions: Object.keys(studioRegions()),
  });
});

export const createWorkspaceRoute = studioRoute(async (req, res) => {
  const { name } = z.object({ name: z.string().trim().min(2).max(80) }).parse(req.body);
  const { data, error } = await supabase.from('studio_workspaces').insert({ name, owner_id: uid(req), settings: DEFAULT_WORKSPACE_SETTINGS }).select('id, name').single();
  if (error) throw new StudioError(500, 'DATABASE_ERROR', error.message);
  await supabase.from('studio_workspace_members').insert({ workspace_id: data.id, user_id: uid(req), role: 'owner', email: email(req) || null });
  await audit(req, { workspace_id: data.id as string, action: 'workspace.create', detail: { name } });
  res.status(201).json({ workspace: data });
});

export const getWorkspaceRoute = studioRoute(async (req, res) => {
  const { ws, role } = await requireWorkspace(req, String(req.params.id), 'view');
  const admin = role === 'owner' || role === 'admin';
  const { data: members } = await supabase.from('studio_workspace_members').select('user_id, role, email, created_at').eq('workspace_id', ws.id).order('created_at');
  const { data: invites } = admin
    ? await supabase.from('studio_workspace_invites').select('id, email, role, token, created_at').eq('workspace_id', ws.id).is('accepted_at', null)
    : { data: [] };
  const key = admin ? await getWorkspaceProviderKeyMeta(ws.id, 'elevenlabs') : null;
  res.json({
    workspace: { id: ws.id, name: ws.name, settings: ws.settings },
    role,
    members: members ?? [],
    invites: invites ?? [],
    provider_key: admin ? { supported: providerKeysConfigured(), elevenlabs: key ? { configured: true, ...key } : { configured: false } } : null,
    regions: Object.keys(studioRegions()),
  });
});

const SettingsSchema = z.object({
  require_approval: z.boolean(),
  require_voice_consent: z.boolean(),
  sso_domain: z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/).nullable(),
  enforce_sso: z.boolean(),
  monthly_credit_budget: z.number().int().positive().nullable(),
  member_monthly_cap: z.number().int().positive().nullable(),
  retention_days: z.number().int().min(1).max(3650).nullable(),
  data_region: z.string().max(20),
  disclosure_badge: z.boolean(),
  webhook_url: z.string().url().nullable(),
}).partial();

export const patchWorkspaceRoute = studioRoute(async (req, res) => {
  const { ws } = await requireWorkspace(req, String(req.params.id), 'manage');
  const p = z.object({ name: z.string().trim().min(2).max(80).optional(), settings: SettingsSchema.optional() }).parse(req.body);
  if (p.settings?.data_region && !studioRegions()[p.settings.data_region]) throw new StudioError(400, 'INVALID_INPUT', 'Unknown storage region');
  if (p.settings?.enforce_sso && !(p.settings.sso_domain ?? ws.settings.sso_domain)) throw new StudioError(400, 'INVALID_INPUT', 'Set the SSO domain before enforcing SSO.');
  const settings = { ...ws.settings, ...(p.settings ?? {}) };
  await supabase.from('studio_workspaces').update({ name: p.name ?? ws.name, settings, updated_at: new Date().toISOString() }).eq('id', ws.id);
  await audit(req, { workspace_id: ws.id, action: 'workspace.settings', detail: { changed: Object.keys(p.settings ?? {}), name: p.name ?? null } });
  res.json({ workspace: { id: ws.id, name: p.name ?? ws.name, settings } });
});

export const createInviteRoute = studioRoute(async (req, res) => {
  const { ws, role } = await requireWorkspace(req, String(req.params.id), 'manage');
  const p = z.object({ email: z.string().email().toLowerCase(), role: z.enum(['admin', 'editor', 'reviewer', 'viewer']) }).parse(req.body);
  if (p.role === 'admin' && role !== 'owner') throw new StudioError(403, 'FORBIDDEN', 'Only the owner can invite admins.');
  if (ws.settings.sso_domain && ws.settings.enforce_sso && !p.email.endsWith(`@${ws.settings.sso_domain}`)) {
    throw new StudioError(400, 'INVALID_INPUT', `This workspace only allows @${ws.settings.sso_domain} accounts.`);
  }
  const token = randomBytes(24).toString('base64url');
  const { data, error } = await supabase.from('studio_workspace_invites').insert({ workspace_id: ws.id, email: p.email, role: p.role, token, invited_by: uid(req) }).select('id, email, role, token').single();
  if (error) throw new StudioError(500, 'DATABASE_ERROR', error.message);
  await audit(req, { workspace_id: ws.id, action: 'member.invite', detail: { email: p.email, role: p.role } });
  res.status(201).json({ invite: data });
});

export const deleteInviteRoute = studioRoute(async (req, res) => {
  const { ws } = await requireWorkspace(req, String(req.params.id), 'manage');
  await supabase.from('studio_workspace_invites').delete().eq('workspace_id', ws.id).eq('id', String(req.params.invite_id));
  res.status(204).end();
});

export const acceptInviteRoute = studioRoute(async (req, res) => {
  const { data: inv } = await supabase.from('studio_workspace_invites').select('id, workspace_id, email, role, accepted_at').eq('token', String(req.params.token)).maybeSingle();
  if (!inv || inv.accepted_at) throw new StudioError(404, 'NOT_FOUND', 'This invite is no longer valid.');
  if ((inv.email as string).toLowerCase() !== email(req)) throw new StudioError(403, 'FORBIDDEN', `This invite was sent to ${inv.email}. Sign in with that account.`);
  await supabase.from('studio_workspace_members').upsert({ workspace_id: inv.workspace_id, user_id: uid(req), role: inv.role, email: email(req) }, { onConflict: 'workspace_id,user_id' });
  await supabase.from('studio_workspace_invites').update({ accepted_at: new Date().toISOString() }).eq('id', inv.id);
  await audit(req, { workspace_id: inv.workspace_id as string, action: 'member.join', detail: { role: inv.role } });
  res.json({ workspace_id: inv.workspace_id });
});

export const patchMemberRoute = studioRoute(async (req, res) => {
  const { ws, role } = await requireWorkspace(req, String(req.params.id), 'manage');
  const p = z.object({ role: z.enum(ROLES) }).parse(req.body);
  const target = String(req.params.user_id);
  if (!isUuid(target)) throw new StudioError(404, 'NOT_FOUND', 'Member not found');
  if ((p.role === 'owner' || p.role === 'admin') && role !== 'owner') throw new StudioError(403, 'FORBIDDEN', 'Only the owner can grant admin or owner.');
  if (target === ws.owner_id && p.role !== 'owner') throw new StudioError(400, 'INVALID_INPUT', 'Transfer ownership before changing the owner’s role.');
  if (p.role === 'owner') {
    await supabase.from('studio_workspaces').update({ owner_id: target }).eq('id', ws.id);
    await supabase.from('studio_workspace_members').update({ role: 'admin' }).eq('workspace_id', ws.id).eq('user_id', ws.owner_id);
  }
  await supabase.from('studio_workspace_members').update({ role: p.role }).eq('workspace_id', ws.id).eq('user_id', target);
  await audit(req, { workspace_id: ws.id, action: 'member.role', detail: { user_id: target, role: p.role } });
  res.json({ ok: true });
});

export const deleteMemberRoute = studioRoute(async (req, res) => {
  const target = String(req.params.user_id);
  const self = target === uid(req);
  const { ws } = await requireWorkspace(req, String(req.params.id), self ? 'view' : 'manage');
  if (target === ws.owner_id) throw new StudioError(400, 'INVALID_INPUT', 'The owner can’t leave; transfer ownership first.');
  await supabase.from('studio_workspace_members').delete().eq('workspace_id', ws.id).eq('user_id', target);
  await audit(req, { workspace_id: ws.id, action: self ? 'member.leave' : 'member.remove', detail: { user_id: target } });
  res.status(204).end();
});

export const putWorkspaceKeyRoute = studioRoute(async (req, res) => {
  const { ws } = await requireWorkspace(req, String(req.params.id), 'manage');
  if (!providerKeysConfigured()) throw new StudioError(503, 'NOT_CONFIGURED', 'Shared keys are not enabled on this server (PROVIDER_KEYS_SECRET).');
  const { api_key } = z.object({ api_key: z.string().trim().min(20).max(200) }).parse(req.body);
  if (!(await verifyElevenLabsKey(api_key))) throw new StudioError(400, 'KEY_REJECTED', 'ElevenLabs rejected this key.');
  const { last4 } = await saveWorkspaceProviderKey(ws.id, 'elevenlabs', api_key, uid(req));
  await audit(req, { workspace_id: ws.id, action: 'provider_key.save', detail: { scope: 'workspace', last4 } });
  res.json({ elevenlabs: { configured: true, last4 } });
});

export const deleteWorkspaceKeyRoute = studioRoute(async (req, res) => {
  const { ws } = await requireWorkspace(req, String(req.params.id), 'manage');
  await deleteWorkspaceProviderKey(ws.id, 'elevenlabs');
  await audit(req, { workspace_id: ws.id, action: 'provider_key.delete', detail: { scope: 'workspace' } });
  res.status(204).end();
});

export const workspaceUsageRoute = studioRoute(async (req, res) => {
  const { ws } = await requireWorkspace(req, String(req.params.id), 'manage');
  const month = typeof req.query.month === 'string' && /^\d{4}-\d{2}$/.test(req.query.month) ? req.query.month : new Date().toISOString().slice(0, 7);
  const since = `${month}-01T00:00:00.000Z`;
  const [y, m] = month.split('-').map(Number);
  const until = new Date(Date.UTC(y, m, 1)).toISOString();
  const [{ data: takes }, { data: runs }, { data: members }, { data: projects }] = await Promise.all([
    supabase.from('voiceover_tts_takes').select('user_id, project_id, chars, credits_deducted, key_source').eq('workspace_id', ws.id).eq('status', 'succeeded').gte('created_at', since).lt('created_at', until),
    supabase.from('primitive_runs').select('user_id, status, credits_deducted, input').eq('primitive_id', 'voiceover_render').filter('input->provenance->>workspace_id', 'eq', ws.id).gte('created_at', since).lt('created_at', until),
    supabase.from('studio_workspace_members').select('user_id, email, role').eq('workspace_id', ws.id),
    supabase.from('voiceover_projects').select('id, title').eq('workspace_id', ws.id),
  ]);
  type Row = { tts_chars: number; tts_credits: number; renders: number; render_credits: number; render_minutes: number };
  const blank = (): Row => ({ tts_chars: 0, tts_credits: 0, renders: 0, render_credits: 0, render_minutes: 0 });
  const byMember = new Map<string, Row>();
  const byProject = new Map<string, Row>();
  const get = (m: Map<string, Row>, k: string) => { if (!m.has(k)) m.set(k, blank()); return m.get(k)!; };
  for (const t of takes ?? []) {
    for (const r of [get(byMember, t.user_id as string), get(byProject, (t.project_id as string) ?? 'deleted')]) {
      r.tts_chars += Number(t.chars ?? 0);
      r.tts_credits += Number(t.credits_deducted ?? 0);
    }
  }
  for (const r0 of runs ?? []) {
    if (r0.status === 'failed') continue;
    const pid = (r0.input as { project_id?: string })?.project_id ?? 'deleted';
    const mins = Number((r0.input as { duration?: number })?.duration ?? 0) / 60;
    for (const r of [get(byMember, r0.user_id as string), get(byProject, pid)]) {
      r.renders += 1;
      r.render_credits += Number(r0.credits_deducted ?? 0);
      r.render_minutes += mins;
    }
  }
  const memberRows = [...byMember.entries()].map(([id, r]) => ({ user_id: id, email: (members ?? []).find((m) => m.user_id === id)?.email ?? null, ...r, total_credits: r.tts_credits + r.render_credits }));
  const projectRows = [...byProject.entries()].map(([id, r]) => ({ project_id: id, title: (projects ?? []).find((p) => p.id === id)?.title ?? '(deleted)', ...r, total_credits: r.tts_credits + r.render_credits }));
  const spend = await workspaceSpend(ws.id, undefined, since);
  if (req.query.format === 'csv') {
    const lines = ['scope,id,name,tts_chars,tts_credits,renders,render_minutes,render_credits,total_credits'];
    for (const r of memberRows) lines.push(['member', r.user_id, r.email ?? '', r.tts_chars, r.tts_credits, r.renders, r.render_minutes.toFixed(1), r.render_credits, r.total_credits].join(','));
    for (const r of projectRows) lines.push(['project', r.project_id, `"${String(r.title).replace(/"/g, '""')}"`, r.tts_chars, r.tts_credits, r.renders, r.render_minutes.toFixed(1), r.render_credits, r.total_credits].join(','));
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="studio-usage-${month}.csv"`);
    res.send(lines.join('\n'));
    return;
  }
  res.json({ month, budget: ws.settings.monthly_credit_budget, member_cap: ws.settings.member_monthly_cap, spent: spend.tts + spend.render, members: memberRows, projects: projectRows });
});

export const workspaceAuditRoute = studioRoute(async (req, res) => {
  const { ws } = await requireWorkspace(req, String(req.params.id), 'manage');
  const limit = Math.min(500, Number(req.query.limit ?? 200) || 200);
  const { data } = await supabase.from('voiceover_audit').select('id, project_id, user_id, user_email, action, detail, created_at').eq('workspace_id', ws.id).order('created_at', { ascending: false }).limit(limit);
  res.json({ events: data ?? [] });
});

/** Cron: delete source recordings older than each workspace's retention policy. */
export async function retentionSweepRoute(req: Request, res: Response): Promise<void> {
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret || req.header('x-internal-secret') !== secret) { res.status(401).json({ error: { code: 'UNAUTHORIZED' } }); return; }
  const { data: wss } = await supabase.from('studio_workspaces').select('id, settings');
  let purged = 0;
  for (const w of wss ?? []) {
    const days = Number((w.settings as { retention_days?: number } | null)?.retention_days ?? 0);
    if (!days) continue;
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    const { data: projects } = await supabase.from('voiceover_projects').select('id, source').eq('workspace_id', w.id).lt('created_at', cutoff);
    for (const p of projects ?? []) {
      const s = (p.source ?? {}) as { url?: string; proxy_url?: string; filmstrip?: { url?: string }; purged_at?: string };
      if (s.purged_at) continue;
      await deleteStudioObjectsByUrl([s.url, s.proxy_url, s.filmstrip?.url]).catch(() => 0);
      await supabase.from('voiceover_projects').update({ source: { ...s, purged_at: new Date().toISOString() } }).eq('id', p.id);
      await supabase.from('voiceover_audit').insert({ workspace_id: w.id, project_id: p.id, action: 'retention.purge_source', detail: { days } });
      purged++;
    }
  }
  res.json({ purged });
}

export type { StudioRole };
