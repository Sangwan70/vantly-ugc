// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/** Typed client for /api/v1/studio/* (proxied to api-v2 /v1/studio/*). */

import type { EditSuggestionLike, VoiceoverSource, VoiceoverTimeline, VoiceSettings, VoiceoverWord } from '@vantly-ugc/schema';

export type VoiceSource = 'platform' | 'user' | 'workspace';
export type Role = 'owner' | 'admin' | 'editor' | 'reviewer' | 'viewer';
export type ReviewStatus = 'draft' | 'in_review' | 'changes_requested' | 'approved';

export interface Filmstrip { url: string; interval: number; cols: number; count: number; tile_w: number; tile_h: number }

export interface StudioSource extends VoiceoverSource {
  proxy_url?: string;
  filmstrip?: Filmstrip;
  purged_at?: string;
}

export interface StudioProject {
  id: string;
  user_id: string;
  workspace_id: string | null;
  title: string;
  source: StudioSource | null;
  timeline: VoiceoverTimeline;
  analysis: { suggestions: Array<EditSuggestionLike & { confidence: number; reason: string }> } | null;
  prepare_status: 'pending' | 'running' | 'ready' | 'failed';
  review_status: ReviewStatus;
  approved_by: string | null;
  approved_at: string | null;
  language: string | null;
  series: string | null;
  source_project_id: string | null;
  automation: { status?: string; warnings?: string[] } | null;
  last_render_run_id: string | null;
  created_at: string;
  updated_at: string;
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

export interface Voice { voice_id: string; name: string; preview_url: string | null; category?: string; labels?: Record<string, string> }
export interface Model { model_id: string; name: string; description?: string; max_characters?: number }

export interface VoicesResponse {
  platform: { configured: boolean; voices: Voice[]; error?: string };
  user: { configured: boolean; voices: Voice[]; last4?: string; error?: string; byo_supported?: boolean };
  workspace?: { configured: boolean; voices: Voice[]; last4?: string; error?: string; name: string };
  models: Model[];
  consented_voice_ids?: string[];
  pricing: { tts_credits_per_1k_chars: number; charges: boolean };
}

export interface TtsResult { take_id: string; audio_url: string; audio_duration: number; words: VoiceoverWord[]; credits_deducted: number; consent_id: string | null }

export interface RenderStatus {
  run_id: string;
  status: 'submitted' | 'running' | 'succeeded' | 'failed' | 'canceled';
  progress: { stage?: string; pct?: number } | null;
  video_url: string | null;
  videos: Array<{ aspect: string; url: string; bytes: number | null; width?: number; height?: number }>;
  manifest_url: string | null;
  c2pa_url: string | null;
  credits_deducted: number;
  error: { code: string | null; message: string | null } | null;
}

export interface Comment { id: string; user_id: string | null; author_email: string | null; t: number | null; body: string; parent_id: string | null; resolved: boolean; kind: string; created_at: string }
export interface Template { id: string; name: string; description: string; workspace_id: string | null; has_intro: boolean; has_outro: boolean; created_at: string }
export interface Consent { id: string; workspace_id: string | null; voice_id: string; voice_name: string; voice_source: string; speaker_name: string; statement: string; evidence_url: string | null; attested_by_email: string | null; attested_at: string; revoked_at: string | null }

export class StudioApiError extends Error {
  constructor(public status: number, public code: string, message: string, public extra?: Record<string, unknown>) {
    super(message);
  }
}

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const r = await fetch(`/api/v1/studio/${path}`, {
    method: init?.method ?? 'GET',
    credentials: 'include',
    headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (r.status === 204) return undefined as T;
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const e = (j as { error?: { code?: string; message?: string } & Record<string, unknown> } | null)?.error;
    throw new StudioApiError(r.status, e?.code ?? 'error', e?.message ?? `Request failed (${r.status})`, e ?? undefined);
  }
  return j as T;
}

const q = (o: Record<string, string | null | undefined>) => {
  const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v) as [string, string][]).toString();
  return s ? `?${s}` : '';
};

