<!--
  AUTO-GENERATED — do not hand-edit.
  Source: packages/schema/src/v2/generators.ts
  Regenerate: pnpm --filter @vantly-ugc/schema gen:v2-docs
-->

# Common errors + fixes

## CLI

| Error | Fix |
|---|---|
| `ERR_MODULE_NOT_FOUND: @vantly-ugc/schema` | You're on an old CLI. Run `npm install -g vantly-ugc-cli@latest`. |
| `Not authenticated. Run vantly-ugc login first.` | API key missing. Run `vantly-ugc login`. |
| `LOGIN_TIMEOUT` | Browser didn't complete OAuth in time. Re-run `vantly-ugc login`. |
| `DEPRECATED v1 command: vantly-ugc ugc` | You called a legacy command. Switch to `vantly-ugc selfie`. |

## API

| Code | Meaning | Fix |
|---|---|---|
| `VALIDATION_ERROR` | Input body failed schema. Check the `issues` array in the response. | Adjust args to match the input schema. |
| `UNAUTHORIZED` | Bearer token missing or invalid. | Re-run `vantly-ugc login`. |
| `INSUFFICIENT_CREDITS` | Not enough credits on the account. | Run `vantly-ugc subscribe` to top up. |
| `WORKER_NOT_CONFIGURED` | Server-side misconfig — should not normally occur. | Ping support. |
| `DATABASE_ERROR` | Server insert failed (often missing models row). | Ping support, report the job request. |
