// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

'use client';

/**
 * /dashboard/studio — Voiceover Studio projects.
 *
 * Upload a screen recording (Filmora, OBS, Loom export…), then cut it, zoom
 * into what matters, add animated text and narrate it with ElevenLabs — your
 * own cloned voice or ours.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Clapperboard, Loader2, Trash2, Upload } from 'lucide-react';
import { invokeFn } from '@/lib/supabase/fn-proxy';
import { getVar } from '@/components/variable-context';
import { studioApi, type StudioProject } from './_lib/api';
import { fmtTime } from './_lib/ops';
import { C } from './_components/ui';

const UPLOAD_BUCKET = 'generation-inputs';
const MAX_BYTES = 100 * 1024 * 1024;
const supabaseUrl = () => (getVar('supabaseUrl', process.env.NEXT_PUBLIC_SUPABASE_URL ?? '') ?? '').replace(/\/+$/, '');

function readVideoMeta(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const url = URL.createObjectURL(file);
    v.onloadedmetadata = () => {
      const meta = { duration: v.duration, width: v.videoWidth, height: v.videoHeight };
      URL.revokeObjectURL(url);
      if (!meta.duration || !Number.isFinite(meta.duration) || !meta.width) reject(new Error('Could not read this video. Export it as MP4 (H.264) and try again.'));
      else resolve(meta);
    };
    v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This browser cannot read that video. Export it as MP4 (H.264).')); };
    v.src = url;
  });
}

function putWithProgress(url: string, file: File, onProgress: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4');
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Upload failed — check your connection.'));
    xhr.send(file);
  });
}

export default function StudioPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<StudioProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ name: string; pct: number; stage: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    studioApi.listProjects().then((r) => setProjects(r.projects)).catch((e: Error) => { setError(e.message); setProjects([]); });
  }, []);

  async function start(file: File) {
    setError(null);
    if (!/^video\/(mp4|quicktime|webm)$/.test(file.type)) { setError('Upload an MP4, MOV or WebM screen recording.'); return; }
    if (file.size > MAX_BYTES) { setError('That file is over 100 MB. Export a shorter range or at a lower bitrate (Filmora: H.264, 8–12 Mbps is plenty for screen captures).'); return; }
    setUpload({ name: file.name, pct: 0, stage: 'Reading video' });
    try {
      const meta = await readVideoMeta(file);
      setUpload({ name: file.name, pct: 0, stage: 'Uploading' });
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
      const { data, error: fnErr } = await invokeFn('upload-url', { body: { filename: safeName, content_type: file.type } });
      if (fnErr || !data?.upload_url) throw new Error(fnErr?.message ?? 'Could not start the upload');
      await putWithProgress(data.upload_url, file, (pct) => setUpload({ name: file.name, pct, stage: 'Uploading' }));
      setUpload({ name: file.name, pct: 1, stage: 'Preparing editor' });
      const { project } = await studioApi.createProject({
        title: file.name.replace(/\.[^.]+$/, '').slice(0, 200) || 'Untitled voiceover',
        source_url: `${supabaseUrl()}/storage/v1/object/public/${UPLOAD_BUCKET}/${data.storage_path}`,
        duration: meta.duration,
        width: meta.width,
        height: meta.height,
      });
      router.push(`/dashboard/studio/${project.id}`);
    } catch (e) {
      setError((e as Error).message);
      setUpload(null);
    }
  }

  async function remove(id: string) {
    if (!confirm('Delete this project? Rendered videos stay in your Gallery.')) return;
    try { await studioApi.deleteProject(id); setProjects((p) => (p ?? []).filter((x) => x.id !== id)); }
    catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-8 py-10">
      <p className="text-[11px] font-semibold uppercase tracking-[0.2em]" style={{ color: C.faint }}>Voiceover Studio</p>
      <h1 className="mt-2 font-normal" style={{ color: C.text, fontSize: 'clamp(28px,2.6vw,36px)', letterSpacing: '-0.03em', lineHeight: 1.05 }}>
        Your screen recording, your voice.
      </h1>
      <p className="mt-2 max-w-2xl text-sm" style={{ color: C.muted }}>
        Drop in a silent capture from Filmora, OBS or any recorder. Cut it, zoom into the clicks that matter, add animated step labels,
        and narrate every scene with ElevenLabs — your own cloned voice or ours. Captions are timed from the voice automatically.
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f && !upload) void start(f); }}
        onClick={() => !upload && fileRef.current?.click()}
        className="mt-8 flex cursor-pointer flex-col items-center justify-center rounded-2xl px-6 py-10 text-center transition-colors"
        style={{ border: `1.5px dashed ${dragOver ? C.accent : C.line2}`, background: dragOver ? 'rgba(167,139,250,0.06)' : C.card }}
      >
        <input ref={fileRef} type="file" accept="video/mp4,video/quicktime,video/webm" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void start(f); e.target.value = ''; }} />
        {upload ? (
          <div className="w-full max-w-sm">
            <p className="truncate text-sm" style={{ color: C.text }}>{upload.name}</p>
            <p className="mt-1 text-xs" style={{ color: C.muted }}>{upload.stage}{upload.stage === 'Uploading' ? ` · ${Math.round(upload.pct * 100)}%` : '…'}</p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ background: C.bg }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(4, upload.pct * 100)}%`, background: C.accent }} />
            </div>
          </div>
        ) : (
          <>
            <Upload className="h-6 w-6" style={{ color: C.accent }} />
            <p className="mt-3 text-sm font-medium" style={{ color: C.text }}>Drop a screen recording, or click to choose</p>
            <p className="mt-1 text-xs" style={{ color: C.faint }}>MP4 / MOV / WebM · up to 100 MB · no voice or captions needed</p>
          </>
        )}
      </div>

      {error ? <div className="mt-4 rounded-xl px-4 py-3 text-sm" style={{ border: '1px solid rgba(255,79,79,0.3)', background: 'rgba(255,79,79,0.08)', color: '#FCA5A5' }}>{error}</div> : null}

      <section className="mt-10">
        <p className="mb-3 text-xs font-semibold" style={{ color: C.muted }}>Projects</p>
        {projects === null ? (
          <Loader2 className="h-4 w-4 animate-spin" style={{ color: C.muted }} />
        ) : projects.length === 0 ? (
          <p className="text-sm" style={{ color: C.faint }}>No projects yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((pr) => (
              <div key={pr.id} className="group overflow-hidden rounded-2xl" style={{ background: C.card, border: `1px solid ${C.line}` }}>
                <Link href={`/dashboard/studio/${pr.id}`} className="block">
                  <div className="relative aspect-video" style={{ background: '#000' }}>
                    {pr.source?.url ? <video src={`${pr.source.url}#t=1`} muted preload="metadata" className="h-full w-full object-contain" /> : <Clapperboard className="m-auto h-6 w-6" />}
                  </div>
                  <div className="px-3 py-2.5">
                    <p className="truncate text-sm" style={{ color: C.text }}>{pr.title}</p>
                    <p className="text-[11px]" style={{ color: C.faint }}>
                      {pr.source ? `${fmtTime(pr.source.duration, false)} · ${pr.source.width}×${pr.source.height} · ` : ''}
                      edited {new Date(pr.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </p>
                  </div>
                </Link>
                <div className="flex justify-end px-3 pb-2">
                  <button type="button" onClick={() => remove(pr.id)} className="inline-flex items-center gap-1 text-[11px] opacity-0 transition-opacity group-hover:opacity-100" style={{ color: '#FCA5A5' }}>
                    <Trash2 className="h-3 w-3" /> Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