export const studioApi = {
  listProjects: (o?: { workspace_id?: string | null; series?: string | null }) => call<{ projects: StudioProject[] }>(`projects${q(o ?? {})}`),
  createProject: (body: { title: string; source_url: string; duration: number; width: number; height: number; has_audio?: boolean; workspace_id?: string | null; template_id?: string | null; series?: string | null }) =>
    call<{ project: StudioProject }>('projects', { method: 'POST', body }),
  getProject: (id: string) => call<{ project: StudioProject; role: Role; workspace: { id: string; name: string; settings: Pick<WorkspaceSettings, 'require_approval' | 'require_voice_consent'> } | null }>(`projects/${id}`),
  saveProject: (id: string, body: { title?: string; timeline?: VoiceoverTimeline; series?: string | null; workspace_id?: string | null }) =>
    call<{ project: { id: string; updated_at: string; review_status: ReviewStatus } }>(`projects/${id}`, { method: 'PATCH', body }),
  deleteProject: (id: string) => call<void>(`projects/${id}`, { method: 'DELETE' }),
  prepare: (id: string) => call<{ prepare_status: string }>(`projects/${id}/prepare`, { method: 'POST', body: {} }),
  startUpload: (body: { filename: string; content_type: string; bytes: number; workspace_id?: string | null }) =>
    call<{ key: string; upload_id: string; part_size: number; part_urls: string[]; public_url: string; region: string }>('uploads', { method: 'POST', body }),
  completeUpload: (body: { key: string; upload_id: string; parts: Array<{ part_number: number; etag: string }> }) => call<{ url: string }>('uploads/complete', { method: 'POST', body }),
  abortUpload: (body: { key: string; upload_id: string }) => call<void>('uploads/abort', { method: 'POST', body }),
  asset: (body: { kind: 'music' | 'logo' | 'font' | 'evidence'; url: string; project_id?: string; name?: string }) => call<{ url: string; name: string }>('assets', { method: 'POST', body }),
  voices: (workspaceId?: string | null) => call<VoicesResponse>(`voices${q({ workspace_id: workspaceId })}`),
  getKey: () => call<{ supported: boolean; elevenlabs: { configured: boolean; last4?: string } }>('provider-key'),
  saveKey: (api_key: string) => call<{ elevenlabs: { configured: boolean; last4: string } }>('provider-key', { method: 'PUT', body: { api_key } }),
  deleteKey: () => call<void>('provider-key', { method: 'DELETE' }),
  tts: (body: {
    project_id: string; block_id: string; text: string; voice_id: string; voice_source: VoiceSource; model_id: string; settings: VoiceSettings;
    previous_text?: string; next_text?: string; language_code?: string;
  }) => call<TtsResult>('tts', { method: 'POST', body }),
  quote: (id: string) => call<{ output_seconds: number; credits: number; formats: string[] }>(`projects/${id}/quote`, { method: 'POST', body: {} }),
  render: (id: string, body: { notify_email?: string | null } = {}) => call<{ run_id: string; credits: number }>(`projects/${id}/render`, { method: 'POST', body }),
  renderStatus: (runId: string) => call<RenderStatus>(`renders/${runId}`),
  /** Start presenter takes for blocks; blocks whose clip is already made come back in `cached`. */
  startPresenter: (id: string, block_ids: string[], remake = false) =>
    call<{ takes: Array<{ block_id: string; run_id: string; clip_key: string; credits: number }>; cached: Array<{ block_id: string; clip_url: string; clip_key: string }>; credits: number }>(`projects/${id}/presenter`, { method: 'POST', body: { block_ids, remake } }),
  presenterStatus: (runId: string) =>
    call<{ run_id: string; status: string; block_id: string | null; clip_key: string | null; clip_url: string | null; image_url: string | null; error: { code: string; message: string } | null }>(`presenter/${runId}`),
  /** Redraw the presenter photo in an outfit; poll presenterStatus for image_url. */
  dressPresenter: (id: string, outfit: string) => call<{ run_id: string; source_url: string }>(`projects/${id}/presenter/look`, { method: 'POST', body: { outfit } }),
  shorten: (body: { text: string; target_seconds: number; language?: string }) => call<{ text: string }>('assist/shorten', { method: 'POST', body }),
  localize: (id: string, body: { language: string; language_name: string; voice_id?: string; voice_name?: string; voice_source?: VoiceSource; translate_overlays?: boolean }) =>
    call<{ project: { id: string; title: string } }>(`projects/${id}/localize`, { method: 'POST', body }),
  templates: () => call<{ templates: Template[] }>('templates'),
  saveTemplate: (body: { name: string; description?: string; project_id: string; workspace_id?: string | null }) => call<{ template: { id: string } }>('templates', { method: 'POST', body }),
  deleteTemplate: (id: string) => call<void>(`templates/${id}`, { method: 'DELETE' }),
  applyTemplate: (id: string, template_id: string) => call<{ timeline: VoiceoverTimeline }>(`projects/${id}/apply-template`, { method: 'POST', body: { template_id } }),
  review: (id: string, action: 'submit' | 'approve' | 'request_changes' | 'reopen', note?: string) => call<{ review_status: ReviewStatus }>(`projects/${id}/review`, { method: 'POST', body: { action, note } }),
  comments: (id: string) => call<{ comments: Comment[] }>(`projects/${id}/comments`),
  addComment: (id: string, body: { t?: number | null; body: string; parent_id?: string | null }) => call<{ comment: Comment }>(`projects/${id}/comments`, { method: 'POST', body }),
  patchComment: (cid: string, body: { resolved?: boolean; body?: string }) => call<void>(`comments/${cid}`, { method: 'PATCH', body }),
  deleteComment: (cid: string) => call<void>(`comments/${cid}`, { method: 'DELETE' }),
  consents: (workspaceId?: string | null) => call<{ consents: Consent[] }>(`consents${q({ workspace_id: workspaceId })}`),
  addConsent: (body: { voice_id: string; voice_name: string; voice_source: 'user' | 'workspace'; speaker_name: string; statement: string; evidence_url?: string | null; workspace_id?: string | null }) =>
    call<{ consent: { id: string } }>('consents', { method: 'POST', body }),
  revokeConsent: (id: string) => call<void>(`consents/${id}`, { method: 'DELETE' }),
  workspaces: () => call<{ workspaces: Array<{ id: string; name: string; role: Role; settings: WorkspaceSettings }>; invites: Array<{ token: string; role: Role; workspace: { id: string; name: string } }>; regions: string[] }>('workspaces'),
  createWorkspace: (name: string) => call<{ workspace: { id: string; name: string } }>('workspaces', { method: 'POST', body: { name } }),
  workspace: (id: string) => call<{
    workspace: { id: string; name: string; settings: WorkspaceSettings }; role: Role;
    members: Array<{ user_id: string; role: Role; email: string | null; created_at: string }>;
    invites: Array<{ id: string; email: string; role: Role; token: string; created_at: string }>;
    provider_key: { supported: boolean; elevenlabs: { configured: boolean; last4?: string } } | null; regions: string[];
  }>(`workspaces/${id}`),
  patchWorkspace: (id: string, body: { name?: string; settings?: Partial<WorkspaceSettings> }) => call<{ workspace: { id: string; name: string; settings: WorkspaceSettings } }>(`workspaces/${id}`, { method: 'PATCH', body }),
  invite: (id: string, body: { email: string; role: Role }) => call<{ invite: { id: string; token: string } }>(`workspaces/${id}/invites`, { method: 'POST', body }),
  deleteInvite: (id: string, inviteId: string) => call<void>(`workspaces/${id}/invites/${inviteId}`, { method: 'DELETE' }),
  acceptInvite: (token: string) => call<{ workspace_id: string }>(`invites/${encodeURIComponent(token)}/accept`, { method: 'POST', body: {} }),
  setRole: (id: string, userId: string, role: Role) => call<void>(`workspaces/${id}/members/${userId}`, { method: 'PATCH', body: { role } }),
  removeMember: (id: string, userId: string) => call<void>(`workspaces/${id}/members/${userId}`, { method: 'DELETE' }),
  saveWorkspaceKey: (id: string, api_key: string) => call<{ elevenlabs: { last4: string } }>(`workspaces/${id}/provider-key`, { method: 'PUT', body: { api_key } }),
  deleteWorkspaceKey: (id: string) => call<void>(`workspaces/${id}/provider-key`, { method: 'DELETE' }),
  usage: (id: string, month?: string) => call<{
    month: string; budget: number | null; member_cap: number | null; spent: number;
    members: Array<{ user_id: string; email: string | null; tts_chars: number; tts_credits: number; renders: number; render_minutes: number; render_credits: number; total_credits: number }>;
    projects: Array<{ project_id: string; title: string; tts_chars: number; tts_credits: number; renders: number; render_minutes: number; render_credits: number; total_credits: number }>;
  }>(`workspaces/${id}/usage${q({ month })}`),
  usageCsvUrl: (id: string, month: string) => `/api/v1/studio/workspaces/${id}/usage?month=${month}&format=csv`,
  audit: (id: string) => call<{ events: Array<{ id: number; project_id: string | null; user_email: string | null; action: string; detail: Record<string, unknown>; created_at: string }> }>(`workspaces/${id}/audit`),
};

