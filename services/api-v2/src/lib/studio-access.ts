// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Voiceover Studio authorization, audit and governance.
 *
 * A project is either personal (workspace_id null → only its creator) or in a
 * workspace, where the member's role decides what they can do:
 *
 *   owner / admin  everything, incl. members, keys, settings, usage, audit
 *   editor         edit, generate voice, render, comment, submit for review
 *   reviewer       view, comment, approve / request changes
 *   viewer         view only
 */

import type { Request } from 'express';
import { supabase } from '../server.js';

export type StudioRole = 'owner' | 'admin' | 'editor' | 'reviewer' | 'viewer';
export type StudioAction = 'view' | 'comment' | 'edit' | 'render' | 'approve' | 'delete' | 'manage';

const CAN: Record<StudioAction, StudioRole[]> = {
  view: ['owner', 'admin', 'editor', 'reviewer', 'viewer'],
  comment: ['owner', 'admin', 'editor', 'reviewer'],
  edit: ['owner', 'admin', 'editor'],
  render: ['owner', 'admin', 'editor'],
  approve: ['owner', 'admin', 'reviewer'],
  delete: ['owner', 'admin'],
  manage: ['owner', 'admin'],
};

export function roleCan(role: StudioRole, action: StudioAction): boolean {
  return CAN[action].includes(role);
}

export interface WorkspaceSettings {
  require_approval: boolean;
  require_voice_consent: boolean;
  sso_domain: string | null;
  enforce_sso: boolean;
  monthly_credit_budget: number | null;
  member_monthly_cap: number | null;
  retention_days: number | null;
  data_region: string;
  disclosure_badge: boolean;
  webhook_url: string | null;
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  require_approval: false,
  require_voice_consent: true,
  sso_domain: null,
  enforce_sso: false,
  monthly_credit_budget: null,
  member_monthly_cap: null,
  retention_days: null,
  data_region: 'default',
  disclosure_badge: false,
  webhook_url: null,
};

export interface Workspace {
  id: string;
  name: string;
  owner_id: string;
  settings: WorkspaceSettings;
}

export class StudioError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

export const PROJECT_COLUMNS =
  'id, user_id, workspace_id, title, source, timeline, analysis, prepare_status, review_status, approved_by, approved_at, language, series, source_project_id, storage_region, automation, last_render_run_id, created_at, updated_at';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);

export async function loadWorkspace(id: string): Promise<Workspace | null> {
  if (!isUuid(id)) return null;
  const { data } = await supabase.from('studio_workspaces').select('id, name, owner_id, settings').eq('id', id).maybeSingle();
  if (!data) return null;
  return { ...(data as Workspace), settings: { ...DEFAULT_WORKSPACE_SETTINGS, ...((data.settings as object) ?? {}) } };
}

export async function workspaceRole(workspaceId: string, userId: string): Promise<StudioRole | null> {
  const { data } = await supabase
    .from('studio_workspace_members')
    .select('role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  return (data?.role as StudioRole | undefined) ?? null;
}

/** Decode the (already verified) JWT to read how the user signed in. */
export function signedInWithSso(req: Request): boolean {
  const token = (req as unknown as { authToken?: string }).authToken;
  if (!token || token.startsWith('ma_')) return true; // API keys are minted by a signed-in user
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as { amr?: Array<{ method?: string } | string> };
    return (payload.amr ?? []).some((m) => (typeof m === 'string' ? m : m.method ?? '').startsWith('sso'));
  } catch {
    return false;
  }
}

/** Enforce a workspace's SSO policy for this request. */
export function assertSso(req: Request, ws: Workspace): void {
  if (!ws.settings.enforce_sso) return;
  if (!signedInWithSso(req)) {
    throw new StudioError(403, 'SSO_REQUIRED', `${ws.name} requires signing in with your company SSO${ws.settings.sso_domain ? ` (${ws.settings.sso_domain})` : ''}.`, { sso_domain: ws.settings.sso_domain });
  }
}

export async function requireWorkspace(req: Request, workspaceId: string, action: StudioAction): Promise<{ ws: Workspace; role: StudioRole }> {
  const userId = (req as unknown as { userId: string }).userId;
  const ws = await loadWorkspace(workspaceId);
  if (!ws) throw new StudioError(404, 'NOT_FOUND', 'Workspace not found');
  const role = await workspaceRole(ws.id, userId);
  if (!role) throw new StudioError(404, 'NOT_FOUND', 'Workspace not found');
  assertSso(req, ws);
  if (!roleCan(role, action)) throw new StudioError(403, 'FORBIDDEN', `Your role (${role}) can't do that.`);
  return { ws, role };
}

export type ProjectRow = Record<string, any> & { id: string; user_id: string; workspace_id: string | null };

