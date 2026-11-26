# Voiceover Studio

Edit a silent screen recording (Wondershare Filmora, OBS, any capture) and
narrate it with ElevenLabs text-to-speech: platform voices, the user's own
key (their cloned voice), or a workspace's shared account. Lives at
`/dashboard/studio`.

## Features

| # | Area | What ships |
|---|---|---|
| 1 | **Camera** | Simple zoom (focus / push / pull) or **keyframes** (zoom + focus point + easing per segment), picked on the preview; 2× supersampled zoompan so slow pans are smooth; keyframes survive splits |
| 2 | **Screen-recording effects** | Click ripple, spotlight, highlight box, arrow, **redaction (pixelate)**. **Smart edit** analyses every upload (frame differencing with animated-region masking): dead air → cut / 2×, focused activity → auto-zoom keyframes + click ripple, page changes → split points. Apply one, a kind, or all |
| 3 | **Transitions & audio** | Crossfade, dip to black, slide, slide up, zoom, wipe (xfade); music with **sidechain ducking**, fades, loop — upload your own or pick from the **free music library** (public-domain / CC0 classical recordings from Wikimedia Commons, ad-safe, no attribution; `packages/schema/src/voiceover-music.ts`); **loudness normalisation** (−14 / −16 / −23 LUFS); click-free voice fades |
| 4 | **Voice** | ElevenLabs-Studio-style blocks; **takes** with A/B swap; **split at cursor** (keeps audio via take trims); **regenerate a selection**; pause tags; **pronunciation dictionary** (alias or IPA → cached ElevenLabs dictionary); **fit-to-slot** (speak faster / AI shorten / slow the video); continuity via neighbour text |
| 5 | **Brand & text** | Logo (or import from Brand Kit), palette, **intro/outro title cards**, custom **font upload**, **caption style engine** (presets or custom font/size/colours/position/box/karaoke/pop), lower thirds, callouts with arrows, typewriter / slide / pop animations, AI-voice badge |
| 6 | **Teams** | Workspaces with owner / admin / editor / reviewer / viewer roles, invites, a **shared ElevenLabs key**, timestamped **review comments**, **submit → approve / request changes**, approval-gated final renders, **audit log** |
| 7 | **Scale** | **Direct-to-bucket multipart upload** up to 5 GB (SigV4 presigned parts, parallel + retried), 720p **proxy** + **filmstrip** for instant scrubbing, **draft / 1080p / 4K** render tiers, parallel segment rendering, **batch export** (several shapes in one job), webhook + email on completion |
| 8 | **Localization** | One click: translated copy of the project (narration, text, cards; glossary + pronunciations kept), opened with voices auto-generating in the same cloned voice |
| 9 | **Templates & automation** | Save/apply templates (look, captions, music, branding, fonts, pronunciations, intro/outro, voice); **series** grouping; `POST /v1/studio/automate` = recording + script (plain / cue sheet / SRT) → smart edits → voices → render, with webhook; scheduled publishing via Vantly |
| 11 | **Presenter** | **You on camera, lip-synced to your own voice** in a ringed corner circle (larger over title cards): upload a photo (+ optional talking frame), confirm consent, switch Presenter on per line. Each take is Seedance 2.0 reference-to-video via EvoLink (real-person filter relaxed for the consented likeness), exactly as long as the line (4–15 s), generated once per voice take and cached on the block (`presenterTakeKey`), so re-renders and extra shapes cost nothing. Free photo preview in the editor; series templates carry the look, never the consent |
| 10 | **Governance** | Monthly **workspace budget** + per-member cap, **usage report** (JSON / CSV), **SSO** (SAML via Supabase; enforce per workspace), **voice-clone consent** records (speaker, statement, evidence) gating cloned voices, **retention** sweep for source recordings, **provenance manifest** (+ optional C2PA signing), MP4 AI-disclosure metadata, **data regions** |

## Architecture

