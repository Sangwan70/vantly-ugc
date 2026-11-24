// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * voiceover_render — Voiceover Studio export.
 *
 * Input: a screen recording + the Studio timeline. Output: one MP4 per
 * requested shape (batch export), each a primitive_artifact so it appears in
 * Gallery and can be published via Vantly, plus a provenance manifest
 * (AI-disclosure: voices used, consent records, approval, SHA-256).
 *
 * See lib/voiceover-ffmpeg.ts for the render plan.
 */

import { ApplicationFailure, Context } from '@temporalio/activity';
import {
  VoiceoverRenderInputSchema,
  clipOutputDuration,
  clipStarts,
  quoteVoiceoverRenderCredits,
  renderAspects,
  timelineDuration,
  timelineWords,
  validateVoiceoverForRender,
  type VoiceoverAspect,
} from '@vantly-ugc/schema';
import { createHash, createHmac } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cpus, tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { WorkerConfig } from '../config.js';
import { getDb } from '../client/db.js';
import { r2UploadVnext, type R2Config } from '../client/r2.js';
import { deductPrimitiveCredits, refundPrimitiveCredits } from '../client/credits.js';
import {
  XFADE_NAMES,
  buildAudioNormalizeArgs,
  buildCaptionsAss,
  buildCardAss,
  buildCardSegmentArgs,
  buildFinalArgs,
  buildJoinArgs,
  buildOverlayAss,
  buildSegmentArgs,
  computeCanvas,
  coverContentAt,
  concatListFile,
  hasTransitions,
  type FontResolver,
} from '../lib/voiceover-ffmpeg.js';

const execFileP = promisify(execFile);
const MAX_SOURCE_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB (multipart uploads)

export interface VoiceoverRenderActivityInput {
  primitive_run_id: string;
  user_id: string;
  input: unknown;
}

export interface VoiceoverRenderActivityResult {
  primitive_run_id: string;
  video_url: string;
  videos: Array<{ aspect: VoiceoverAspect; url: string; artifact_id: string }>;
  manifest_url: string | null;
  artifact_id: string;
  duration: number;
}

// ── Storage regions (data residency) ───────────────────────────────────────

/**
 * STUDIO_STORAGE_REGIONS='{"eu":{"bucket":"vantly-eu","publicUrl":"https://eu.example.com","accountId":"…"}}'
 * Credentials are shared with R2_*; only bucket/public URL (and optionally the
 * account/endpoint) differ per region.
 */
export function storageRegions(base: R2Config): Record<string, R2Config> {
  const out: Record<string, R2Config> = { default: base };
  try {
    const raw = JSON.parse(process.env.STUDIO_STORAGE_REGIONS ?? '{}') as Record<string, Partial<R2Config>>;
    for (const [k, v] of Object.entries(raw)) {
      if (v?.bucket && v.publicUrl) out[k] = { ...base, ...v, publicUrl: v.publicUrl.replace(/\/+$/, '') } as R2Config;
    }
  } catch { /* malformed → default only */ }
  return out;
}

// ── I/O helpers ─────────────────────────────────────────────────────────────

async function download(url: string, dest: string, maxBytes: number): Promise<void> {
  const resp = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(20 * 60_000) });
  if (resp.status >= 500) throw new Error(`fetch transient ${resp.status} for ${url}`);
  if (!resp.ok || !resp.body) {
    throw ApplicationFailure.nonRetryable(`fetch failed (${resp.status}) for ${url}`, 'REFERENCE_FETCH_FAILED');
  }
  const len = Number(resp.headers.get('content-length') ?? 0);
  if (len > maxBytes) throw ApplicationFailure.nonRetryable(`file too large (${len} bytes)`, 'REFERENCE_TOO_LARGE');
  await pipeline(Readable.fromWeb(resp.body as never), createWriteStream(dest));
}