export async function requireProject(
  req: Request,
  projectId: string,
  action: StudioAction,
): Promise<{ project: ProjectRow; role: StudioRole; ws: Workspace | null }> {
  const userId = (req as unknown as { userId: string }).userId;
  if (!isUuid(projectId)) throw new StudioError(404, 'NOT_FOUND', 'Project not found');
  const { data, error } = await supabase.from('voiceover_projects').select(PROJECT_COLUMNS).eq('id', projectId).maybeSingle();
  if (error) throw new StudioError(500, 'DATABASE_ERROR', error.message);
  if (!data) throw new StudioError(404, 'NOT_FOUND', 'Project not found');
  const project = data as ProjectRow;
  if (!project.workspace_id) {
    if (project.user_id !== userId) throw new StudioError(404, 'NOT_FOUND', 'Project not found');
    return { project, role: 'owner', ws: null };
  }
  const ws = await loadWorkspace(project.workspace_id);
  const role = ws ? await workspaceRole(ws.id, userId) : null;
  if (!ws || !role) throw new StudioError(404, 'NOT_FOUND', 'Project not found');
  assertSso(req, ws);
  if (!roleCan(role, action)) throw new StudioError(403, 'FORBIDDEN', `Your role (${role}) can't ${action} this project.`);
  return { project, role, ws };
}

export async function audit(
  req: Request,
  entry: { workspace_id?: string | null; project_id?: string | null; action: string; detail?: Record<string, unknown> },
): Promise<void> {
  const r = req as unknown as { userId?: string; userEmail?: string; ip?: string };
  await supabase.from('voiceover_audit').insert({
    workspace_id: entry.workspace_id ?? null,
    project_id: entry.project_id ?? null,
    user_id: r.userId ?? null,
    user_email: r.userEmail ?? null,
    action: entry.action,
    detail: { ...(entry.detail ?? {}), ip: r.ip ?? null },
  });
}

function monthStart(d = new Date()): string {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

/** Studio credits spent this calendar month in a workspace (optionally by one member). */
export async function workspaceSpend(workspaceId: string, userId?: string, since = monthStart()): Promise<{ tts: number; render: number }> {
  let q1 = supabase.from('voiceover_tts_takes').select('credits_deducted').eq('workspace_id', workspaceId).eq('status', 'succeeded').gte('created_at', since);
  if (userId) q1 = q1.eq('user_id', userId);
  let q2 = supabase
    .from('primitive_runs')
    .select('credits_deducted, status')
    .eq('primitive_id', 'voiceover_render')
    .filter('input->provenance->>workspace_id', 'eq', workspaceId)
    .gte('created_at', since);
  if (userId) q2 = q2.eq('user_id', userId);
  // Presenter takes are video generation too: they count with renders.
  let q3 = supabase
    .from('primitive_runs')
    .select('credits_deducted, status')
    .eq('primitive_id', 'voiceover_presenter')
    .filter('input->>workspace_id', 'eq', workspaceId)
    .gte('created_at', since);
  if (userId) q3 = q3.eq('user_id', userId);
  const [{ data: t }, { data: r }, { data: pr }] = await Promise.all([q1, q2, q3]);
  const paid = (rows: Array<{ credits_deducted: unknown; status: unknown }> | null) =>
    (rows ?? []).filter((x) => x.status !== 'failed').reduce((s, x) => s + Number(x.credits_deducted ?? 0), 0);
  return {
    tts: (t ?? []).reduce((s, x) => s + Number(x.credits_deducted ?? 0), 0),
    render: paid(r) + paid(pr),
  };
}

/** Throws BUDGET_EXCEEDED when spending `credits` more would cross a workspace or member cap. */
export async function assertBudget(ws: Workspace | null, userId: string, credits: number): Promise<void> {
  if (!ws || credits <= 0) return;
  const { monthly_credit_budget: budget, member_monthly_cap: cap } = ws.settings;
  if (budget) {
    const s = await workspaceSpend(ws.id);
    if (s.tts + s.render + credits > budget) {
      throw new StudioError(402, 'BUDGET_EXCEEDED', `${ws.name} has used ${s.tts + s.render} of its ${budget}-credit monthly Studio budget. Ask an admin to raise it.`);
    }
  }
  if (cap) {
    const s = await workspaceSpend(ws.id, userId);
    if (s.tts + s.render + credits > cap) {
      throw new StudioError(402, 'BUDGET_EXCEEDED', `You've used ${s.tts + s.render} of your ${cap}-credit monthly allowance in ${ws.name}.`);
    }
  }
}

/** Express adapter: turn StudioError into a JSON response. */
export function studioRoute(fn: (req: Request, res: import('express').Response) => Promise<void>) {
  return async (req: Request, res: import('express').Response): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof StudioError) {
        res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.extra ?? {}) } });
        return;
      }
      console.error('[studio]', err);
      res.status(500).json({ error: { code: 'INTERNAL', message: 'Something went wrong.' } });
    }
  };
}
