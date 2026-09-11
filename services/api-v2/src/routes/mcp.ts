// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * POST /mcp — public HTTP MCP server for vantly-ugc.
 *
 * What this is: a Model Context Protocol server exposed over HTTP so
 * clients that can't run local stdio MCP processes (Claude.ai, Cowork,
 * Claude Desktop's web mode, anything else that wants a remote MCP
 * URL) can use vantly-ugc's one generation tool: make_ugc
 * ("Vantly UGC Video") — give a script plus a person/image/
 * character and get back a finished vertical video (captions are
 * opt-in — the agent asks before adding them).
 *
 * Tools exposed:
 *   - make_ugc — "Vantly UGC Video", the single agent-facing
 *     generation tool. One call: script + a person/image/character in,
 *     finished vertical video out (captions opt-in). The agent never
 *     picks a sub-skill; make_ugc resolves identity and routes internally.
 *   - list_characters — read-only; list saved, reusable characters.
 *   - generate_image / generate_video / generate_audio — the loose
 *     surface: a prompt, an optional model id (from list_models, or
 *     "auto"), optional references/frames. ADDITIVE to make_ugc and the
 *     fixed skills above, never a replacement — an agent that wants a
 *     specific model or a raw primitive uses these instead of a recipe.
 *     See @vantly-ugc/schema/v2's generate.ts for the full design.
 *   - quote — price a generate_image/video/audio call before submitting
 *     it (no job, no spend).
 *   - list_models — read-only; the model catalog these three tools and
 *     the fixed skills' worker route from (@vantly-ugc/schema/v2 V2_MODELS).
 * (The legacy create_selfie / create_character / create_subtitle
 *  primitives remain wired for back-compat but are no longer the
 *  user-facing offering.)
 *
 * Auth: standard Bearer ma_xxx in the Authorization header. The
 * existing authMiddleware runs before this route, so `req.userId`
 * is already populated when this handler fires.
 *
 * Statelessness: each request creates a fresh MCP server + transport.
 * No session storage, no in-memory state. This means each tool call
 * is a single round-trip; streaming partial responses (progress
 * events while a job runs) is NOT exposed via this transport — the
 * client polls the returned job_id via GET /v1/videos/<id> instead.
 *
 * Why stateless: simpler ops, no need for a session store, plays well
 * with serverless / multi-instance Railway deployments.
 */

import type { Request, Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
  V2_GENERATORS,
  type V2GeneratorRecord,
  GenerateImageSchema,
  GenerateVideoSchema,
  GenerateAudioSchema,
} from '@vantly-ugc/schema/v2';
import { SKILLS } from '../skills/registry.js';
import { isPrimitivesRouteEnabled } from './v1/primitives.js';

const PUBLIC_API_BASE =
  process.env.PUBLIC_API_BASE ?? 'https://api.vantly-ugc.com';

/**
 * Build an MCP server scoped to a single user's API key. Tool handlers
 * call back into the same api-v2 REST surface using the user's bearer
 * token, so credit debits + auth + rate-limits all flow through the
 * normal path.
 */