async function probe(path: string): Promise<{ width: number; height: number; duration: number; hasAudio: boolean }> {
  const { stdout } = await execFileP('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=duration', '-of', 'json', path]);
  const j = JSON.parse(stdout) as { streams?: Array<{ codec_type: string; width?: number; height?: number }>; format?: { duration?: string } };
  const v = j.streams?.find((s) => s.codec_type === 'video');
  if (!v?.width || !v.height) throw ApplicationFailure.nonRetryable('source has no video stream', 'REFERENCE_NOT_VIDEO');
  return { width: v.width, height: v.height, duration: Number(j.format?.duration ?? 0), hasAudio: Boolean(j.streams?.some((s) => s.codec_type === 'audio')) };
}

let xfadeCache: Set<string> | null = null;
async function availableXfades(): Promise<Set<string>> {
  if (xfadeCache) return xfadeCache;
  try {
    const { stdout } = await execFileP('ffmpeg', ['-hide_banner', '-h', 'filter=xfade']);
    xfadeCache = new Set(stdout.match(/\b[a-z]+\b/g) ?? []);
  } catch {
    xfadeCache = new Set(['fade']);
  }
  return xfadeCache;
}

/** Run ffmpeg, heartbeating and reporting progress parsed from `time=`. */
export function runFfmpeg(args: string[], expectedSeconds: number, onPct?: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let tail = '';
    let lastBeat = 0;
    proc.stderr.on('data', (chunk: Buffer) => {
      const s = chunk.toString();
      tail = (tail + s).slice(-4000);
      const now = Date.now();
      if (now - lastBeat > 5000) {
        lastBeat = now;
        const m = /time=(\d+):(\d+):(\d+\.?\d*)/.exec(s);
        let pct: number | undefined;
        if (m && expectedSeconds > 0) {
          pct = Math.min(1, (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) / expectedSeconds);
          onPct?.(pct);
        }
        try { Context.current().heartbeat({ pct }); } catch { /* not in an activity (tests) */ }
      }
    });
    proc.on('error', reject);
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}: ${tail.split('\n').slice(-6).join(' | ')}`))));
  });
}

/** Run async jobs with bounded concurrency, preserving order of results. */
async function pool<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  });
  await Promise.all(workers);
}

async function sha256File(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex');
}

/** Optional C2PA signing when c2patool + a signing manifest are installed on the worker. */
async function maybeC2paSign(inPath: string, manifestPath: string): Promise<string | null> {
  const signer = process.env.C2PA_SIGNER_MANIFEST?.trim();
  if (!signer) return null;
  const out = inPath.replace(/\.mp4$/, '.c2pa.mp4');
  try {
    await execFileP('c2patool', [inPath, '-m', signer, '--parent-ingredient', manifestPath, '-o', out, '-f'], { maxBuffer: 16 * 1024 * 1024 });
    return out;
  } catch (err) {
    console.warn(`[voiceover] c2pa signing skipped: ${(err as Error).message}`);
    return null;
  }
}

async function notify(input: { webhook_url: string | null; notify_email: string | null }, payload: Record<string, unknown>): Promise<void> {
  if (input.webhook_url) {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const secret = process.env.STUDIO_WEBHOOK_SECRET?.trim();
    if (secret) headers['X-Vantly-Signature'] = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
    await fetch(input.webhook_url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10_000) }).catch(() => {});
  }
  const resendKey = process.env.RESEND_API_KEY?.trim();
  if (input.notify_email && resendKey) {
    const ok = payload.status === 'succeeded';
    const videos = (payload.videos as Array<{ aspect: string; url: string }> | undefined) ?? [];
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: process.env.STUDIO_NOTIFY_FROM ?? 'Vantly Studio <studio@vantly-ugc.com>',
        to: [input.notify_email],
        subject: ok ? `Your video "${payload.title}" is ready` : `Render failed: "${payload.title}"`,
        html: ok
          ? `<p>Your Voiceover Studio render finished.</p><ul>${videos.map((v) => `<li>${v.aspect}: <a href="${v.url}">download</a></li>`).join('')}</ul>`
          : `<p>The render failed: ${String(payload.error ?? 'unknown error')}. Any credits were refunded.</p>`,
      }),
      signal: AbortSignal.timeout(10_000),
    }).catch(() => {});
  }
}

// ── Activity ────────────────────────────────────────────────────────────────

export function makeVoiceoverRenderActivity(cfg: WorkerConfig) {
  return async function voiceoverRender(activityInput: VoiceoverRenderActivityInput): Promise<VoiceoverRenderActivityResult> {
    const db = getDb(cfg.supabase.url, cfg.supabase.serviceRoleKey);
    const runId = activityInput.primitive_run_id;

    const parsed = VoiceoverRenderInputSchema.safeParse(activityInput.input);
    if (!parsed.success) throw ApplicationFailure.nonRetryable(`voiceover_render input invalid: ${parsed.error.message}`, 'INVALID_INPUT');
    const input = parsed.data;
    const problems = validateVoiceoverForRender(input);
    if (problems.length) throw ApplicationFailure.nonRetryable(problems.join('; '), 'INVALID_INPUT');
    const tl = input.timeline;
    const out = tl.output;
    const aspects = renderAspects(out);
    const total = timelineDuration(tl);

    const { data: existing, error: existingErr } = await db
      .from('primitive_runs')
      .select('status, primitive_artifacts(id, url, kind, metadata)')
      .eq('id', runId)
      .maybeSingle();
    if (existingErr) throw new Error(`primitive_runs lookup failed: ${existingErr.message}`);
    if (existing?.status === 'succeeded') {
      const arts = (existing.primitive_artifacts as Array<{ id: string; url: string; kind: string; metadata: { aspect?: VoiceoverAspect } }> | null) ?? [];
      const vids = arts.filter((a) => a.kind === 'voiceover_video');
      if (vids.length) {
        return {
          primitive_run_id: runId,
          video_url: vids[0].url,
          videos: vids.map((a) => ({ aspect: a.metadata?.aspect ?? 'source', url: a.url, artifact_id: a.id })),
          manifest_url: arts.find((a) => a.kind === 'provenance_manifest')?.url ?? null,
          artifact_id: vids[0].id,
          duration: total,
        };
      }
    }

    // Storage region + SSRF guard: everything we fetch must be ours.
    const regions = storageRegions(cfg.r2);
    const store = regions[input.storage_region ?? 'default'] ?? regions.default;
    const prefixes = Object.values(regions).map((r) => r.publicUrl.replace(/\/+$/, '') + '/');
    const urls = [
      input.source.url,
      ...tl.blocks.filter((b) => b.audio_url).map((b) => b.audio_url!),
      ...(tl.audio.music ? [tl.audio.music.url] : []),
      ...(tl.branding.logo_url ? [tl.branding.logo_url] : []),
      ...tl.fonts.map((f) => f.url),
    ];
    if (urls.some((u) => !prefixes.some((p) => u.startsWith(p)))) {
      throw ApplicationFailure.nonRetryable('all media must be hosted on our storage', 'REFERENCE_URL_NOT_ALLOWED');
    }

    const progress = async (stage: string, pct: number) => {
      await db.from('primitive_events').insert({ primitive_run_id: runId, level: 'info', code: 'progress', message: { stage, pct: Math.round(pct * 100) / 100 } });
    };

    const { error: upsertErr } = await db.from('primitive_runs').upsert(
      {
        id: runId,
        user_id: activityInput.user_id,
        primitive_id: 'voiceover_render',
        status: 'running',
        input: { ...input, duration: Math.round(total) },
        started_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );
    if (upsertErr) throw new Error(`primitive_runs upsert failed: ${upsertErr.message}`);

    await deductPrimitiveCredits({
      db,
      userId: activityInput.user_id,
      primitiveRunId: runId,
      primitive: 'voiceover_render',
      creditsOverride: quoteVoiceoverRenderCredits(total, { quality: out.quality, formats: aspects.length }),
      description: `Voiceover Studio render (${Math.ceil(total)}s × ${aspects.length} · ${out.quality})`,
    });

    const workDir = await mkdtemp(join(tmpdir(), `vnext-voiceover-${runId}-`));
    try {
      await progress('downloading', 0.02);
      const srcPath = join(workDir, 'source');
      await download(input.source.url, srcPath, MAX_SOURCE_BYTES);

      // Voices: one download per distinct take URL.
      const voiced = tl.blocks.filter((b) => b.audio_url && b.text.trim());
      const byUrl = new Map<string, string>();
      await pool([...new Set(voiced.map((b) => b.audio_url!))], 6, async (u, i) => {
        const raw = join(workDir, `voice-${i}.mp3`);
        await download(u, raw, 50 * 1024 * 1024);
        const p = join(workDir, `voice-${i}.wav`);
        await runFfmpeg(buildAudioNormalizeArgs(raw, p), 0);
        byUrl.set(u, p);
      });
      const voices = voiced.map((b) => ({ path: byUrl.get(b.audio_url!)!, start: b.start, volume: b.volume, audioIn: b.audio_in, audioOut: b.audio_out }));

      let musicPath: string | null = null;
      if (tl.audio.music) {
        const rawMusic = join(workDir, `music${extname(new URL(tl.audio.music.url).pathname) || '.mp3'}`);
        await download(tl.audio.music.url, rawMusic, 100 * 1024 * 1024);
        musicPath = join(workDir, 'music.wav');
        await runFfmpeg(buildAudioNormalizeArgs(rawMusic, musicPath), 0);
      }
      let logoPath: string | null = null;
      if (tl.branding.logo_url) {
        logoPath = join(workDir, `logo${extname(new URL(tl.branding.logo_url).pathname) || '.png'}`);
        await download(tl.branding.logo_url, logoPath, 10 * 1024 * 1024);
      }

      // Custom fonts → fontsdir, family names read from the files themselves.
      let fontsDir: string | undefined;
      const families = new Map<string, string>();
      if (tl.fonts.length) {
        fontsDir = join(workDir, 'fonts');
        await mkdir(fontsDir);
        for (const [i, f] of tl.fonts.entries()) {
          const p = join(fontsDir, `font-${i}${extname(new URL(f.url).pathname) || '.ttf'}`);
          await download(f.url, p, 20 * 1024 * 1024);
          const fam = await execFileP('fc-scan', ['--format', '%{family[0]}', p]).then((r) => r.stdout.trim()).catch(() => '');
          families.set(f.id, fam || f.name);
        }
      }
      const fonts: FontResolver = (ref) => families.get(ref) ?? (ref || 'Liberation Sans');

      const meta = await probe(srcPath);
      const withAudio = meta.hasAudio && out.original_volume > 0;
      const xf = await availableXfades();
      const xfadeName = (kind: string) => {
        const want = XFADE_NAMES[kind] ?? 'fade';
        return xf.has(want) ? want : kind === 'zoom' && xf.has('circleopen') ? 'circleopen' : 'fade';
      };
      Context.current().heartbeat({ stage: 'downloaded' });

      const concurrency = Math.max(1, Math.min(4, Math.floor(cpus().length / 2)));
      const videos: VoiceoverRenderActivityResult['videos'] = [];
      const manifestOutputs: Array<Record<string, unknown>> = [];
      const words = timelineWords(tl).filter((w) => w.start < total);
      const starts = clipStarts(tl);
      const cardRanges: Array<[number, number]> = tl.clips.flatMap((c, i) => (c.kind === 'card' ? [[starts[i], starts[i] + clipOutputDuration(c)] as [number, number]] : []));

      for (const [ai, aspect] of aspects.entries()) {
        const base = ai / aspects.length;
        const span = 1 / aspects.length;
        const report = (stage: string, f: number) => progress(stage, 0.04 + 0.92 * (base + span * f));
        const canvas = computeCanvas(meta, { aspect, fit: out.fit, quality: out.quality });
        const dir = join(workDir, `fmt-${ai}`);
        await mkdir(dir);

        // Stage 1: segments in parallel.
        const segPaths = tl.clips.map((_, i) => join(dir, `seg-${String(i).padStart(4, '0')}.mp4`));
        let done = 0;
        await pool(tl.clips, concurrency, async (raw, i) => {
          if (raw.kind === 'card' && raw.card) {
            const assPath = join(dir, `card-${i}.ass`);
            await writeFile(assPath, buildCardAss(raw.card, canvas.W, canvas.H, fonts(tl.overlays[0]?.font ?? '')));
            await runFfmpeg(buildCardSegmentArgs({ card: raw.card, canvas, quality: out.quality, assPath, fontsDir, logoPath, withAudio, outPath: segPaths[i] }), 0);
          } else {
            const clip = { ...raw, src_out: Math.min(raw.src_out, meta.duration || raw.src_out) };
            await runFfmpeg(buildSegmentArgs({ srcPath, outPath: segPaths[i], clip, canvas, quality: out.quality, withAudio }), 0);
          }
          done += clipOutputDuration(raw);
          Context.current().heartbeat({ stage: 'segments', aspect, i });
          if (i % 3 === 2) await report('cutting', 0.5 * (done / Math.max(1, total)));
        });

        // Stage 2: join.
        let video: { kind: 'file' | 'concat'; path: string };
        if (hasTransitions(tl.clips)) {
          await report('transitions', 0.52);
          const joined = join(dir, 'joined.mp4');
          await runFfmpeg(buildJoinArgs({ segmentPaths: segPaths, clips: tl.clips, withAudio, quality: out.quality, outPath: joined, xfadeName }), total);
          video = { kind: 'file', path: joined };
        } else {
          const listPath = join(dir, 'segments.txt');
          await writeFile(listPath, concatListFile(segPaths));
          video = { kind: 'concat', path: listPath };
        }

        // Stage 3: text, effects, captions, logo, audio.
        const drawn = tl.effects.filter((e) => e.kind !== 'blur');
        let overlayAssPath: string | undefined;
        if (tl.overlays.length || drawn.length || tl.branding.disclosure_badge) {
          overlayAssPath = join(dir, 'overlays.ass');
          const badgePos = tl.branding.logo_position === 'tr' ? 'tl' : 'tr';
          await writeFile(overlayAssPath, buildOverlayAss(tl.overlays, canvas.W, canvas.H, {
            // Cover crops follow the camera: effects track the picture through the moving
            // window; text stays where it was placed on screen, sized for the canvas.
            ...(canvas.cover
              ? { content: { x: 0, y: 0, w: canvas.W, h: canvas.H }, contentAt: coverContentAt(tl, canvas), textScale: Math.min(canvas.W, canvas.H) / 1080 }
              : { content: canvas.content }),
            effects: drawn,
            fonts,
            disclosure: tl.branding.disclosure_badge ? { position: badgePos, total } : null,
          }));
        }
        let captionsAssPath: string | undefined;
        if (out.captions.enabled && words.length) {
          captionsAssPath = join(dir, 'captions.ass');
          await writeFile(captionsAssPath, buildCaptionsAss(words, out.captions, canvas.W, canvas.H, fonts));
        }

        const outPath = join(dir, `voiceover-${aspect.replace(':', 'x')}.mp4`);
        let last = 0.55;
        await runFfmpeg(
          buildFinalArgs({
            video,
            voices,
            canvas,
            quality: out.quality,
            redactions: tl.effects.filter((e) => e.kind === 'blur'),
            overlayAssPath,
            captionsAssPath,
            fontsDir,
            logo: logoPath ? { path: logoPath, branding: tl.branding, hide: cardRanges } : null,
            music: musicPath && tl.audio.music ? { path: musicPath, settings: tl.audio.music } : null,
            audio: tl.audio,
            originalVolume: withAudio ? out.original_volume : 0,
            metadata: {
              title: input.provenance.title || 'Voiceover Studio export',
              comment: `Narration is AI-generated (ElevenLabs text-to-speech). Made with Vantly Voiceover Studio. Render ${runId}.`,
              encoded_by: 'Vantly Voiceover Studio',
            },
            total,
            outPath,
          }),
          total,
          (pct) => {
            const f = 0.55 + 0.4 * pct;
            if (f - last >= 0.05) { last = f; void report('rendering', f); }
          },
        );

        await report('uploading', 0.97);
        const sha = await sha256File(outPath);
        const size = (await stat(outPath)).size;
        const fileName = `voiceover-${aspect.replace(':', 'x')}.mp4`;
        const { publicUrl } = await r2UploadVnext(store, runId, fileName, await readFile(outPath), 'video/mp4');
        const { data: artifact, error: artErr } = await db
          .from('primitive_artifacts')
          .insert({
            primitive_run_id: runId,
            kind: 'voiceover_video',
            url: publicUrl,
            bytes: size,
            mime: 'video/mp4',
            metadata: { project_id: input.project_id, aspect, width: canvas.W, height: canvas.H, duration: total, quality: out.quality, sha256: sha, storage_region: input.storage_region ?? 'default' },
          })
          .select('id')
          .single();
        if (artErr || !artifact) throw new Error(`primitive_artifacts insert failed: ${artErr?.message ?? 'no row'}`);
        videos.push({ aspect, url: publicUrl, artifact_id: artifact.id as string });
        manifestOutputs.push({ aspect, url: publicUrl, sha256: sha, bytes: size, width: canvas.W, height: canvas.H, local: outPath });
      }

      // Provenance manifest (+ optional C2PA signature on the primary output).
      const manifest = {
        spec: 'vantly.voiceover.provenance/1',
        render_id: runId,
        project_id: input.project_id,
        workspace_id: input.provenance.workspace_id,
        title: input.provenance.title,
        created_at: new Date().toISOString(),
        ai_disclosure: {
          synthetic_audio: voiced.length > 0,
          tts_provider: 'ElevenLabs',
          voices: input.provenance.voices,
        },
        approved_by: input.provenance.approved_by,
        outputs: manifestOutputs.map(({ local: _l, ...rest }) => rest),
      };
      const manifestPath = join(workDir, 'provenance.json');
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
      const { publicUrl: manifestUrl } = await r2UploadVnext(store, runId, 'provenance.json', await readFile(manifestPath), 'application/json');
      await db.from('primitive_artifacts').insert({ primitive_run_id: runId, kind: 'provenance_manifest', url: manifestUrl, mime: 'application/json', metadata: { project_id: input.project_id } });
      const signed = await maybeC2paSign(String(manifestOutputs[0].local), manifestPath);
      if (signed) {
        const { publicUrl } = await r2UploadVnext(store, runId, 'voiceover-c2pa.mp4', await readFile(signed), 'video/mp4');
        await db.from('primitive_artifacts').insert({ primitive_run_id: runId, kind: 'voiceover_video_c2pa', url: publicUrl, mime: 'video/mp4', metadata: { aspect: aspects[0] } });
      }

      const { error: finErr } = await db.from('primitive_runs').update({ status: 'succeeded', finished_at: new Date().toISOString() }).eq('id', runId);
      if (finErr) throw new Error(`primitive_runs finalize failed: ${finErr.message}`);
      await progress('done', 1);
      await notify(input, { event: 'voiceover.render.finished', status: 'succeeded', run_id: runId, project_id: input.project_id, title: input.provenance.title, videos: videos.map(({ aspect, url }) => ({ aspect, url })), manifest_url: manifestUrl });

      return { primitive_run_id: runId, video_url: videos[0].url, videos, manifest_url: manifestUrl, artifact_id: videos[0].artifact_id, duration: total };
    } catch (err) {
      if (err instanceof ApplicationFailure && err.nonRetryable) {
        await refundPrimitiveCredits(db, runId);
        await notify(input, { event: 'voiceover.render.finished', status: 'failed', run_id: runId, project_id: input.project_id, title: input.provenance.title, error: (err as Error).message });
      }
      throw err;
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  };
}
