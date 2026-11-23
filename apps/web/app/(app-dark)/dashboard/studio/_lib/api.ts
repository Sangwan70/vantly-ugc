// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/** Typed client for /api/v1/studio/* (proxied to api-v2 /v1/studio/*). */

import type { VoiceoverSource, VoiceoverTimeline, VoiceSettings, VoiceoverWord } from '@vantly-ugc/schema';

export interface StudioProject {
  id: string;
  title: string;
  source: VoiceoverSource | null;
  timeline: VoiceoverTimeline;
  last_render_run_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface Voice {
  voice_id: string;
  name: string;
  preview_url: string | null;
  category?: string;
  labels?: Record<string, string>;
}

export interface Model {
  model_id: string;
  name: string;
  description?: string;
  max_characters?: number;
}

export interface VoicesResponse {
  platform: { configured: boolean; voices: Voice[]; error?: string };
  user: { configured: boolean; voices: Voice[]; last4?: string; error?: string; byo_supported?: boolean };
  models: Model[];
  pricing: { tts_credits_per_1k_chars: number; charges: boolean };
}

export interface TtsResult {
  take_id: string;
  audio_url: string;
  audio_duration: number;
  words: VoiceoverWord[];
  credits_deducted: number;
}

export interface RenderStatus {
  run_id: string;
  status: 'submitted' | 'running' | 'succeeded' | 'failed' | 'canceled';
  progress: { stage?: string; pct?: number } | null;
  video_url: string | null;
  credits_deducted: number;
  error: { code: string | null; message: string | null } | null;
}

export class StudioApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
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
    const e = (j as { error?: { code?: string; message?: string } } | null)?.error;
    throw new StudioApiError(r.status, e?.code ?? 'error', e?.message ?? `Request failed (${r.status})`);
  }
  return j as T;
}

export const studioApi = {
  listProjects: () => call<{ projects: StudioProject[] }>('projects'),
  createProject: (body: { title: string; source_url: string; duration: number; width: number; height: number; has_audio?: boolean }) =>
    call<{ project: StudioProject }>('projects', { method: 'POST', body }),
  getProject: (id: string) => call<{ project: StudioProject }>(`projects/${id}`),
  saveProject: (id: string, body: { title?: string; timeline?: VoiceoverTimeline }) =>
    call<{ project: { id: string; updated_at: string } }>(`projects/${id}`, { method: 'PATCH', body }),
  deleteProject: (id: string) => call<void>(`projects/${id}`, { method: 'DELETE' }),
  voices: () => call<VoicesResponse>('voices'),
  getKey: () => call<{ supported: boolean; elevenlabs: { configured: boolean; last4?: string } }>('provider-key'),
  saveKey: (api_key: string) => call<{ elevenlabs: { configured: boolean; last4: string } }>('provider-key', { method: 'PUT', body: { api_key } }),
  deleteKey: () => call<void>('provider-key', { method: 'DELETE' }),
  tts: (body: {
    project_id: string;
    block_id: string;
    text: string;
    voice_id: string;
    voice_source: 'platform' | 'user';
    model_id: string;
    settings: VoiceSettings;
    previous_text?: string;
    next_text?: string;
  }) => call<TtsResult>('tts', { method: 'POST', body }),
  quote: (id: string) => call<{ output_seconds: number; credits: number }>(`projects/${id}/quote`, { method: 'POST', body: {} }),
  render: (id: string) => call<{ run_id: string; credits: number }>(`projects/${id}/render`, { method: 'POST', body: {} }),
  renderStatus: (runId: string) => call<RenderStatus>(`renders/${runId}`),
};
