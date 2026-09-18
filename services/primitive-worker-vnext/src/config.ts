// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Env-driven config for primitive-worker-vnext.
 *
 * Mirrors the pattern in services/api-v2/src/orchestrator/temporal/config.ts
 * so credentials can be reused / lifted later.
 */

export interface TemporalConnConfig {
  address: string;
  namespace: string;
  apiKey?: string;
  tlsEnabled: boolean;
  tlsServerName?: string;
  taskQueue: string;
}

export interface CostCaps {
  /** Max USD per single primitive Activity. */
  primitiveUsd: number;
  /** Max USD per skill run (sum of primitives in the same run). */
  runUsd: number;
  /** Max USD per UTC day, summed across all primitive runs. */
  dayUsd: number;
}

export interface WorkerConfig {
  temporal: TemporalConnConfig;
  anthropic: {
    apiKey: string;
    model: string;
  };
  openai: {
    apiKey: string;
    imageModel: string;
    simulate: boolean;
    /** api-v2 internal base URL the worker proxies gpt-image calls through. */
    imageProxyUrl: string;
    /** Shared secret sent as x-internal-secret to the proxy endpoint. */
    imageProxySecret: string;
  };
  r2: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    publicUrl: string;
  };
  supabase: {
    url: string;
    serviceRoleKey: string;
  };
  caps: CostCaps;
}

function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is required`);
  return v;
}

function optional(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v && v.length > 0 ? v : undefined;
}

function readNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function getConfig(): WorkerConfig {
  const simulate = (process.env.SIMULATE_OPENAI ?? 'false').toLowerCase().trim() === 'true';
  // MODEL_PROVIDER selects which credential/endpoint client/anthropic.ts talks
  // to for every Claude call this worker makes (portrait/sheet/wireframe/
  // simple-selfie/product-in-hands prompt building):
  //   'anthropic' (default): ANTHROPIC_API_KEY, api.anthropic.com directly.
  //   'openrouter': OPENROUTER_API_KEY, routed through OpenRouter's
  //     Anthropic-Messages-compatible endpoint instead. See client/anthropic.ts.
  const modelProvider = (process.env.MODEL_PROVIDER ?? 'anthropic').toLowerCase().trim();
  const anthropicKeyVar = modelProvider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'ANTHROPIC_API_KEY';
  return {
    temporal: {
      address: required('TEMPORAL_ADDRESS'),
      namespace: required('TEMPORAL_NAMESPACE'),
      apiKey: optional('TEMPORAL_API_KEY'),
      tlsEnabled: (process.env.TEMPORAL_TLS ?? 'true').toLowerCase() !== 'false',
      tlsServerName: optional('TEMPORAL_TLS_SERVER_NAME'),
      taskQueue: optional('TEMPORAL_PRIMITIVE_TASK_QUEUE') ?? 'primitive-vnext-v1',
    },
    anthropic: {
      apiKey: simulate ? (optional(anthropicKeyVar) ?? 'simulate') : required(anthropicKeyVar),
      model: optional('ANTHROPIC_PORTRAIT_PROMPT_MODEL') ?? 'claude-haiku-4-5',
    },
    openai: {
      // In simulate mode the key is not required — keep an empty placeholder
      // so type stays string and the activity short-circuits before any call.
      apiKey: simulate ? (optional('OPENAI_API_KEY') ?? 'simulate') : required('OPENAI_API_KEY'),
      // NOTE: this is the LITERAL OpenAI API model string, sent as-is to
      // images.generate/.edit -- NOT the model catalog's friendly id.
      // packages/schema/src/v2/models.ts's 'gpt-image-2.5' catalog entry
      // maps to providerModel 'gpt-image-2.5-sunburst'; OpenAI has no bare
      // "gpt-image-2.5" model and 400s on it (confirmed against OpenAI's
      // own docs: the two real ids are gpt-image-2.5-sunburst and
      // gpt-image-2.5-flare). Default to sunburst, the higher-fidelity of
      // the two -- portrait/character-sheet generation is what every
      // downstream video render conditions on, so a weaker image model
      // here compounds into a weaker video; flare trades some of that
      // fidelity for ~50% faster generation.
      imageModel: optional('OPENAI_IMAGE_MODEL') ?? 'gpt-image-2.5-sunburst',
      simulate,
      // The worker's own egress to api.openai.com is broken (persistent
      // HeadersTimeout from this container). gpt-image calls are proxied through
      // api-v2's healthy egress over Railway's private network.
      //
      // Bugfix: API_V2_INTERNAL_URL is undocumented and unset in every env
      // file this repo ships (.env.prod, .env.example, .env.local) AND unset
      // in docker-compose.yml's own primitive-worker-vnext service -- only
      // the hosted Railway deployment ever set it. Every self-host deploy via
      // docker-compose.yml therefore silently fell through to the
      // '.railway.internal' literal below, which cannot resolve outside
      // Railway's own private network. The failure mode is not a fast, loud
      // error: generateImageViaApiV2's own 75s fetch timeout classifies a DNS
      // failure as PROXY_UNREACHABLE/retryable, and character_sheet_gpt2 /
      // portrait_gpt2's proxyActivities retry policy (make-ugc-video.ts:
      // maximumAttempts 3) exhausts and fails the WORKFLOW within a few
      // minutes -- so this alone doesn't explain an indefinitely-stuck run,
      // but it does mean self-host image generation was broken outright
      // whenever the worker WAS healthy and actually attempted the call.
      // docker-compose.yml already sets API_V2_URL (http://api-v2:3001) on
      // this exact service for every other internal call this worker makes
      // (TEMPORAL_ADDRESS aside) -- reuse it here as the second choice,
      // before the Railway-only literal, so a plain `docker compose up`
      // resolves correctly with zero extra configuration. Explicitly setting
      // API_V2_INTERNAL_URL (e.g. on the hosted Railway deployment, or to
      // point the proxy somewhere else entirely) still overrides both.
      imageProxyUrl:
        optional('API_V2_INTERNAL_URL') ?? optional('API_V2_URL') ?? 'http://api-v2.railway.internal:3001',
      imageProxySecret: simulate
        ? (optional('INTERNAL_API_SECRET') ?? 'simulate')
        : required('INTERNAL_API_SECRET'),
    },
    r2: {
      // R2_ACCOUNT_ID only builds Cloudflare's endpoint hostname; when
      // S3_ENDPOINT points elsewhere (MinIO, AWS S3, Ceph) it is never read,
      // so a self-hoster must not be forced to invent one.
      accountId: optional('S3_ENDPOINT')
        ? (optional('R2_ACCOUNT_ID') ?? '')
        : required('R2_ACCOUNT_ID'),
      accessKeyId: required('R2_ACCESS_KEY_ID'),
      secretAccessKey: required('R2_SECRET_ACCESS_KEY'),
      bucket: optional('R2_BUCKET') ?? 'vantly-ugc',
      publicUrl: optional('R2_PUBLIC_URL') ?? 'https://pub-16e2ed8f6be84691845e91436920ce0a.r2.dev',
    },
    supabase: {
      url: required('SUPABASE_URL'),
      serviceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
    },
    caps: {
      primitiveUsd: readNumber('PRIMITIVE_CAP_USD', 0.5),
      runUsd: readNumber('RUN_CAP_USD', 5),
      dayUsd: readNumber('DAY_CAP_USD', 20),
    },
  };
}
