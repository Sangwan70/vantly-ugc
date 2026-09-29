// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

import { Context } from '@temporalio/activity';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WorkerConfig } from '../config.js';
import { r2UploadVnext } from '../client/r2.js';

const execFileP = promisify(execFile);

async function fetchToBuffer(url: string, label: string): Promise<Buffer> {
  const resp = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
  if (!resp.ok) throw new Error(`${label} download ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

/**
 * Grab the LAST frame of a video (any https URL, already fetched into
 * `videoBytes`) as JPEG bytes -- the actual ffmpeg work behind
 * extractLastFrame below, pulled out as its own function so OTHER activities
 * that just need "a still frame from this clip" (make_lip_sync's video_url
 * face source, see lip-sync.ts) can reuse the exact same robust
 * seek-near-EOF + full-decode-fallback logic instead of re-implementing it.
 * Heartbeats via the CALLER's activity context (Context.current()), so it
 * reads correctly no matter which activity invokes it.
 */
export async function extractLastFrameBytes(videoBytes: Buffer, label: string): Promise<Buffer> {
  const workDir = await mkdtemp(join(tmpdir(), `vnext-lastframe-${label}-`));
  try {
    const videoPath = join(workDir, 'clip.mp4');
    const framePath = join(workDir, 'frame.jpg');
    await writeFile(videoPath, videoBytes);
    const runFfmpeg = (args: string[]) => execFileP('ffmpeg', args);
    // Primary: seek ~1s before EOF and overwrite a single frame (fast). `-an`
    // drops the audio stream so a missing/odd audio track can't error the pass.
    try {
      await runFfmpeg(['-y', '-sseof', '-1', '-i', videoPath, '-an', '-update', '1', '-q:v', '2', framePath]);
      await readFile(framePath); // throws if not created → fall through to full decode
    } catch {
      // Fallback: full decode, overwriting one frame per decoded frame — the
      // final write IS the last frame. Robust for any decodable clip.
      try {
        await runFfmpeg(['-y', '-i', videoPath, '-an', '-update', '1', '-q:v', '2', framePath]);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`last-frame extraction failed: ${msg.slice(0, 300)}`);
      }
    }
    try {
      return await readFile(framePath);
    } catch {
      throw new Error('last-frame extraction produced no frame (corrupt / zero-frame clip)');
    }
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface ExtractLastFrameInput {
  /** A talking-head clip already hosted on R2. */
  video_url: string;
  /** R2 namespace for the extracted frame — use the skill_run_id. */
  run_id: string;
  /** Position in the chain, for a stable unique filename. */
  index: number;
}

export interface ExtractLastFrameResult {
  /** Public R2 URL of the extracted final frame (passes the lip_sync/selfie SSRF allowlist). */
  frame_url: string;
}

/**
 * Extract the final frame of a clip and upload it to R2, so the NEXT clip in a
 * chained talking-head sequence can start exactly where this one ended. This is
 * what makes the multi-clip 30s take read as seamless-continuous rather than a
 * jump-cut: the provider re-animates from the previous clip's last frame.
 *
 * Uses `-sseof -0.1` (seek 0.1s before EOF) so we grab the true last frame
 * without a separate ffprobe duration call.
 */
export function makeExtractLastFrameActivity(cfg: WorkerConfig) {
  return async function extractLastFrame(
    input: ExtractLastFrameInput,
  ): Promise<ExtractLastFrameResult> {
    const videoBytes = await fetchToBuffer(input.video_url, 'chain clip');
    Context.current().heartbeat({ stage: 'extracting_last_frame', index: input.index });
    let bytes: Buffer;
    try {
      bytes = await extractLastFrameBytes(videoBytes, input.run_id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`${msg} (video_url: ${input.video_url})`);
    }
    const { publicUrl } = await r2UploadVnext(
      cfg.r2,
      input.run_id,
      `chain-frame-${input.index}.jpg`,
      bytes,
      'image/jpeg',
    );
    return { frame_url: publicUrl };
  };
}
