# vantly-ugc-mcp-server

MCP server for [vantly-ugc](https://vantly-ugc.com) — generate AI UGC videos from Claude Code, Cursor, Windsurf, or any MCP-compatible client.

UGC for developers. Script in, video URL out — directly from your IDE.

[![npm version](https://img.shields.io/npm/v/vantly-ugc-mcp-server)](https://www.npmjs.com/package/vantly-ugc-mcp-server)
[![license](https://img.shields.io/npm/l/vantly-ugc-mcp-server)](https://github.com/gitroomhq/agent-media-app/blob/main/LICENSE)

## What It Does

This package is a thin stdio proxy to the hosted vantly-ugc MCP connector at
`https://api.vantly-ugc.com/mcp`. It opens that connector over Streamable
HTTP with your API key as the bearer, and re-exposes over stdio exactly the
tools the hosted side lists — so the tool set here is always current with no
release of this package needed. Ask your AI assistant to list its available
tools (or call `tools/list`) to see the live set; as of this writing it
includes `make_ugc` (script + person/image/character in, finished vertical
video out), `list_characters`, `get_run_status`, the loose
`generate_image` / `generate_video` / `generate_audio` primitives with
`quote` and `list_models`, plus the composed skills (`make_podcast`,
`make_subtitles`, `make_storybook`, ...).

If your client can add a remote MCP server directly, skip this package and
point it at the hosted connector instead:

```bash
claude mcp add --transport http vantly-ugc https://api.vantly-ugc.com/mcp
```

## Setup

### 1. Get an API Key

Sign up at [vantly-ugc.com](https://vantly-ugc.com) and generate an API key in Settings.

### 2. Configure Your IDE

#### Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "vantly-ugc": {
      "command": "npx",
      "args": ["-y", "vantly-ugc-mcp-server"],
      "env": {
        "VANTLY_UGC_API_KEY": "ma_your_key_here"
      }
    }
  }
}
```

#### Cursor

Open Settings > MCP Servers > Add Server:

```json
{
  "vantly-ugc": {
    "command": "npx",
    "args": ["-y", "vantly-ugc-mcp-server"],
    "env": {
      "VANTLY_UGC_API_KEY": "ma_your_key_here"
    }
  }
}
```

#### Windsurf

Open Settings > MCP > Add:

```json
{
  "vantly-ugc": {
    "command": "npx",
    "args": ["-y", "vantly-ugc-mcp-server"],
    "env": {
      "VANTLY_UGC_API_KEY": "ma_your_key_here"
    }
  }
}
```

#### Global Install (Alternative)

```bash
npm install -g vantly-ugc-mcp-server
export VANTLY_UGC_API_KEY=ma_your_key_here
vantly-ugc-mcp
```

## Usage Examples

Once configured, ask your AI assistant:

> "Make a UGC video of someone explaining why our product is great, no captions"

> "List my saved characters, then make a podcast-style video with two of them"

> "Generate a 5-second video of a fox cub exploring a garden, seedance-2.0, 9:16"

> "Check the status of run abc123"

The MCP server forwards these to the hosted connector, which handles auth, credits, dispatch and status — call `get_run_status` on the returned id for the finished output URL.

## Tool Parameters

Each tool's parameters are described by its own JSON Schema, served live by
the hosted connector (`tools/list`) — most MCP clients (Claude Code, Cursor,
Claude Desktop) show these to the agent automatically, so they are not
duplicated here where they would go stale. `make_ugc`'s tool description
documents its script/person/character inputs; `generate_video`'s documents
prompt/model/refs/frames; and so on.

Call `get_run_status` with the `run_id` any tool returns to check progress
and, when done, get the output URL — the proxy does not poll for you.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `VANTLY_UGC_API_KEY` | Yes | — | Your API key (`ma_xxx` format) |
| `VANTLY_UGC_API_URL` | No | Production API | Override the API base URL |

## Related Packages

| Package | Description |
|---|---|
| [`@vantly-ugc/sdk`](https://www.npmjs.com/package/@vantly-ugc/sdk) | TypeScript SDK for direct API integration |
| [`vantly-ugc-cli`](https://www.npmjs.com/package/vantly-ugc-cli) | CLI tool — generate videos from your terminal |
| [`@vantly-ugc/schema`](https://www.npmjs.com/package/@vantly-ugc/schema) | Shared schema — enums, types, Zod validation |
| [`vantly-ugc`](https://pypi.org/project/vantly-ugc/) | Python SDK |

## Links

- [Interactive API Docs](https://vantly-ugc.com/docs/api-reference)
- [OpenAPI Spec](https://vantly-ugc.com/openapi.json)
- [Website](https://vantly-ugc.com)
- [GitHub](https://github.com/gitroomhq/agent-media-app)

## License

Apache-2.0
