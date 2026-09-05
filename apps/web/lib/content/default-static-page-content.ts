// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Plain-HTML copies of the hardcoded default content the Privacy and Terms
 * public pages fall back to (see app/privacy/page.tsx and
 * app/terms/page.tsx) -- used ONLY to pre-fill the admin Content Management
 * editor (app/(app-dark)/dashboard/admin/content/page.tsx) when a slug has
 * no static_pages row yet, so an admin editing "Privacy" or "Terms" starts
 * from the real current copy instead of a blank textarea.
 *
 * This file does NOT change what the public /privacy and /terms pages
 * render -- those keep their own independent hardcoded JSX fallback
 * unchanged (same conditional "no contact configured" copy, same public
 * URL, same behavior as before). This is a second, admin-only copy of
 * that same content, written as sanitizer-safe HTML (see
 * lib/content/sanitize-html.ts's ALLOWED_TAGS) with {{site_url}} /
 * {{support_contact}} placeholders instead of the JSX's inline template
 * values, so that if the admin just hits Save without editing a word, the
 * saved row renders (via renderContentVars) equivalently to today's
 * default. If the admin never opens the editor for these slugs, nothing
 * changes: no row is written until Save is clicked.
 */

export const DEFAULT_PRIVACY_TITLE = 'Privacy Policy';

export const DEFAULT_PRIVACY_HTML = `
<p>This Privacy Policy describes what information is collected by the service running at <strong>{{site_url}}</strong> (the &ldquo;Service&rdquo;) and how it is used, for people who create an account or otherwise use it.</p>
<p>This page is a starting template, not legal advice. The operator of this instance is the data controller for information collected here and is responsible for reviewing and adapting this policy &mdash; including for any regulation that applies to them, such as GDPR or CCPA &mdash; before relying on it.</p>
<h2>1. Information collected</h2>
<p>The Service processes:</p>
<ul>
<li>Account information: your email address, and profile details from any SSO provider you sign in with (for example a Google account, or a connected Vantly organization).</li>
<li>Content you provide: prompts, reference images, character sheets, and other input used to generate video and image content.</li>
<li>Generated output: the videos, images, and captions the Service creates for you, and metadata about generation jobs (status, timing, credit cost where billing is enabled).</li>
<li>Connected-account tokens: credentials needed to publish to a social platform on your behalf via Vantly, once you choose to connect one.</li>
<li>Basic operational data: request logs and error reports used to keep the Service running.</li>
</ul>
<h2>2. How information is used</h2>
<p>Information is used to operate your account, generate the content you request, publish content to accounts you&rsquo;ve connected (including on a schedule you configure), process billing where enabled, and maintain and improve the Service&rsquo;s reliability and security.</p>
<h2>3. Where information is stored &amp; processed</h2>
<p>Account and application data is stored in this instance&rsquo;s own database (Supabase-compatible Postgres). Generated media is stored in this instance&rsquo;s own object storage (Cloudflare R2 or a self-hosted S3-compatible store). Prompts, reference material, and generation requests are sent to the AI providers this instance is configured to use (for example OpenAI and Evolink) to produce output. Publishing requests are sent to Vantly and, in turn, to whichever social platform you connect. None of these are controlled by vantly-ugc the software project &mdash; they are the operator&rsquo;s own infrastructure and accounts, or the third-party providers the operator has configured.</p>
<h2>4. Sharing</h2>
<p>Information is shared only as needed to provide the Service: with the AI providers used for generation, with Vantly and the social platforms you explicitly connect and choose to publish to, and with infrastructure providers (database, storage, email delivery) that host this instance. It is not sold, and it is not shared for third-party advertising.</p>
<h2>5. Your choices</h2>
<p>You can disconnect a social account at any time from the integrations page. You can ask the operator to export or delete your account data; contact details are below. Deleting your account removes access to generated content going forward but does not retract content already published to a connected platform.</p>
<h2>6. Retention</h2>
<p>Account data and generation history are kept for as long as your account is active, or as needed to operate the Service, unless the operator has configured a different retention period.</p>
<h2>7. Children</h2>
<p>The Service is not directed at children and is not intended for use by anyone under the age of 16.</p>
<h2>8. Changes</h2>
<p>The operator may update this Privacy Policy from time to time. Continued use of the Service after an update constitutes acceptance of the revised policy.</p>
<h2>9. Contact</h2>
<p>Questions about this policy, or requests to access or delete your data, can be sent to <strong>{{support_contact}}</strong>.</p>
`.trim();

export const DEFAULT_TERMS_TITLE = 'Terms of Use';

export const DEFAULT_TERMS_HTML = `
<p>These Terms of Use (&ldquo;Terms&rdquo;) govern access to and use of the service running at <strong>{{site_url}}</strong> (the &ldquo;Service&rdquo;), an instance of vantly-ugc, an agent-native AI UGC video generation platform. By creating an account or otherwise using the Service, you agree to these Terms. If you do not agree, do not use the Service.</p>
<p>This page is a starting template, not legal advice. The operator of this instance is responsible for reviewing and adapting it &mdash; including their legal name, jurisdiction, and contact details &mdash; before relying on it.</p>
<h2>1. The Service</h2>
<p>The Service lets you generate AI video and image content (character sheets, storyboards, UGC-style video) from prompts and reference material you provide, and optionally auto-publish the results to connected social accounts through a self-hosted Vantly integration. Generation is performed by third-party AI providers configured by the operator (for example OpenAI and Evolink); publishing is performed by the third-party platforms you connect to (for example X, TikTok, Instagram, or LinkedIn, via Vantly).</p>
<h2>2. Accounts</h2>
<p>You need an account to use most of the Service, created via email sign-in or a supported SSO provider. You are responsible for the activity that happens under your account and for keeping your access credentials secure. Let the operator know promptly if you suspect unauthorized use.</p>
<h2>3. AI-generated content &amp; your responsibility</h2>
<p>Content produced by the Service is machine-generated. It may occasionally be inaccurate, off-brand, or otherwise unexpected even with moderation in place, including when produced automatically by a recurring schedule you configure. You are solely responsible for reviewing generated content before it is published or otherwise used, and for everything posted to your connected social accounts &mdash; including content published automatically by a schedule you set up. Do not use the Service to generate content that is unlawful, infringing, defamatory, or that impersonates a real person without their consent.</p>
<h2>4. Connected social &amp; third-party accounts</h2>
<p>Connecting a social account (directly or via Vantly) authorizes the Service to publish content to it on your behalf, either on demand or on a schedule you create. You can disconnect an account at any time from the integrations page; disconnecting stops future publishing but does not retract content already posted. The Service is not responsible for the availability, terms, or policies of third-party platforms it publishes to.</p>
<h2>5. Acceptable use</h2>
<p>Don&rsquo;t use the Service to violate applicable law, infringe someone else&rsquo;s rights, distribute malware, attempt to disrupt or gain unauthorized access to the Service or its infrastructure, or resell access without the operator&rsquo;s agreement.</p>
<h2>6. Billing</h2>
<p>Where billing is enabled on this instance, purchases of credits or subscriptions are handled as described at the point of purchase. Where billing is disabled (the default for self-hosted instances), you use your own provider API keys and there is no credit ledger or payment processed by the Service itself.</p>
<h2>7. Disclaimers &amp; limitation of liability</h2>
<p>The Service is provided &ldquo;as is&rdquo; without warranties of any kind, to the extent permitted by law. To the fullest extent permitted by applicable law, the operator will not be liable for indirect, incidental, or consequential damages arising from your use of the Service, including from AI-generated content published to your accounts.</p>
<h2>8. Changes</h2>
<p>The operator may update these Terms from time to time. Continued use of the Service after an update constitutes acceptance of the revised Terms.</p>
<h2>9. Contact</h2>
<p>Questions about these Terms can be sent to <strong>{{support_contact}}</strong>.</p>
`.trim();
