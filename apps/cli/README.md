# vantly-ugc CLI

**UGC for developers. Generate AI videos with talking heads, B-roll, voiceover, and subtitles — from your terminal.**

[![npm version](https://img.shields.io/npm/v/vantly-ugc-cli)](https://www.npmjs.com/package/vantly-ugc-cli)
[![downloads](https://img.shields.io/npm/dm/vantly-ugc-cli)](https://www.npmjs.com/package/vantly-ugc-cli)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

## Install

```bash
npm install -g vantly-ugc-cli
```

## Quick Start

```bash
# 1. Log in
vantly-ugc login

# 2. Pick an actor
vantly-ugc actor list

# 3. Generate a UGC video
vantly-ugc ugc "Stop scrolling. This tool changed everything for me." \
  --actor sofia --style neon --duration 10 --sync

# 4. Add subtitles to any video
vantly-ugc subtitle ./video.mp4 --style hormozi --sync
```

## UGC Pipeline

Script → scene splitting → TTS voiceover → AI talking heads → AI B-roll → crossfade assembly → animated subtitles → background music → end screen CTA

```bash
# Basic UGC with actor
vantly-ugc ugc "your script..." --actor marcus --style tiktok --sync

# With B-roll cutaway scenes
vantly-ugc ugc "your script..." --actor sofia --broll --sync

# With product screenshots as B-roll
vantly-ugc ugc "your script..." --actor sofia --broll \
  --broll-images ./dashboard.png,./calendar.png --sync

# AI-generated script from a product description
vantly-ugc ugc -g "A fitness tracker that monitors sleep quality" --actor naomi --sync

# PIP mode (talking head + rotating B-roll overlays)
vantly-ugc ugc "your script..." --actor adaeze --pip --duration 15 --sync

# Product Acting UGC from a product image URL
vantly-ugc product-acting \
  --product-image https://cdn.example.com/product.png \
  --actor sofia \
  --about "A premium perfume with a warm vanilla dry-down" \
  --template product-in-hand \
  --acting-style honest-review \
  --sync
```

## UGC Flags

| Flag | Description |
|------|-------------|
| `--actor <slug>` | AI actor for talking heads (required) |
| `--style <name>` | Subtitle style (17 options — see below) |
| `-d, --duration <s>` | 5, 10, or 15 seconds |
| `--tone <name>` | energetic, calm, confident, dramatic |
| `--music <genre>` | chill, energetic, corporate, dramatic, upbeat |
| `--aspect <ratio>` | 9:16, 16:9, 1:1 |
| `--cta <text>` | End screen call-to-action |
| `--broll` | Enable AI B-roll cutaways |
| `--broll-images <urls>` | Image URLs for B-roll |
| `--pip` | PIP mode |
| `--template <slug>` | monologue, testimonial, problem-solution, saas-review, before-after, listicle, product-demo |
| `--voice-speed <n>` | TTS speed (0.7–1.5) |
| `-g, --generate-script` | AI-generate script from description |
| `-s, --sync` | Wait for completion |

## Subtitle Styles (17)

hormozi, minimal, bold, karaoke, clean, tiktok, neon, fire, glow, pop, aesthetic, impact, pastel, electric, boxed, gradient, spotlight

## All Commands

```bash
vantly-ugc ugc "script..."                # Generate UGC video
vantly-ugc saas-review --saas Linear      # Generate a SaaS Review video
vantly-ugc product-acting --product-image https://... --actor sofia --about "..." --sync
vantly-ugc actor list                     # Browse 200+ AI actors
vantly-ugc subtitle ./video.mp4           # Add subtitles
vantly-ugc status <job-id>                # Check job status
vantly-ugc download <job-id>              # Download video
vantly-ugc list                           # List your jobs
vantly-ugc credits                        # View credit balance
vantly-ugc subscribe                      # Subscribe or buy credits
vantly-ugc apikey list                    # Manage API keys
vantly-ugc whoami                         # Current user info
vantly-ugc doctor                         # Run diagnostics
vantly-ugc update                         # Update CLI + Claude Code skill docs
```

## Updates

```bash
# Update the global CLI package and refresh Claude Code skill docs
vantly-ugc update

# Preview what would update without changing anything
vantly-ugc update --check

# Force reinstall the latest npm CLI and refresh the Claude Code skill
vantly-ugc update --force

# Update only one side when needed
vantly-ugc update --cli-only
vantly-ugc update --skills-only
```

Skill docs are refreshed from `gitroomhq/vantly-ugc-app` with Claude Code selected non-interactively:

```bash
npx --yes skills add gitroomhq/vantly-ugc-app --agent claude-code --yes
```

Self-updates use npm by default. If you intentionally manage global packages with pnpm or yarn, set `VANTLY_UGC_UPDATE_PM=pnpm` or `VANTLY_UGC_UPDATE_PM=yarn`.

## Pricing

| Plan | Price | Credits/month | ~10s Videos |
|------|-------|---------------|-------------|
| Creator | $39/mo | 3,900 | ~13 |
| Pro | $69/mo | 6,900 | ~23 |
| Pro Plus | $129/mo | 12,900 | ~43 |

30 credits/sec. Pay-as-you-go: 3,900 credits for $39.

## Also Available

| Package | Description |
|---|---|
| [`@vantly-ugc/sdk`](https://www.npmjs.com/package/@vantly-ugc/sdk) | TypeScript SDK |
| [`vantly-ugc`](https://pypi.org/project/vantly-ugc/) | Python SDK |
| [`vantly-ugc-mcp-server`](https://www.npmjs.com/package/vantly-ugc-mcp-server) | MCP server for Claude Code, Cursor, Windsurf |

## Links

- [Interactive API Docs](https://vantly-ugc.com/docs/api-reference)
- [OpenAPI Spec](https://vantly-ugc.com/openapi.json)
- [Website](https://vantly-ugc.com)
- [GitHub](https://github.com/gitroomhq/agent-media-app)

## License

Apache-2.0
