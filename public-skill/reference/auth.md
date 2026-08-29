# Auth — first-time setup

vantly-ugc uses a `ma_*` Bearer API key. Get one via the CLI:

```bash
npm install -g vantly-ugc-cli
vantly-ugc login
```

This stores the key at `~/.vantly-ugc/credentials.json`. The bundled MCP server reads it via the `VANTLY_UGC_API_KEY` environment variable; the plugin's `.mcp.json` does `${VANTLY_UGC_API_KEY}` interpolation.

## Without the CLI

You can paste the `ma_*` token directly:

```bash
export VANTLY_UGC_API_KEY="ma_..."
```

## How the key is used

- MCP server forwards it as `Authorization: Bearer ma_...` to `api.vantly-ugc.com`.
- Server resolves it to a `user_id` and runs every primitive against that account.
- Credits debit from the same account.

## Rotation

`vantly-ugc logout && vantly-ugc login` rotates the key. The old key keeps working for ~30 days unless explicitly revoked.
