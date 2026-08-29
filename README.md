# vantly-ugc

AI UGC video generation from your terminal, your editor, or your AI agent.

[`vantly-ugc.com`](https://vantly-ugc.com) · [Install the skill](https://vantly-ugc.com/skill) · [API reference](https://vantly-ugc.com/docs/api-reference) · [Pricing](https://vantly-ugc.com/pricing)

**Docs:** [Architecture](ARCHITECTURE.md) · [Self-hosting](#self-hosting) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## What it does

### Agents (MCP / HTTP): one tool — `make_ugc`

For AI agents (Claude Code, Cursor, Claude.ai/Cowork, …) the surface is a **single tool, `make_ugc` ("Vantly UGC Video")**. Give it a script plus an optional person description, image, or saved character, and it returns a finished vertical video — it resolves identity and routes to the right engine internally (no sub-skill picking).

- **Captions are opt-in.** They are **not** added automatically; the agent asks whether you want captions (and which style) before adding them.
- **Same person within a session is reused.** After the first video the character is saved; a follow-up request reuses it (faster, on-model) unless you ask for a new one — the agent narrates each step (portrait → sheet → video → captions) as it runs.

### CLI / SDK: the low-level v2 generators

| Generator | What it makes |
|---|---|
| **Selfie** | 9:16 TikTok-style UGC video. **No photo needed** — generates a realistic actor, character sheet, photographic wireframe/storyboard board, then a Seedance 2.0 video. Durations: 5 / 10 / 15 s. |
| **Character** | Persists a reusable character (`char_xxxxxxxxxx`) so subsequent Selfies stay on-model. |
| **Subtitle** | Burns styled subs onto any existing video. Whisper transcribe or pass `--transcript`. |

Pricing lives at <https://vantly-ugc.com/pricing>. The API debits internally — agents and SDK consumers should never need to quote credit numbers to end users.

## Connect — no API key needed

**One server URL. Sign in with your browser. That's it.**

```
https://api.vantly-ugc.com/mcp
```

The hosted connector speaks **OAuth 2.1 with dynamic client registration**, so your
agent registers itself and opens a sign-in page — you never copy a key, and no
secret is stored in a config file.

### The fastest way: paste this to your agent

Works in Claude Code, Cursor, Claude Desktop, or anything that speaks MCP — the
agent sets *itself* up:

```text
Set up vantly-ugc for me so I can generate UGC videos from here.
1. Add the vantly-ugc MCP server: https://api.vantly-ugc.com/mcp (Streamable HTTP).
2. Authenticate: complete the sign-in in the browser it opens.
3. Install the companion skills: run `npx skills add gitroomhq/vantly-ugc-app`.
Once that's done, let me know when it's ready.
```

Then just ask: *"make me a UGC video of a woman reviewing my hair oil."*

### Claude.ai / Claude Desktop / Cowork

Settings → **Connectors** → Add custom connector → name it `vantly-ugc`, paste
`https://api.vantly-ugc.com/mcp` → **Connect** → sign in. Done.

### Cursor / Continue / Windsurf

Point the client at the same hosted URL and it will run the OAuth flow:

```jsonc
// ~/.cursor/mcp.json (or your client's equivalent)
{
  "mcpServers": {
    "vantly-ugc": { "url": "https://api.vantly-ugc.com/mcp" }
  }
}
```

<details>
<summary>Prefer an API key, or need a local stdio server? (optional)</summary>

Keys still work everywhere OAuth does — useful for CI and headless scripts.
Get one with `npm i -g vantly-ugc-cli && vantly-ugc login`, or from the
dashboard, then either send `Authorization: Bearer ma_...` to the hosted URL, or
run the stdio server locally:

```jsonc
{
  "mcpServers": {
    "vantly-ugc": {
      "command": "npx",
      "args": ["-y", "@vantly-ugc/mcp-server"],
      "env": { "VANTLY_UGC_API_KEY": "ma_..." }
    }
  }
}
```
</details>

### Standalone CLI / scripts / CI

```bash
npm install -g vantly-ugc-cli@latest
vantly-ugc login
vantly-ugc selfie \
  --description "25yo asian woman, long wavy dark hair, soft smile" \
  --script "I keep getting DMs about my hair oil routine" \
  --scene-action "standing by a bright vanity, showing a small amber hair-oil bottle and scrunching one curl mid-line" \
  --duration 10
```

## Keeping the skill up-to-date

The CLI ships an updater:

```bash
vantly-ugc skill update       # pulls the latest skill tree
vantly-ugc skill status       # local vs remote version
```

Every CLI invocation also runs a once-per-day background check and prints a one-line nudge when a newer skill version is available.

## Published packages

| Package | Version | Notes |
|---|---|---|
| [`vantly-ugc-cli`](https://www.npmjs.com/package/vantly-ugc-cli) | `1.18.0+` | the CLI |
| [`@vantly-ugc/mcp-server`](https://www.npmjs.com/package/@vantly-ugc/mcp-server) | `0.7.0+` | local stdio MCP — reads `/v1/skills` live (make_ugc) |
| [`@vantly-ugc/sdk`](https://www.npmjs.com/package/@vantly-ugc/sdk) | `0.5.0+` | TypeScript SDK |
| [`@vantly-ugc/schema`](https://www.npmjs.com/package/@vantly-ugc/schema) | `0.5.0+` | shared zod schemas + registry |

## The skill pack

[`public-skill/`](public-skill/) is the agent-facing pack: the `make-ugc` skill (the one
generation tool) plus `vantly-ugc-ugc`, `make-podcast`, `publish-to-social`, a
plugin/marketplace manifest, and `reference/` docs. It is generated from the skill
registry by `services/api-v2/scripts/generate-public-skill.ts` — edit the registry, not
the emitted files.

Install it into an agent with `npx skills add gitroomhq/vantly-ugc-app`, or as a Claude
Code plugin (see [`public-skill/README.md`](public-skill/README.md)).

## Repository layout (this monorepo)

```
apps/
  cli/                       vantly-ugc CLI source
  web/                       vantly-ugc.com (marketing + dashboard)
packages/
  schema/                    @vantly-ugc/schema — zod schemas + V2_GENERATORS registry (source of truth)
  sdk-ts/                    @vantly-ugc/sdk
  sdk-python/                vantly-ugc (PyPI)
  mcp-server/                @vantly-ugc/mcp-server
services/
  api-v2/                    REST API (api.vantly-ugc.com) — routes, auth, dispatch
  media-worker-v2/           pipeline runner — gpt-image-2 + Seedance + ffmpeg
public-skill/                generated agent skill pack (one agent tool: make_ugc)
supabase/migrations/         schema, RLS, edge functions
docs/v2/api-reference.md     auto-generated REST reference
```

Add a new v2 product: drop a row in `packages/schema/src/v2/generators.ts`, run `pnpm --filter @vantly-ugc/schema gen:v2-docs`, and the CLI command, MCP tool, REST route, SDK method, docs, and skill reference file all materialize from the registry.

## License

Apache-2.0

## Self-hosting

Run the whole stack locally or on your own infrastructure. Billing is **off** by
default for self-hosters — bring your own provider keys and generate freely.

```bash
cp .env.example .env.local              # local dev — add your Evolink / OpenAI / Anthropic keys
docker compose --env-file .env.local up

# for a real deployment:
cp .env.example .env.prod               # production — fill in real secrets
docker compose --env-file .env.prod up -d
```

That brings up everything: Postgres, Supabase Auth (GoTrue), PostgREST, Supabase
Storage, Temporal, MinIO (S3-compatible storage), the four backend services and
the dashboard. Migrations are applied automatically on first boot.

- **Dashboard** → `http://localhost:3005` (set `WEB_PORT` to change it)
- **API** → `http://localhost:3001`

Also overridable if they collide with another local stack: `POSTGRES_PORT`
(default 5433), `TEMPORAL_PORT` (default 7234), `MEDIA_WORKER_PORT` (default
3010) — see `.env.example`.

A bare Postgres is *not* enough — the app depends on Supabase's Auth and
PostgREST APIs, so the compose file runs those as real services rather than
pretending Postgres alone will do.

**Dashboard only — there is no marketing site here.** `/` redirects straight to
`/dashboard`, and `robots.txt` disallows everything, because a self-hosted
instance has no business being indexed. The hosted site at vantly-ugc.com keeps
its own landing pages, pricing and SEO surface; none of that is in this repo.
Agents talk to the API directly and never see the UI at all.

You are not tied to our vendors: Temporal Cloud → the Temporal container,
Cloudflare R2 → MinIO (or any S3-compatible store via `S3_ENDPOINT`),
Railway/Vercel → any container or Node host. Every backend service ships its own
`Dockerfile` and is published to GHCR, so you can deploy them independently and
scale them separately. Configuration is injected at runtime; nothing is baked
into the images.

See [ARCHITECTURE.md](ARCHITECTURE.md) for how the pieces fit together and which
providers are swappable.

## License

Apache-2.0 — see [LICENSE](LICENSE). No follow-on obligations beyond the license.
