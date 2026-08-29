# @vantly-ugc/schema

Single source of truth for the [vantly-ugc](https://vantly-ugc.com) platform — enums, Zod validation schemas, TypeScript types, and the generator registry.

[![npm version](https://img.shields.io/npm/v/@vantly-ugc/schema)](https://www.npmjs.com/package/@vantly-ugc/schema)
[![license](https://img.shields.io/npm/l/@vantly-ugc/schema)](https://github.com/gitroomhq/agent-media-app/blob/main/LICENSE)

## Why This Package Exists

Every option in the vantly-ugc API — tones, music genres, subtitle styles, durations, templates, scene types — is defined exactly once in this package. All consumers (REST API, CLI, dashboard, MCP server, SDKs, docs) import from here. Adding a new subtitle style or template is a one-line change that propagates everywhere on the next build.

## Install

```bash
npm install @vantly-ugc/schema
```

## What's Inside

### Enums (as `const` arrays + TypeScript types)

```typescript
import {
  TONES,          // ['energetic', 'calm', 'confident', 'dramatic']
  MUSIC_GENRES,   // ['chill', 'energetic', 'corporate', 'dramatic', 'upbeat']
  SUBTITLE_STYLES,// 17 styles: 'hormozi', 'minimal', 'bold', 'neon', 'fire', ...
  DURATIONS,      // [5, 10, 15]
  ASPECT_RATIOS,  // ['9:16', '16:9', '1:1']
  SCENE_TYPES,    // ['talking_head', 'broll']
  TEMPLATES,      // 8 templates
  VOICES,         // ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer']
  REVIEW_ANGLES,  // ['honest', 'enthusiastic', 'roast', 'tutorial', 'comparison']
  // + PIP_POSITIONS, PIP_SIZES, PIP_ANIMATIONS, PIP_FRAME_STYLES, COMPOSITION_MODES
} from '@vantly-ugc/schema';

// TypeScript literal types are derived automatically:
import type { Tone, SubtitleStyle, Template } from '@vantly-ugc/schema';
```

### Zod Validation Schemas

```typescript
import { CreateVideoSchema, SubtitleSchema, ProductReviewSchema, ProductActingSchema } from '@vantly-ugc/schema';

// Validate API input
const result = CreateVideoSchema.safeParse(requestBody);
if (!result.success) {
  console.error(result.error.issues); // structured errors with field paths
}
```

### Generator Registry

```typescript
import { GENERATORS, GENERATOR_IDS } from '@vantly-ugc/schema';

// Each generator is a black box: inputs -> [generator] -> output
console.log(GENERATOR_IDS); // ['ugc_video', 'saas_review', 'subtitle', 'show_your_app', 'product_acting_ugc']

// Access a generator's Zod input schema
const schema = GENERATORS.ugc_video.inputSchema;
```

## Use Cases

This package is useful if you're building:

- **A custom integration** with the vantly-ugc API (validate inputs before sending)
- **An SDK** in another language (read the enums, generate code)
- **A UI** that needs dropdown options from the schema
- **A testing harness** (import valid values for test fixtures)

## Build-Time Generation

The schema powers auto-generated artifacts:

- `generated/openapi.json` — full OpenAPI 3.1 spec (via `npm run generate:openapi`)
- `supabase/functions/_shared/schema.generated.ts` — Deno-compatible copy for edge functions (via `npm run generate:edge-schema`)

## Related Packages

| Package | Description |
|---|---|
| [`@vantly-ugc/sdk`](https://www.npmjs.com/package/@vantly-ugc/sdk) | TypeScript SDK — uses this schema for types |
| [`vantly-ugc-mcp-server`](https://www.npmjs.com/package/vantly-ugc-mcp-server) | MCP server for Claude Code, Cursor, Windsurf |
| [`vantly-ugc-cli`](https://www.npmjs.com/package/vantly-ugc-cli) | CLI tool — generate videos from your terminal |
| [`vantly-ugc`](https://pypi.org/project/vantly-ugc/) | Python SDK |

## Links

- [Interactive API Docs](https://vantly-ugc.com/docs/api-reference)
- [OpenAPI Spec](https://vantly-ugc.com/openapi.json)
- [Website](https://vantly-ugc.com)

## License

Apache-2.0
