# Mailer System Audit: AutoGPT vs Vantly UGC

Same method as the Content Management audit: read AutoGPT's actual current mailer implementation end to end, read Vantly's actual current mailer implementation end to end, and report every real deviation with file citations — not what I assumed I built.

**Headline finding up front, since it matters most**: AutoGPT's Mailer is a mature, 21-phase-iterated email marketing platform (templates, scheduled/queued campaigns, real open/click/bounce tracking, a compliance-grade unsubscribe system, multi-provider sending, audience segmentation, AI-assisted list building, public opt-in landing pages, and automated lifecycle emails). What I built for Vantly earlier this session is a deliberately scoped-down MVP — Templates, Groups, Campaigns, and Resend-only sender settings, with synchronous send-now only. That scope-down **was disclosed at the time**, in the migration file's own comment (quoted below) — it was not hidden. But two things still need saying honestly: the scope-down is far larger than "a WYSIWYG builder," and there are real bugs sitting on top of that disclosed scope, not just gaps.

## Part A — AutoGPT's actual Mailer surface

AutoGPT's admin dashboard (`frontend/src/app/(platform)/admin/mailer/page.tsx`) has 8 sections:

1. **Templates** — `EmailTemplate` model: name, description, category (marketing/transactional/newsletter/onboarding/custom), subject/htmlContent/textContent as real **Jinja2** templates (conditionals, loops — not just `{{key}}` substitution), a `variables` JSON schema, draft/active/archived status, tags, optional per-template header/footer override, optional pass-through to a Postmark-hosted template, and tracked `sentCount`/`openRate`/`clickRate`. Backed by `backend/api/features/mailer/templates.py` (create/list/get/update, soft-delete via archive since campaigns FK to it, `/duplicate`, `/preview` with sample data, syntax validation on save) and a drag-and-drop visual builder (`templates/components/builder/*` — this is the exact builder that got ported into Vantly's Content Management this session).
2. **Campaigns** — `EmailCampaign`: real scheduling (`scheduledAt`, `scheduleType` one-time/daily/weekly/monthly/custom cron, timezone), a 7-state lifecycle (draft/scheduled/running/completed/paused/failed/cancelled), coupon integration (auto-injects `{{coupon_code}}`/`{{coupon_summary}}`), and social share-intent posting (drafts per-platform LinkedIn/X/Facebook/Threads copy, generates a public shareable campaign landing page, admin self-reports which platforms they actually posted to). Delivery is tracked per-recipient in a separate `EmailLog` table (see #3), not just two aggregate counters.
3. **Delivery tracking** — `EmailLog`: one row per recipient per campaign, with Postmark `messageId`, a 7-state delivery status (pending/sent/delivered/bounced/opened/clicked/spam_complained), timestamps and counts for opens/clicks, `clickedUrls[]`, bounce type/reason, spam complaints, and error code/message. Real open/click tracking pixels and redirect endpoints exist for both Postmark and AWS SES/SMTP sends (`services/mailer_tracking.py`, the two `getV1Mailer...TrackingPixel/Redirect...` generated routes).
4. **User Groups / segmentation** — `EmailUserGroup` supports three types: MANUAL (flat list), RULE_BASED, and SMART_LIST (both resolved dynamically against live user data — a real segmentation engine). A separate `EmailUserGroupMember` table carries per-member name/phone/subscription-tier and a `source` provenance field (MANUAL / CSV_IMPORT / WEBSITE_SYNC / LANDING_PAGE / B2B_AI_SEARCH), so a group can show exactly how each member joined. Groups can be synced from the platform's own `User` table on demand.
5. **Landing Pages** — `EmailLandingPage`: a public, unauthenticated opt-in form at `/subscribe/{slug}` (headline, subheadline, optional rich body, optional hero image with adjustable overlay) that feeds submissions straight into a target group as `EmailUserGroupMember` rows. This is a second, self-serve way to grow a mailing list.
6. **B2B List Builder** — `EmailB2BListRun` / `EmailB2BCandidate`: an admin describes a target audience in plain text, an LLM (Perplexity Sonar via OpenRouter, `backend/services/b2b_list_builder.py`) web-searches for plausible public contacts, each candidate lands as PENDING for admin review (approve/reject) before anything is committed into a real group. Nothing gets emailed without a human approving it first.
7. **Automated / lifecycle triggers** — `automated_triggers.py`, `welcome_email.py`, `no_subscription_nudge.py`: built-in triggered sends (e.g., a welcome email on signup, a win-back nudge for users who never subscribed), each independently on/off and editable, admin UI at `/admin/mailer/automated`.
8. **Branding + Sender Options** — `EmailBrandingConfig` (company email/website, default from/reply-to identity, privacy policy link) is a separate settings screen from **Sender Options** (`MailerSenderProvider`: POSTMARK / SES / SMTP, each with its own full credential set, a live "Send test email" action, and a status badge on the dashboard showing which provider is configured and whether the template engine is ready).

Also present platform-wide but load-bearing for Mailer specifically: a dedicated **unsubscribe/suppression system** (`EmailSuppression` table, `services/mailer_unsubscribe.py`, RFC 8058 one-click unsubscribe header support — the modern standard Gmail/Yahoo now require for bulk senders) checked by email address alone so it also covers CSV-imported contacts who have no user account; and **audit logging** of every admin mailer action via the platform's generic `AuditLog` table.

## Part B — Vantly's actual Mailer surface

One admin section, `/dashboard/admin/mailer` (single nav entry, not 8), covering three sub-pages plus a Settings tab:

- **Templates** (`email_templates` table + `/api/admin/mailer/templates*`): name, subject, html_content, text_content, a flat `variables: text[]` (documented, not enforced), status `active`/`archived` only (no draft), `sent_count`. Substitution is plain `{{key}}` string replace (`lib/mailer/render-template.ts`) — no conditionals, no loops. Has preview and send-test routes; no duplicate route, no per-template header/footer override, no Postmark-template pass-through, no open/click rate on the template itself (there's no tracking anywhere in this system — see below).
- **Groups** (`email_groups` table): two types only, `manual` (flat `members: text[]`, upload endpoint that merges CSV/pasted addresses with basic validation) and `all_users` (not a stored snapshot — resolved fresh at send time by paginating every Supabase auth user, `lib/mailer/resolve-recipients.ts`). No per-member detail rows, no rule-based/smart segmentation, no sync provenance, no landing-page or B2B-AI sources — those growth channels don't exist at all.
- **Campaigns** (`email_campaigns` table + `/api/admin/mailer/campaigns*`): name, template_id, group_id (optional), ad-hoc `recipient_emails`, one shared `template_vars` object (no per-recipient overrides), 4-state status (draft/sending/sent/failed — no scheduled/running/paused/cancelled), `total_recipients`/`total_sent`/`total_failed` only (no opened/clicked counts, because nothing tracks opens or clicks). No `scheduledAt`, no cron, no coupon integration, no social share.
- **Send mechanism** (`app/api/admin/mailer/campaigns/[id]/send/route.ts`): synchronous, in the request handler, via Resend's batch API (100/call, hard-capped at 500 total recipients per send — larger campaigns are rejected outright with a message to split them). No queue, no retry, no webhook-driven delivery status.
- **Sender config**: Resend only (`lib/mailer/sender-config.ts`), one `mailer_config` row (from_name/from_email/reply_to/resend_api_key, DB overrides env), edited from **Settings → Mailer**, not a dedicated Mailer section. No Postmark/SES/SMTP option.
- **Branding**: `logo_url` and `footer_text` columns were added to `mailer_config` and are editable in the same Settings → Mailer tab — see Part D2, they are never actually used.

This is confirmed accurate against the migration file's own header comment (`supabase/migrations/20260904180000_mailer_core.sql`, lines 1–15 and the trailing `COMMENT ON TABLE`), which explicitly states the scope-down and the reasoning — this was a disclosed decision at build time, not something hidden from you.

## Part C — Capability comparison

| Capability | AutoGPT | Vantly |
|---|---|---|
| Template engine | Jinja2 (conditionals/loops), syntax-validated on save | Plain `{{key}}` string replace |
| Template lifecycle | draft/active/archived, duplicate, per-template header/footer, Postmark-template passthrough | active/archived only, no duplicate, no header/footer override |
| Campaign scheduling | one-time/daily/weekly/monthly/custom cron, timezone-aware | Send-now only |
| Campaign lifecycle | 7 states incl. paused/cancelled | 4 states, no pause/cancel |
| Send mechanism | Queued/webhook-driven, any campaign size | Synchronous, hard-capped at 500 recipients |
| Delivery tracking | Per-recipient log: delivered/opened/clicked/bounced/spam, real tracking pixels | None — only aggregate sent/failed counts |
| Unsubscribe / suppression | Dedicated suppression list, RFC 8058 one-click header, checked by email regardless of source | **None at all** — see D2 |
| Sender providers | Postmark, SES, or SMTP, each independently configurable | Resend only |
| Audience segmentation | Manual, rule-based, and dynamic smart lists; per-member provenance | Manual list or "all users" only |
| List growth channels | Public opt-in landing pages; AI-assisted B2B contact discovery with human review | None — groups are hand-built or CSV only |
| Automated lifecycle emails | Welcome email, win-back nudge, generically extensible | None |
| Branding | Dedicated screen, merges with platform GeneralSettings, live preview | Two fields in Settings tab, unused (D2) |
| Admin audit log | Every mailer action logged | None |
| Coupon / social integrations | Built in | None |

## Part D — Deviations

### D1 — Disclosed scope cuts (already documented in the migration comment when this was built)

1. No scheduling — send-now only, no `scheduledAt`/cron/recurring sends.
2. No delivery tracking at all — no opens, clicks, bounces, or spam complaints; no `EmailLog`-equivalent table.
3. No unsubscribe/suppression list.
4. Sender is Resend-only; no Postmark/SES/SMTP option.
5. No Landing Pages (public opt-in forms).
6. No B2B List Builder (AI-assisted contact discovery).
7. No automated lifecycle triggers (welcome email, win-back nudge).
8. No rule-based/smart-list segmentation, no per-member detail/provenance table.
9. No visual drag-and-drop template builder *at the time this was built* — since resolved: this session ported AutoGPT's builder into Content Management, and it would be straightforward to reuse for Templates too (not done yet).
10. Plain `{{key}}` substitution instead of Jinja2 — no conditionals/loops in template content.
11. No campaign scheduling states (scheduled/running/paused/cancelled), no coupon integration, no social-share posting.
12. No template duplicate action, no draft template status, no per-template header/footer override, no Postmark-template passthrough.
13. No admin audit log for mailer actions.

### D2 — Undisclosed gaps found during this audit (not called out anywhere before now)

1. **`logo_url` and `footer_text` are dead config.** Both were added to `mailer_config` and are editable in Settings → Mailer (confirmed: `_mailer-tab.tsx` loads/saves them), but a repo-wide search shows they are read nowhere else — the campaign send route (`.../send/route.ts`) and send-test route render only the template's own `subject`/`html_content`/`text_content`, with no header/footer/logo composition step at all. An admin who sets a logo believing it will appear on outgoing campaigns is wrong; nothing changes. Same class of bug as Content Management's dead `hasHero` flag.
2. **No unsubscribe mechanism of any kind, and no suppression check before sending — including for the `all_users` group.** This is the one item I'd flag as higher priority than a feature-parity gap: sending marketing email with no unsubscribe link and no way to honor a stop-emailing-me request is a real CAN-SPAM/GDPR/deliverability risk, not just a missing nice-to-have. AutoGPT treats this as a first-class, dedicated system (separate from its general notification opt-outs) precisely because a CSV-imported contact has no account to flip a notification flag on.
3. **A campaign can get permanently stuck in `status = 'sending'`.** The send route claims the campaign (`status: 'draft' → 'sending'`) before doing any sending, then does the actual Resend calls synchronously in the same request. If that request times out, crashes, or the server restarts mid-send (very plausible with up to 500 recipients across 5 batched calls to an external API), the campaign is left in `sending` forever — the claim guard that stops double-sends also means nothing can ever resume or reset it. There's no visible "force back to draft" action in the admin UI for this state.
4. **No template duplication**, unlike AutoGPT — a minor but genuine capability gap not called out in the original scope-down comment.

### D3 — Net assessment

Everything in D1 was a real, deliberate, disclosed trade-off at the time — I'm not walking that back. But "scoped down per the plan's own verdict" undersells the actual gap: this compares a single-evening MVP against a mailer platform that took AutoGPT 21 development phases to build, including an LLM-powered lead-generation feature and RFC-compliant unsubscribe handling. If you're using this for real marketing sends, D2.2 (no unsubscribe) is the one I'd want to fix regardless of AutoGPT parity — it's an operational risk today, not a someday feature.

## What I'd suggest, if you want a next step

Given the size of the gap, I don't think "implement all of it" is the right instinct here the way it was for Content Management — B2B AI list-building alone is a multi-day feature with its own LLM integration. A reasonable, scoped next pass, if you want one:

1. Fix the two undisclosed bugs (D2.1 dead branding fields, D2.3 stuck-send recovery) — small, clearly correctness issues.
2. Add a real unsubscribe link + suppression table (D2.2) — the compliance-relevant gap.
3. Everything else in D1 is a genuine product-scope decision, not a bug — worth deciding deliberately rather than defaulting to "match AutoGPT."

Let me know which of these you want done, and I'll implement exactly that scope — nothing more assumed this time.
