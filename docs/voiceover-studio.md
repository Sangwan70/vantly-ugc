# Voiceover Studio

Edit a silent screen recording (Wondershare Filmora, OBS, any capture) and
narrate it with ElevenLabs text-to-speech — the platform's voices or the
user's own cloned voice via their own API key. Lives at `/dashboard/studio`.

## What the user can do (v1)

| Area | Features |
|---|---|
| Upload | MP4/MOV/WebM up to 100 MB → re-hosted to R2 |
| Edit | split at playhead (S), delete with ripple, trim by dragging clip edges, reorder, speed 0.5–4× |
| Animation | per-clip zoom: Focus (ease in → hold → ease out at a picked point), Push in, Pull out; dip fades; animated text (fade / slide up / pop) with presets, drag to position |
| Voice | ElevenLabs-Studio-style script panel: one block per paragraph, per-block voice/model/speed/stability/similarity/style/volume, generate / regenerate, stale-text detection, "fits before next block" check, Generate all (continuity via previous/next text), import plain script / **ElevenLabs cue sheet** / SRT, auto-space |
| Captions | timed from ElevenLabs character alignment (no Whisper pass) — minimal / boxed / bold karaoke |
| Output | original shape, 16:9, 9:16, 1:1 with blurred fill, black bars or crop; original audio volume |
| Export | Temporal render with live progress → MP4 in Gallery, download, publish via Vantly |

Undo/redo, autosave, keyboard shortcuts (Space, S, T, V, Del, ←/→, ⌘Z).

## How it fits together

- **Schema** — `packages/schema/src/voiceover.ts`: timeline contract, timeline
  math (`locateOutputTime`, `zoomAt`, `timelineWords`) and pricing. The editor
  preview, api-v2 and the worker all use it, so preview ≈ quote ≈ render.
- **api-v2** — `routes/v1/studio.ts` (+ `lib/elevenlabs.ts`, `lib/provider-keys.ts`).
  TTS is synchronous (`/with-timestamps`), audio stored in R2.
- **Worker** — `primitive-worker-vnext`: `voiceoverRenderWorkflow` →
  `activities/voiceover-render.ts` → `lib/voiceover-ffmpeg.ts`. Two-stage
  render: one normalised segment per clip (seek, speed, zoompan, fades), then a
  single pass for canvas, ASS text animations, captions and the voice mix.
  Results are `primitive_runs` (`voiceover_render`) so they appear in Gallery.
- **Web** — `apps/web/app/(app-dark)/dashboard/studio/*`, proxied through
  `app/api/v1/studio/[...path]`.
- **DB** — `supabase/migrations/20261123120000_voiceover_studio.sql`.

## Billing

- TTS on the platform key: `ceil(chars/1000 × 20)` credits, min 1, debited per
  generation against `voiceover_tts_takes.id`, refunded if ElevenLabs fails.
- TTS on the user's own key: free (their ElevenLabs quota).
- Render: 6 credits per started output minute (min 6), refunded on failure.
- Constants: `VOICEOVER_*_CREDITS*` in the schema.

## Deploy checklist

1. Apply the migration.
2. api-v2 env: `ELEVENLABS_API_KEY` (platform voices) and `PROVIDER_KEYS_SECRET`
   (≥32 chars; enables bring-your-own-key).
3. Rebuild `@vantly-ugc/schema`, deploy api-v2, primitive-worker-vnext (new
   workflow + activity) and web (`pnpm install` picks up the new
   `@vantly-ugc/schema` dependency of `apps/web`).
4. Worker tmp disk: a render holds the source + segments + output (≈3× source).

Smoke test the renderer without Temporal/R2:
`npx tsx services/primitive-worker-vnext/scripts/voiceover-render-smoke.ts <recording.mp4> <workdir> 16:9`

## Later (not in v1)

Crossfades between clips, background music + ducking, cursor highlight /
click effects, auto-zoom from cursor motion, timeline thumbnails, MCP/CLI
surface (`make_voiceover`), recordings over 100 MB (direct-to-R2 multipart).