function buildMcpServer(apiKey: string): Server {
  const server = new Server(
    { name: 'vantly-ugc', version: '0.4.0' },
    { capabilities: { tools: {} } },
  );

  // A10: when MAKE_UGC_ENABLED makes make_ugc the one curated agent surface, the
  // only V2 generator that stays on tools/list is create_character (the cheap
  // character path make_ugc + Route 0 depend on). create_selfie folds into
  // make_ugc; create_subtitle is replaced by the agent-facing make_subtitles.
  const makeUgcOn = process.env.MAKE_UGC_ENABLED?.trim() === 'true';

  // Pre-compute the tool list once per server instance.
  const tools = Object.values(V2_GENERATORS)
    .filter((def): def is V2GeneratorRecord => !!def.mcp)
    .filter((def) => !makeUgcOn || def.mcp!.toolName === 'create_character')
    .map((def) => {
      const schema = zodToJsonSchema(def.inputSchema as any, {
        name: `${def.id}_input`,
        $refStrategy: 'none',
      });
      return {
        def,
        listEntry: {
          name: def.mcp!.toolName,
          description:
            (def.status === 'beta' ? '[beta] ' : '') +
            def.summary +
            '\n\n' +
            def.description,
          inputSchema:
            (schema as any).definitions?.[`${def.id}_input`] ?? schema,
        },
      };
    });

  // vNext skill tools — registered only when the feature flag is on so
  // we don't advertise tools whose REST surface returns 404.
  interface VnextSkillTool {
    listEntry: {
      name: string;
      description: string;
      inputSchema: unknown;
    };
    slug: string;
  }
  // When MAKE_UGC_ENABLED is on, make_ugc is THE one curated agent surface
  // (agentFacing) and the other skills drop off tools/list; until then keep the
  // existing skills and hide the unfinished make_ugc so the surface is unchanged.
  const vnextSkillTools: VnextSkillTool[] = isPrimitivesRouteEnabled()
    ? Object.values(SKILLS)
        .filter((s) => (makeUgcOn ? s.agentFacing === true : s.slug !== 'make_ugc'))
        .map((s) => {
        const schema = zodToJsonSchema(s.inputSchema as any, {
          name: `${s.slug}_input`,
          $refStrategy: 'none',
        });
        return {
          slug: s.slug,
          listEntry: {
            name: s.slug,
            description: `${s.name} (v${s.version}) — ${s.description}`,
            inputSchema:
              (schema as any).definitions?.[`${s.slug}_input`] ?? schema,
          },
        };
      })
    : [];
  const skillBySlug = new Map(vnextSkillTools.map((t) => [t.slug, t]));

  const byName = new Map(tools.map((t) => [t.listEntry.name, t.def]));

  /**
   * Read-only status tool (ported from upstream gitroomhq/agent-media-app,
   * commits 5b7add1 + 2319acf + 55be2fa). Its absence was a real, live hole
   * in this connector: EVERY generation tool below tells the agent to "poll
   * GET /v1/... for status" (see the vNext skill branch and the v2-generator
   * branch further down) but until now no tool existed that could actually
   * make that call — so an MCP agent (Claude Desktop, Cursor, Claude.ai...)
   * submitted a job and then had no way to find out whether it succeeded or
   * hand the user a link. The v2-generator branch's message even pointed at
   * a tool named `get_video_status`, which was never registered on THIS
   * server (it only exists in the separate packages/mcp-server npm client) —
   * so an agent following that instruction got "Unknown tool" back.
   *
   * One tool covers all three id shapes (composed skill run, standalone
   * primitive run, legacy job) because an agent cannot be expected to know
   * which pipeline its skill used.
   */
  const getRunStatusTool = {
    name: 'get_run_status',
    description:
      'Check a generation you already submitted, and get its output URL (video or image) when it is done. Pass the id ANY vantly-ugc tool returned (run id, skill run id, or job id) — this resolves all of them. Set wait:true to block until the job reaches a terminal state (up to ~45 seconds per call; if it is still running, just call again). ALWAYS call this after submitting: without it you cannot tell whether the render succeeded, and cannot give the user a link.',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string', description: 'The run_id / skill_run_id / job_id returned when you submitted.' },
        wait: { type: 'boolean', description: 'Block until the run finishes or ~45 seconds elapse (default false). A video needs several such calls; just call again.' },
      },
      required: ['run_id'],
      additionalProperties: false,
    },
  };

  // Read-only tool (no generation, no credits): list the user's saved
  // characters with their reuse URLs. Forwards to GET /v1/characters.
  const listCharactersTool = {
    name: 'list_characters',
    description:
      "List the authenticated user's saved, reusable characters. Each has a character_id (char_…) and a character_sheet_url — pass EITHER back to make_ugc's `character` prop to reuse that exact identity (skips re-generating the face). Plus a portrait/thumbnail URL for display.",
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Max characters to return (default 50).' },
      },
      additionalProperties: false,
    },
  };

  // ── Loose generate surface (generate_image/video/audio/quote/list_models) ──
  // ADDITIVE to the fixed tools above — see the file-header doc comment. Always
  // registered (the underlying REST routes carry no feature flag), same as
  // list_characters/get_run_status.
  const generateImageSchema = zodToJsonSchema(GenerateImageSchema as any, {
    name: 'generate_image_input',
    $refStrategy: 'none',
  });
  const generateVideoSchema = zodToJsonSchema(GenerateVideoSchema as any, {
    name: 'generate_video_input',
    $refStrategy: 'none',
  });
  const generateAudioSchema = zodToJsonSchema(GenerateAudioSchema as any, {
    name: 'generate_audio_input',
    $refStrategy: 'none',
  });

  const generateImageTool = {
    name: 'generate_image',
    description:
      'Generate one image from a prompt, optionally editing/composing from up to 4 reference images. Pick a model from list_models (or omit for the default, or pass "auto"). Costs credits — call `quote` first if you want the price before spending. Returns a job_id; poll it with get_run_status.',
    inputSchema: (generateImageSchema as any).definitions?.generate_image_input ?? generateImageSchema,
  };
  const generateVideoTool = {
    name: 'generate_video',
    description:
      'Generate one video clip from a prompt. The mode is derived from what you pass: first_frame (+ optional last_frame) animates a still (image-to-video); refs/video_refs/audio_refs keeps an identity, motion or voice (reference-to-video); neither is a pure text-to-video prompt. Pick a model from list_models (or omit for the default, or pass "auto"). Costs credits — call `quote` first if you want the price before spending. Returns a job_id; poll it with get_run_status.',
    inputSchema: (generateVideoSchema as any).definitions?.generate_video_input ?? generateVideoSchema,
  };
  const generateAudioTool = {
    name: 'generate_audio',
    description:
      'Generate spoken audio (text-to-speech) from text, with a named voice and optional tone. Pick a model from list_models (or omit for the default, or pass "auto"). Costs credits — call `quote` first if you want the price before spending. Returns a job_id; poll it with get_run_status.',
    inputSchema: (generateAudioSchema as any).definitions?.generate_audio_input ?? generateAudioSchema,
  };
  const quoteTool = {
    name: 'quote',
    description:
      'Get the exact credit price for a generate_image / generate_video / generate_audio call WITHOUT submitting it or spending credits. Pass `kind` ("image" | "video" | "audio") plus the same fields you would pass to that generate tool (prompt/text, model, refs, etc — see generate_image/generate_video/generate_audio for the field list).',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['image', 'video', 'audio'],
          description: 'Which generator to price: image, video, or audio.',
        },
      },
      required: ['kind'],
      additionalProperties: true,
    },
  };
  const listModelsTool = {
    name: 'list_models',
    description:
      'List the model catalog that generate_image/generate_video/generate_audio route to: each model\'s id, provider, modes, limits, price in credits, quality/speed, what it is good and bad for, and (for video) its per-mode limits and per-quality price. Read-only, no credits. By default only status:"live" (selectable) models are returned; pass all:true to also see status:"candidate" (planned, not yet selectable) models.',
    inputSchema: {
      type: 'object',
      properties: {
        all: { type: 'boolean', description: 'Include candidate (not-yet-selectable) models too. Default false.' },
      },
      additionalProperties: false,
    },
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...tools.map((t) => t.listEntry),
      ...vnextSkillTools.map((t) => t.listEntry),
      listCharactersTool,
      getRunStatusTool,
      generateImageTool,
      generateVideoTool,
      generateAudioTool,
      quoteTool,
      listModelsTool,
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Read-only: resolve a run/job id across all three pipelines (composed
    // skill run, standalone primitive run, legacy job) — see getRunStatusTool
    // above for why this exists.
    if (name === 'get_run_status') {
      const runId = String((args as { run_id?: string })?.run_id ?? '').trim();
      const wait = (args as { wait?: boolean })?.wait === true;
      if (!runId) {
        return { content: [{ type: 'text', text: 'run_id is required.' }], isError: true };
      }

      // The agent holds one opaque id and cannot know which pipeline its
      // skill ran on, so probe each shape in turn.
      const PATHS = [
        `/v1/skills/runs/${encodeURIComponent(runId)}`,
        `/v1/primitives/runs/${encodeURIComponent(runId)}`,
        `/v1/videos/${encodeURIComponent(runId)}`,
      ];

      async function probe(): Promise<{ found: boolean; body?: any }> {
        for (const path of PATHS) {
          try {
            const r = await fetch(`${PUBLIC_API_BASE}${path}`, {
              headers: { Authorization: `Bearer ${apiKey}` },
              signal: AbortSignal.timeout(20_000),
            });
            if (r.status === 404) continue;
            const t = await r.text();
            let d: any;
            try { d = t ? JSON.parse(t) : null; } catch { d = t; }
            if (r.ok) return { found: true, body: d };
          } catch {
            // try the next shape
          }
        }
        return { found: false };
      }

      const TERMINAL = new Set(['completed', 'succeeded', 'failed', 'canceled', 'cancelled', 'error']);
      // Connector clients cut a tool call off well before 110s (60s is a
      // common ceiling), so the one tool that exists to end the agent's
      // blindness must not itself be the call most likely to hang and fail.
      // Stay comfortably under: the agent just calls again, and it's told to.
      const deadline = Date.now() + (wait ? 45_000 : 0);
      let result = await probe();
      while (
        wait &&
        result.found &&
        !TERMINAL.has(String(result.body?.status ?? '').toLowerCase()) &&
        Date.now() < deadline
      ) {
        await new Promise((r) => setTimeout(r, 8_000));
        result = await probe();
      }

      if (!result.found) {
        return {
          content: [{ type: 'text', text: `No run found for id "${runId}". Check the id you were given at submit time.` }],
          isError: true,
        };
      }

      const b = result.body ?? {};
      const status = String(b.status ?? 'unknown');
      // Every pipeline names its output differently, and a composed skill
      // run (make_ugc_video — the main product surface) nests it one level
      // down: the link is final_output.video_url, and the artifacts hang off
      // steps[].artifacts, not the top level. Reading only scalar fields (as
      // the earlier get_video_status-style tools do) leaves a finished
      // composed run reporting "succeeded" with no link at all — the agent
      // still can't hand the user their video, which is the whole point of
      // this tool. See services/api-v2/src/routes/v1/skills.ts's
      // getSkillRunRoute for the actual response shape.
      const stepArtifacts: Array<{ url?: string; kind?: string; mime?: string }> =
        Array.isArray(b.steps)
          ? b.steps.flatMap((st: { artifacts?: unknown }) =>
              Array.isArray(st?.artifacts) ? st.artifacts : [],
            )
          : [];
      const artifactList: Array<{ url?: string; kind?: string; mime?: string }> =
        Array.isArray(b.artifacts)
          ? b.artifacts
          : Array.isArray(b.final_output?.artifacts)
            ? b.final_output.artifacts
            : stepArtifacts;
      const videoArtifact =
        artifactList.find((a) => typeof a?.mime === 'string' && a.mime.startsWith('video/')) ??
        artifactList.find((a) => typeof a?.url === 'string' && /\.(mp4|mov|webm)(\?|$)/i.test(a.url)) ??
        artifactList[0];
      const url =
        b.video_url ?? b.output_url ?? b.result_url ?? b.output_media_url ??
        b.final_output?.video_url ?? b.final_output?.output_url ??
        videoArtifact?.url ?? null;
      // Surface every other named/artifact output too (portrait, character
      // sheet, wireframe) so "show me the character sheet" costs no extra
      // round trip.
      const namedOutputs = Object.entries(b.final_output ?? {})
        .filter(([k, v]) => typeof v === 'string' && /^https?:\/\//.test(v as string) && v !== url && k !== 'video_url')
        .map(([k, v]) => `  - ${k}: ${v}`);
      const otherArtifacts = [
        ...artifactList
          .filter((a) => a?.url && a.url !== url)
          .map((a) => `  - ${a.kind ?? 'artifact'}: ${a.url}`),
        ...namedOutputs,
      ];
      const done = TERMINAL.has(status.toLowerCase());
      const lines = [
        `Run ${runId} — status: ${status}`,
        url ? `${/\.(png|jpe?g|webp)(\?|$)/i.test(url) ? 'Image' : 'Video'}: ${url}` : null,
        otherArtifacts.length ? `Other artifacts:\n${otherArtifacts.join('\n')}` : null,
        typeof b.credits_deducted === 'number' ? `Credits: ${b.credits_deducted}` : null,
        b.error_message ? `Error: ${b.error_message}` : null,
        b.error_code ? `Error code: ${b.error_code}` : null,
        !done ? 'Still running: call get_run_status again (or with wait:true).' : null,
      ].filter(Boolean);
      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        isError: /failed|error|canceled|cancelled/i.test(status),
      };
    }

    // Read-only: list saved characters (GET /v1/characters).
    if (name === 'list_characters') {
      const limit = Math.min(Math.max(Number((args as { limit?: number })?.limit) || 50, 1), 100);
      const resp = await fetch(`${PUBLIC_API_BASE}/v1/characters?limit=${limit}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const text = await resp.text();
      let data: unknown;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!resp.ok) {
        const msg = (data as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${resp.status}`;
        return { content: [{ type: 'text', text: `Error (${resp.status}): ${msg}` }], isError: true };
      }
      const chars = ((data as { characters?: Array<{ name?: string; character_id?: string | null; character_sheet_url?: string }> } | null)?.characters) ?? [];
      const body = chars.length
        ? chars.map((c) => `- ${c.name} — character_id: ${c.character_id ?? '(none)'}  |  sheet: ${c.character_sheet_url}`).join('\n')
        : 'No saved characters yet.';
      return { content: [{ type: 'text', text: `${chars.length} saved character(s). Reuse one by passing its character_id (or sheet URL) as \`character\` to make_ugc:\n${body}` }] };
    }

    // Read-only: the model catalog (GET /v1/models).
    if (name === 'list_models') {
      const includeAll = (args as { all?: boolean } | undefined)?.all === true;
      const resp = await fetch(`${PUBLIC_API_BASE}/v1/models${includeAll ? '?all=true' : ''}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const text = await resp.text();
      let data: unknown;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!resp.ok) {
        const msg = (data as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${resp.status}`;
        return { content: [{ type: 'text', text: `Error (${resp.status}): ${msg}` }], isError: true };
      }
      const body = (data as {
        models?: Array<{
          id: string; kind: string; provider: string; tier: string; status: string;
          quality: string; speed: string; bestFor?: string[]; avoidFor?: string[];
          credits?: { unit: string; perUnit: number; base?: number };
          video?: { creditsPerSecond?: Record<string, number> };
          usage?: { pickWhen?: string; latency?: string };
        }>;
        defaults?: Record<string, string>;
        auto_policy?: string;
      } | null) ?? {};
      const models = body.models ?? [];
      const lines = models.map((m) => {
        const price = m.video?.creditsPerSecond
          ? Object.entries(m.video.creditsPerSecond).map(([q, c]) => `${c}cr/s@${q}`).join(', ')
          : m.credits
            ? `${m.credits.perUnit}cr/${m.credits.unit}${m.credits.base ? ` +${m.credits.base} base` : ''}`
            : '(no live price)';
        return [
          `- ${m.id} (${m.kind}, ${m.status}, ${m.tier}) — ${price}`,
          m.usage?.pickWhen ? `    pick when: ${m.usage.pickWhen}` : null,
          m.bestFor?.length ? `    best for: ${m.bestFor.join(', ')}` : null,
          m.avoidFor?.length ? `    avoid for: ${m.avoidFor.join(', ')}` : null,
          m.usage?.latency ? `    latency: ${m.usage.latency}` : null,
        ].filter(Boolean).join('\n');
      });
      const defaultsLine = body.defaults
        ? `Defaults — image: ${body.defaults.image}, video: ${body.defaults.video}, audio: ${body.defaults.audio}`
        : null;
      return {
        content: [{
          type: 'text',
          text: [
            `${models.length} model(s)${includeAll ? ' (including candidates)' : ' (live, selectable)'}:`,
            ...lines,
            defaultsLine,
            body.auto_policy ? `"auto" policy: ${body.auto_policy}` : null,
          ].filter(Boolean).join('\n'),
        }],
      };
    }

    // Read-only: price a generate_image/video/audio call (POST /v2/quote/:kind).
    if (name === 'quote') {
      const { kind, ...rest } = (args as { kind?: string } & Record<string, unknown>) ?? {};
      if (kind !== 'image' && kind !== 'video' && kind !== 'audio') {
        return { content: [{ type: 'text', text: 'kind must be "image", "video", or "audio".' }], isError: true };
      }
      const resp = await fetch(`${PUBLIC_API_BASE}/v2/quote/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(rest),
        signal: AbortSignal.timeout(20_000),
      });
      const text = await resp.text();
      let data: unknown;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!resp.ok) {
        const d = data as { error?: { message?: string; issues?: unknown } } | null;
        const msg = d?.error?.message ?? `HTTP ${resp.status}`;
        const issues = d?.error?.issues ? `\n${JSON.stringify(d.error.issues)}` : '';
        return { content: [{ type: 'text', text: `Error (${resp.status}): ${msg}${issues}` }], isError: true };
      }
      const q = data as { model?: string; credits?: number; breakdown?: string; auto?: { model: string; reason: string } };
      return {
        content: [{
          type: 'text',
          text: [
            `${q.credits} credits — ${q.breakdown}`,
            q.auto ? `"auto" resolved to ${q.auto.model}: ${q.auto.reason}` : null,
          ].filter(Boolean).join('\n'),
        }],
      };
    }

    // The loose surface: generate_image / generate_video / generate_audio
    // (POST /v2/generate/:kind). Submits a real job and spends credits.
    if (name === 'generate_image' || name === 'generate_video' || name === 'generate_audio') {
      const kind = name.slice('generate_'.length);
      let resp: Awaited<ReturnType<typeof fetch>>;
      try {
        resp = await fetch(`${PUBLIC_API_BASE}/v2/generate/${kind}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify(args ?? {}),
          // Not retried: /v2/generate/:kind is not idempotent without an
          // Idempotency-Key, so a retry on timeout could double-submit.
          signal: AbortSignal.timeout(30_000),
        });
      } catch (err) {
        return {
          content: [{ type: 'text', text: `vantly-ugc API did not respond in time (${(err as Error).message}). The job may or may not have started — use get_run_status to check once you have a job_id, or try again.` }],
          isError: true,
        };
      }
      const text = await resp.text();
      let data: unknown;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!resp.ok) {
        const d = data as { error?: { message?: string; issues?: unknown } } | null;
        const msg = d?.error?.message ?? `HTTP ${resp.status}`;
        const issues = d?.error?.issues ? `\n${JSON.stringify(d.error.issues)}` : '';
        return { content: [{ type: 'text', text: `Error (${resp.status}): ${msg}${issues}` }], isError: true };
      }
      const sub = data as { job_id?: string; credits_deducted?: number; model?: string; breakdown?: string } | null;
      return {
        content: [{
          type: 'text',
          text: [
            `Job submitted: ${sub?.job_id ?? '(no job id)'}`,
            sub?.model ? `Model: ${sub.model}` : null,
            sub?.credits_deducted != null ? `Credits: ${sub.credits_deducted}` : null,
            sub?.breakdown ? `Breakdown: ${sub.breakdown}` : null,
            sub?.job_id ? `NEXT STEP: call get_run_status with run_id "${sub.job_id}" (add wait:true to wait ~45s per call; repeat until it is done) to get the output URL. Do not stop here: the user needs the link.` : 'Poll with the get_run_status tool.',
          ].filter(Boolean).join('\n'),
        }],
      };
    }

    // vNext skill route — forwards to /v1/skills/:slug/run.
    const skillTool = skillBySlug.get(name);
    if (skillTool) {
      let resp: Awaited<ReturnType<typeof fetch>>;
      try {
        resp = await fetch(
          `${PUBLIC_API_BASE}/v1/skills/${skillTool.slug}/run`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(args ?? {}),
            // Bound the wait so a slow/cold upstream surfaces as a clean tool
            // error instead of a bare hanging connection. No retry: /run is not
            // idempotent without an Idempotency-Key, so a retry could double-submit.
            signal: AbortSignal.timeout(30_000),
          },
        );
      } catch (err) {
        return {
          content: [{ type: 'text', text: `vantly-ugc API did not respond in time (${(err as Error).message}). The run may or may not have started — use the list/status tools to check.` }],
          isError: true,
        };
      }
      const text = await resp.text();
      let data: unknown;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = text;
      }
      if (!resp.ok) {
        const msg =
          (data as { error?: string; detail?: unknown } | null)?.error ??
          `HTTP ${resp.status}`;
        return {
          content: [{ type: 'text', text: `Error (${resp.status}): ${msg}` }],
          isError: true,
        };
      }
      const sub = data as {
        run_id?: string;
        skill_run_id?: string;
        workflow_id?: string;
        skill?: string;
        status?: string;
      } | null;
      // Composed skills (make_ugc_video / make_broll_talking_head) return a
      // skill_run_id, primitives return a run_id. Previously this told the
      // agent to poll a raw REST URL directly — but nothing on THIS MCP
      // server could make that call, so the agent had a run id and nowhere
      // to check it. get_run_status (above) now resolves either id shape.
      const jobId = sub?.skill_run_id ?? sub?.run_id ?? null;
      return {
        content: [
          {
            type: 'text',
            text: [
              `Skill submitted: ${sub?.skill ?? skillTool.slug}`,
              jobId ? `Run id: ${jobId}` : null,
              sub?.workflow_id ? `Workflow id: ${sub.workflow_id}` : null,
              jobId ? `NEXT STEP: call get_run_status with run_id "${jobId}" (add wait:true to wait ~45s per call; repeat until it is done) to get the video URL. Do not stop here: the user needs the link.` : null,
            ]
              .filter(Boolean)
              .join('\n'),
          },
        ],
      };
    }

    const def = byName.get(name);
    if (!def || !def.rest) {
      return {
        content: [{ type: 'text', text: `Unknown tool: ${name}` }],
        isError: true,
      };
    }

    // Forward to the v2 REST endpoint using the caller's API key.
    const resp = await fetch(`${PUBLIC_API_BASE}${def.rest.path}`, {
      method: def.rest.method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(args ?? {}),
    });
    const text = await resp.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }

    if (!resp.ok) {
      const errMessage =
        (data as { error?: { message?: string } } | null)?.error?.message ??
        `HTTP ${resp.status}`;
      return {
        content: [
          { type: 'text', text: `Error (${resp.status}): ${errMessage}` },
        ],
        isError: true,
      };
    }

    const sub = data as {
      job_id?: string;
      credits_deducted?: number;
      status?: string;
    } | null;
    return {
      content: [
        {
          type: 'text',
          text: [
            `Job submitted: ${sub?.job_id ?? '(no job id)'}`,
            sub?.credits_deducted != null ? `Credits: ${sub.credits_deducted}` : null,
            sub?.job_id ? `NEXT STEP: call get_run_status with run_id "${sub.job_id}" (add wait:true to wait ~45s per call; repeat until it is done) to get the video URL. Do not stop here: the user needs the link.` : 'Poll with the get_run_status tool.',
          ]
            .filter(Boolean)
            .join('\n'),
        },
      ],
    };
  });

  return server;
}

/**
 * Express handler for POST /mcp + GET /mcp (SSE upgrade).
 *
 * Each request gets a fresh, stateless MCP server. No session cookies,
 * no in-memory state across requests.
 */
export async function mcpRoute(req: Request, res: Response): Promise<void> {
  const userId = (req as any).userId as string | undefined;
  const authToken = (req as any).authToken as string | undefined;
  if (!userId || !authToken) {
    res
      .status(401)
      .json({
        error: { code: 'UNAUTHORIZED', message: 'Bearer API key required' },
      });
    return;
  }

  const server = buildMcpServer(authToken);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless
  });

  // Clean up on response close.
  res.on('close', () => {
    transport.close().catch(() => {});
    server.close().catch(() => {});
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, (req as any).body);
  } catch (err) {
    console.error('[mcp] handler error:', err);
    if (!res.headersSent) {
      res
        .status(500)
        .json({
          error: { code: 'MCP_INTERNAL', message: 'MCP handler failed' },
        });
    }
  }
}