/**
 * Upload straight to Studio storage (multipart, 16 MB parts, 4 in parallel,
 * each part retried 3×). Works for 5 GB recordings and small assets alike.
 * The bucket's CORS must allow PUT and expose ETag.
 */
export async function uploadDirect(
  file: File,
  opts: { workspaceId?: string | null; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<string> {
  const type = file.type || (/\.ttf$/i.test(file.name) ? 'font/ttf' : /\.otf$/i.test(file.name) ? 'font/otf' : 'application/octet-stream');
  const up = await studioApi.startUpload({ filename: file.name, content_type: type, bytes: file.size, workspace_id: opts.workspaceId ?? null });
  const sent = new Array<number>(up.part_urls.length).fill(0);
  const report = () => opts.onProgress?.(sent.reduce((a, b) => a + b, 0) / file.size);
  const parts: Array<{ part_number: number; etag: string }> = [];
  const putPart = (i: number) =>
    new Promise<string>((resolve, reject) => {
      const blob = file.slice(i * up.part_size, Math.min(file.size, (i + 1) * up.part_size));
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', up.part_urls[i]);
      xhr.upload.onprogress = (e) => { sent[i] = e.loaded; report(); };
      xhr.onload = () => {
        const etag = xhr.getResponseHeader('ETag');
        if (xhr.status >= 200 && xhr.status < 300 && etag) { sent[i] = blob.size; report(); resolve(etag); }
        else reject(new Error(xhr.status >= 200 && xhr.status < 300 ? 'Upload blocked: storage CORS must expose the ETag header.' : `Part ${i + 1} failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new Error(`Part ${i + 1} failed — check your connection.`));
      opts.signal?.addEventListener('abort', () => xhr.abort());
      xhr.send(blob);
    });
  let next = 0;
  try {
    await Promise.all(
      Array.from({ length: Math.min(4, up.part_urls.length) }, async () => {
        while (next < up.part_urls.length) {
          const i = next++;
          let lastErr: unknown;
          for (let attempt = 0; attempt < 3; attempt++) {
            try { parts.push({ part_number: i + 1, etag: await putPart(i) }); lastErr = null; break; }
            catch (e) { lastErr = e; sent[i] = 0; if (opts.signal?.aborted) throw e; await new Promise((r) => setTimeout(r, 1000 * (attempt + 1))); }
          }
          if (lastErr) throw lastErr;
        }
      }),
    );
  } catch (e) {
    await studioApi.abortUpload({ key: up.key, upload_id: up.upload_id }).catch(() => {});
    throw e;
  }
  const { url } = await studioApi.completeUpload({ key: up.key, upload_id: up.upload_id, parts });
  return url;
}