- **Schema** (`packages/schema/src/voiceover.ts`): the timeline contract and all
  shared math — camera/keyframes, transition overlap, caption style + line
  breaking, script parsing, suggestion application, pricing. The browser
  preview, api-v2 and the worker all use it, so preview ≈ quote ≈ render.
- **api-v2**: `routes/v1/studio.ts` (projects, uploads, assets, voices, TTS,
  render), `studio-pro.ts` (templates, localize, assist, automate, review,
  comments, consent), `studio-workspaces.ts` (teams, policies, usage, audit,
  retention), `studio-presenter.ts` (presenter takes); `lib/studio-access.ts` (roles, SSO, budgets, audit),
  `lib/studio-tts.ts` (key choice, consent, dictionaries, billing),
  `lib/studio-storage.ts` (regions, multipart, SigV4).
- **Worker** (`primitive-worker-vnext`): `voiceoverRenderWorkflow`
  (segments → join → final pass, per shape), `voiceoverPrepareWorkflow`
  (proxy, filmstrip, analysis), `voiceoverAutomateWorkflow` (prepare →
  api-v2 builds the timeline and voices → render), `voiceoverPresenterWorkflow`
  (one presenter take; refunded on failure). Pure render plan in
  `lib/voiceover-ffmpeg.ts`.
- **Web**: `apps/web/app/(app-dark)/dashboard/studio/**`, proxied through
  `app/api/v1/studio/[...path]`; SSO button on `/login`.
- **DB**: `supabase/migrations/20261123120000_voiceover_studio.sql`,
  `20261124120000_voiceover_studio_enterprise.sql`.

## Billing

- TTS on the platform key: `ceil(chars/1000 × 20)` credits (min 1), refunded if
  ElevenLabs or storage fails. Own key / workspace key: free.
- Render: 6 credits per started output minute (min 6) × quality (draft 0.5,
  1080p 1, high 2) × number of shapes; refunded on failure.
- Presenter take: 31 credits per second of the line (rounded up, 4–15 s;
  EvoLink ≈ $0.22/s at 720p with the real-person filter relaxed), charged once
  per voice take and refunded on failure. Counts with renders in workspace budgets.
- Workspace budgets and member caps are checked before every TTS / render / presenter take.

## Deploy checklist

1. Apply both migrations.
2. api-v2: `ELEVENLABS_API_KEY`, `PROVIDER_KEYS_SECRET` (≥32 chars),
   `INTERNAL_API_SECRET` (already used by the worker), optional
   `STUDIO_STORAGE_REGIONS`.
3. Worker: optional `STUDIO_STORAGE_REGIONS`, `STUDIO_WEBHOOK_SECRET`,
   `RESEND_API_KEY` + `STUDIO_NOTIFY_FROM`, `C2PA_SIGNER_MANIFEST`. The worker
   image needs ffmpeg ≥ 5 for the `zoomin` transition (it falls back to
   `circleopen` otherwise) and `fontconfig` (`fc-scan`) for custom fonts.
4. Storage CORS on every bucket: allow `PUT` from the dashboard origin and
   expose the `ETag` header.
5. Cron (daily): `POST /internal/studio/retention-sweep` with
   `x-internal-secret`.
6. SSO: add each customer's SAML IdP with `supabase sso add` (Supabase Auth
   Pro), then set the domain + "Enforce SSO" in the workspace's Policies.
7. `pnpm install`, rebuild `@vantly-ugc/schema`, deploy api-v2, the worker and web.

Smoke tests without Temporal/R2:

```
npx tsx services/primitive-worker-vnext/scripts/voiceover-render-smoke.ts <recording.mp4> <workdir> 16:9 [logo.png]
npx tsx services/primitive-worker-vnext/scripts/voiceover-analyze-smoke.ts <recording.mp4> <width> <height> <duration>
```

## Not yet

MCP tool (`make_voiceover`) on the hosted connector — automation is REST +
webhook today; true word-level audio editing inside a take (we split/trim at
word boundaries instead); cursor-path smoothing from recorder metadata;
per-region storage for the legacy Gallery helpers (Studio paths are
region-aware).
