// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Per-send HTML post-processing: link-click rewriting, an open-tracking
 * pixel, and a mandatory unsubscribe footer -- applied to every campaign
 * (and automated-trigger) email right before it's handed to a provider,
 * AFTER {{variable}} substitution. This is intentionally NOT part of the
 * sanitizer or the template builder -- it's generated fresh per send,
 * using a token unique to that (campaign, recipient) pair (email_logs.
 * tracking_token), so it can never be pasted into a template by an admin
 * and accidentally reused across recipients.
 */

import { createHmac, timingSafeEqual } from 'crypto';

function appBaseUrl(): string {
  const configured = process.env.APP_PUBLIC_URL?.trim().replace(/\/+$/, '');
  if (configured) return configured;
  const port = process.env.WEB_PORT?.trim() || '3005';
  return `http://localhost:${port}`;
}

// HMAC key for one-click unsubscribe links -- deliberately reuses
// SUPABASE_SERVICE_ROLE_KEY rather than requiring a brand-new env var
// every self-hoster has to remember to set: it's already a mandatory,
// server-only secret for this app to function at all (every admin route
// already depends on it), so this adds no new required configuration.
// The HMAC output never reveals anything about the key itself.
function unsubscribeSecret(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || 'vantly-ugc-mailer-unsubscribe-fallback';
}

export function signUnsubscribe(email: string): string {
  return createHmac('sha256', unsubscribeSecret()).update(email.toLowerCase().trim()).digest('hex');
}

export function verifyUnsubscribeSignature(email: string, signature: string): boolean {
  const expected = signUnsubscribe(email);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(signature, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function buildUnsubscribeUrl(email: string): string {
  const sig = signUnsubscribe(email);
  return `${appBaseUrl()}/api/mailer/unsubscribe?email=${encodeURIComponent(email)}&sig=${sig}`;
}

/** Rewrites every http(s) href in `html` to a click-tracking redirect that records the click, then 302s to the original URL. */
export function rewriteLinksForTracking(html: string, trackingToken: string): string {
  const base = appBaseUrl();
  return html.replace(/href="(https?:\/\/[^"]+)"/gi, (_match, url: string) => {
    const redirect = `${base}/api/mailer/track/click?t=${encodeURIComponent(trackingToken)}&u=${encodeURIComponent(url)}`;
    return `href="${redirect}"`;
  });
}

/** Appends a 1x1 open-tracking pixel just before </body>, or at the end if there's no </body>. */
export function appendTrackingPixel(html: string, trackingToken: string): string {
  const base = appBaseUrl();
  const pixel = `<img src="${base}/api/mailer/track/open?t=${encodeURIComponent(trackingToken)}" width="1" height="1" alt="" style="display:none;border:0;width:1px;height:1px;" />`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${pixel}</body>`) : `${html}${pixel}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Prepends a centered logo header just after <body> (or at the very start
 * if there's no <body> tag) when Settings -> Mailer has a logo_url
 * configured. A no-op otherwise -- this is cosmetic branding, not
 * something a template should have to opt into.
 */
export function prependBrandingHeader(html: string, logoUrl: string | null): string {
  if (!logoUrl) return html;
  const header =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">` +
    `<tbody><tr><td style="text-align:center;padding:0 0 16px 0;">` +
    `<img src="${escapeHtml(logoUrl)}" alt="" height="40" style="height:40px;width:auto;border:0;" />` +
    `</td></tr></tbody></table>`;
  return /<body[^>]*>/i.test(html) ? html.replace(/(<body[^>]*>)/i, `$1${header}`) : `${header}${html}`;
}

/**
 * Appends the mandatory, table-based (email-client-safe) unsubscribe
 * footer -- every campaign send gets one, regardless of what the template
 * itself contains -- plus, when Settings -> Mailer has footer_text
 * configured, an extra branded line above the unsubscribe link. The
 * unsubscribe link itself is never optional or replaceable by
 * footerText -- see MAILER audit's suppression/compliance requirement.
 */
export function appendUnsubscribeFooter(html: string, recipientEmail: string, footerText?: string | null): string {
  const unsubUrl = buildUnsubscribeUrl(recipientEmail);
  const brandedLine = footerText
    ? `<tr><td style="text-align:center;padding:0 0 8px 0;color:#9ca3af;font-size:12px;">${escapeHtml(footerText)}</td></tr>`
    : '';
  const footer =
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0 0;">` +
    `<tbody>${brandedLine}<tr><td style="text-align:center;padding:16px 0 0 0;border-top:1px solid #e5e7eb;">` +
    `<a href="${unsubUrl}" style="color:#6b7280;font-size:12px;text-decoration:underline;">Unsubscribe</a>` +
    `</td></tr></tbody></table>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${footer}</body>`) : `${html}${footer}`;
}

/**
 * Applies all post-processing steps in the right order: rewrite links
 * first (so the pixel/footer/header we're about to add aren't themselves
 * rewritten), then pixel, then the mandatory+branded footer, then the
 * branding header (added last so it isn't affected by the </body>-based
 * regexes above, which only ever touch the tail of the document).
 */
export function finalizeOutboundHtml(
  html: string,
  trackingToken: string,
  recipientEmail: string,
  branding?: { logoUrl?: string | null; footerText?: string | null },
): string {
  const withLinks = rewriteLinksForTracking(html, trackingToken);
  const withPixel = appendTrackingPixel(withLinks, trackingToken);
  const withFooter = appendUnsubscribeFooter(withPixel, recipientEmail, branding?.footerText);
  return prependBrandingHeader(withFooter, branding?.logoUrl ?? null);
}
