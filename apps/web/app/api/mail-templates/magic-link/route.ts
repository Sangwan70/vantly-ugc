// Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

/**
 * Custom GoTrue mailer template for magic-link / email-OTP sign-in.
 *
 * Why this exists: GoTrue's built-in default "magic link" template only
 * embeds {{ .ConfirmationURL }} (a clickable link) — it never surfaces
 * {{ .Token }}, the plain 6-digit code. But the login modal
 * (components/login-modal.tsx) calls supabase.auth.verifyOtp() and shows
 * the user a "enter your code" popup, so with the stock template there was
 * never anything to type in: the email only had a link. Confirmed live —
 * clicking the link DOES work (GoTrue verifies it server-side and
 * redirects), but the code box was dead UI with no way to fill it in.
 *
 * This template shows BOTH, so either path works:
 *  - click the button (fastest, one tap)
 *  - or copy the 6-digit code into the popup (works even if a corporate
 *    email/security scanner has already auto-clicked and burned the link -
 *    a real failure mode for magic links, since scanners "visit" every URL
    in an email before a human ever sees it)
 *
 * GoTrue fetches this URL itself (server-to-server) every time it sends a
 * magic-link/OTP email — see GOTRUE_MAILER_TEMPLATES_MAGIC_LINK in
 * docker-compose.yml, pointed at the internal docker network address
 * (http://web:3000/...) rather than the public domain, so it doesn't
 * depend on the public gateway/reverse-proxy chain at all. Route is
 * intentionally outside every gate in middleware.ts (doesn't match
 * SUBSCRIPTION_PREFIXES or AUTH_NO_SUB_ROUTES), so it's always reachable
 * with no auth.
 *
 * Template syntax ({{ .Token }}, {{ .ConfirmationURL }}, ...) is Go's
 * text/template, evaluated by GoTrue itself after fetching this - it is
 * NOT touched by Next.js/React, so it's written as a plain string here.
 */

const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#111;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;">
      <h2 style="margin:0 0 16px;font-size:20px;">Sign in to Vantly UGC</h2>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:#444;">
        Click the button below to finish signing in.
      </p>
      <p style="text-align:center;margin:0 0 28px;">
        <a href="{{ .ConfirmationURL }}"
           style="background:#111827;color:#ffffff;padding:12px 28px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600;display:inline-block;">
          Sign in to Vantly UGC
        </a>
      </p>
      <p style="margin:0 0 8px;font-size:13px;color:#666;">
        Or, if you were asked for a code, enter this instead:
      </p>
      <p style="text-align:center;margin:0 0 24px;font-size:28px;font-weight:700;letter-spacing:6px;color:#111827;">
        {{ .Token }}
      </p>
      <p style="margin:0;font-size:12px;color:#999;line-height:1.5;">
        This link and code expire shortly and can only be used once. If you
        didn't request this, you can safely ignore this email.
      </p>
    </div>
  </body>
</html>`;

export async function GET() {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // GoTrue should always fetch fresh — never let an intermediary cache
      // a stale copy of this template.
      'Cache-Control': 'no-store',
    },
  });
}
