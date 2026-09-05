-- Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

-- Pre-populate the Mailer's Templates list with the same 10 starter
-- templates AutoGPT/TheAgenticAI's own Mailer ships (see that repo's
-- autogpt_platform/frontend/src/app/(platform)/admin/mailer/templates/
-- components/starterTemplates.ts) -- same markup, same light-blue/navy/
-- orange palette, ported to Vantly's simpler substitution engine:
--
--   * AutoGPT's Jinja2 `{{ company_name }}` / `{{ company_website }}` are
--     baked in as literal "Vantly UGC" / "https://vantly-ugc.com" text --
--     Vantly's renderTemplate() (lib/mailer/render-template.ts) only ever
--     does plain `{{key}}` substitution (no expressions/filters), and
--     Vantly is a single-brand product with no need for those as
--     per-send variables.
--   * `{{ name or 'there' }}` / `{{ name or 'We' }}` become the plain
--     `{{name}}` token Vantly's engine supports -- declared in each row's
--     `variables` column so the admin UI prompts for it before
--     preview/send-test/campaign (an unset `{{name}}` is left literally
--     visible rather than silently blanked, by design -- see
--     render-template.ts's doc comment).
--   * `{{ coupon_code }}` (Win-back template only) is kept as a real
--     `{{coupon_code}}` variable -- Vantly's Mailer already supports
--     coupon-integration campaigns (Phase A), so this is a genuine
--     per-send value, not a hardcode.
--   * Square-bracket placeholders ([Invoice #], [Month Year], [SAVE20],
--     etc.) are untouched -- same convention on both sides: manual
--     fill-in text for the admin to edit before sending, not a template
--     variable.
--   * Every `padding`/`margin` shorthand's bare `0` token (e.g.
--     `padding:40px 40px 0 40px`) is normalized to `0px`. Vantly's
--     sanitizeMailerTemplateHtml (lib/content/sanitize-html.ts) validates
--     spacing shorthand with SPACING_PX, which requires EVERY token to
--     carry a `px` unit -- a bare `0` fails the fully-anchored regex and
--     silently drops the WHOLE declaration the next time this template is
--     edited and re-saved through the admin UI. Left as-is, these
--     templates would render fine today and quietly lose most of their
--     padding the first time anyone touches them in the builder.
--   * `box-shadow` (used once per template, on the outer card) is dropped
--     outright -- not in Vantly's STYLE_VALIDATORS allowlist at all, so
--     it would be silently stripped on the same first re-save. Purely
--     cosmetic (a subtle drop shadow); everything else in each template
--     survives sanitization unchanged.
--
-- Idempotent via the WHERE NOT EXISTS guard on each insert, matching this
-- migration file's own convention elsewhere (see e.g.
-- 20260905130000_mailer_full_system.sql) -- safe to apply twice, and an
-- admin who has already renamed/deleted one of these won't get a
-- duplicate back.

INSERT INTO public.email_templates (name, subject, html_content, variables, status)
SELECT
  'Welcome Email',
  $subject$Welcome to Vantly UGC, {{name}}!$subject$,
  $html$<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eaf2fb;margin:0px;padding:0px">
  <tbody>
    <tr>
      <td style="padding:40px 16px">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;margin:0px auto;background-color:#ffffff;border-radius:14px;border:1px solid #dbe7f5">
          <tbody>

            <tr>
              <td style="padding:40px 40px 0px 40px">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0px">
                  <tbody>
                    <tr>
                      <td style="background-color:#fff1e6;border-radius:20px;padding:6px 16px">
                        <span style="color:#c2540a;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Welcome</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 40px 0px 40px">
                <h1 style="margin:0px;color:#1e3a5f;font-size:28px;line-height:1.3;font-weight:bold">Welcome aboard, {{name}}!</h1>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 40px 0px 40px">
                <p style="margin:0px;color:#5b6b7f;font-size:15px;line-height:1.6">
                  We're glad you're here. Your Vantly UGC account is ready to go — here's a
                  quick look at how to get the most out of it in your first few days.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 40px 0px 40px">
                <div style="border-top:1px solid #e6edf5;line-height:1px;font-size:1px">&nbsp;</div>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 40px 0px 40px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0px">
                  <tbody>
                    <tr>
                      <td width="40" valign="top" style="padding:0px 0px 20px 0px">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0px">
                          <tbody><tr><td style="background-color:#2563eb;border-radius:14px;width:28px;height:28px;text-align:center">
                            <span style="color:#ffffff;font-size:13px;font-weight:bold;line-height:28px">1</span>
                          </td></tr></tbody>
                        </table>
                      </td>
                      <td valign="top" style="padding:0px 0px 20px 12px">
                        <p style="margin:0px;color:#1e3a5f;font-size:15px;font-weight:bold">[Set up your profile]</p>
                        <p style="margin:4px 0px 0px 0px;color:#7a8aa0;font-size:14px;line-height:1.5">[One line describing this step.]</p>
                      </td>
                    </tr>
                    <tr>
                      <td width="40" valign="top" style="padding:0px 0px 20px 0px">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0px">
                          <tbody><tr><td style="background-color:#f97316;border-radius:14px;width:28px;height:28px;text-align:center">
                            <span style="color:#ffffff;font-size:13px;font-weight:bold;line-height:28px">2</span>
                          </td></tr></tbody>
                        </table>
                      </td>
                      <td valign="top" style="padding:0px 0px 20px 12px">
                        <p style="margin:0px;color:#1e3a5f;font-size:15px;font-weight:bold">[Explore the dashboard]</p>
                        <p style="margin:4px 0px 0px 0px;color:#7a8aa0;font-size:14px;line-height:1.5">[One line describing this step.]</p>
                      </td>
                    </tr>
                    <tr>
                      <td width="40" valign="top" style="padding:0px">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0px">
                          <tbody><tr><td style="background-color:#64748b;border-radius:14px;width:28px;height:28px;text-align:center">
                            <span style="color:#ffffff;font-size:13px;font-weight:bold;line-height:28px">3</span>
                          </td></tr></tbody>
                        </table>
                      </td>
                      <td valign="top" style="padding:0px 0px 0px 12px">
                        <p style="margin:0px;color:#1e3a5f;font-size:15px;font-weight:bold">[Invite your team]</p>
                        <p style="margin:4px 0px 0px 0px;color:#7a8aa0;font-size:14px;line-height:1.5">[One line describing this step.]</p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:32px 40px 0px 40px;text-align:center">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0px auto">
                  <tbody>
                    <tr>
                      <td style="background-color:#f97316;border-radius:8px;text-align:center">
                        <a href="https://vantly-ugc.com" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none">Get Started</a>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:32px 40px 40px 40px">
                <p style="margin:0px;color:#7a8aa0;font-size:14px;line-height:1.6">
                  Questions? Just reply to this email — a real person will get back to you.
                </p>
                <p style="margin:16px 0px 0px 0px;color:#5b6b7f;font-size:14px;line-height:1.6">
                  — The Vantly UGC Team
                </p>
              </td>
            </tr>

          </tbody>
        </table>
      </td>
    </tr>
  </tbody>
</table>$html$,
  ARRAY['name'],
  'active'
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates WHERE name = 'Welcome Email'
);

INSERT INTO public.email_templates (name, subject, html_content, variables, status)
SELECT
  'Product Announcement',
  $subject$Introducing something new from Vantly UGC$subject$,
  $html$<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eaf2fb;margin:0px;padding:0px">
  <tbody>
    <tr>
      <td style="padding:40px 16px">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;margin:0px auto;background-color:#ffffff;border-radius:14px;border:1px solid #dbe7f5">
          <tbody>

            <tr>
              <td style="padding:40px 40px 0px 40px">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0px">
                  <tbody>
                    <tr>
                      <td style="background-color:#f97316;border-radius:20px;padding:6px 16px">
                        <span style="color:#ffffff;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">New</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 40px 0px 40px">
                <h1 style="margin:0px;color:#1e3a5f;font-size:28px;line-height:1.3;font-weight:bold">Introducing [Feature Name]</h1>
              </td>
            </tr>

            <tr>
              <td style="padding:14px 40px 0px 40px">
                <p style="margin:0px;color:#5b6b7f;font-size:15px;line-height:1.6">
                  [One or two sentences on what this feature does and why it matters — keep it
                  concrete and benefit-led rather than a feature list.]
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 40px 0px 40px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0px">
                  <tbody>
                    <tr>
                      <td width="48%" valign="top" style="background-color:#f2f7fd;border-radius:10px;padding:20px">
                        <p style="margin:0px;color:#2563eb;font-size:13px;font-weight:bold;letter-spacing:0.5px;text-transform:uppercase">[Benefit One]</p>
                        <p style="margin:8px 0px 0px 0px;color:#5b6b7f;font-size:14px;line-height:1.55">[Short supporting sentence.]</p>
                      </td>
                      <td width="4%">&nbsp;</td>
                      <td width="48%" valign="top" style="background-color:#f2f7fd;border-radius:10px;padding:20px">
                        <p style="margin:0px;color:#2563eb;font-size:13px;font-weight:bold;letter-spacing:0.5px;text-transform:uppercase">[Benefit Two]</p>
                        <p style="margin:8px 0px 0px 0px;color:#5b6b7f;font-size:14px;line-height:1.55">[Short supporting sentence.]</p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:32px 40px 0px 40px;text-align:center">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0px auto">
                  <tbody>
                    <tr>
                      <td style="background-color:#f97316;border-radius:8px;text-align:center">
                        <a href="https://vantly-ugc.com" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none">Explore [Feature Name]</a>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 40px 40px 40px">
                <p style="margin:0px;color:#7a8aa0;font-size:14px;line-height:1.6">
                  Hi {{name}} — as always, reply to this email if you have questions or
                  feedback. We read every message.
                </p>
                <p style="margin:16px 0px 0px 0px;color:#5b6b7f;font-size:14px;line-height:1.6">
                  — The Vantly UGC Team
                </p>
              </td>
            </tr>

          </tbody>
        </table>
      </td>
    </tr>
  </tbody>
</table>$html$,
  ARRAY['name'],
  'active'
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates WHERE name = 'Product Announcement'
);

INSERT INTO public.email_templates (name, subject, html_content, variables, status)
SELECT
  'Newsletter',
  $subject$Vantly UGC Newsletter — [Month Year]$subject$,
  $html$<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eaf2fb;margin:0px;padding:0px">
  <tbody>
    <tr>
      <td style="padding:40px 16px">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;margin:0px auto;background-color:#ffffff;border-radius:14px;border:1px solid #dbe7f5">
          <tbody>

            <tr>
              <td style="background-color:#1e3a5f;border-radius:14px 14px 0 0;padding:28px 40px">
                <p style="margin:0px;color:#9fc0e8;font-size:12px;font-weight:bold;letter-spacing:1.5px;text-transform:uppercase">Vantly UGC Update</p>
                <h1 style="margin:6px 0px 0px 0px;color:#ffffff;font-size:24px;line-height:1.3;font-weight:bold">[Month Year] — What's New</h1>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 40px 0px 40px">
                <p style="margin:0px;color:#5b6b7f;font-size:15px;line-height:1.6">
                  Hi {{name}}, here's what happened at Vantly UGC this month.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 40px 0px 40px">
                <p style="margin:0px;color:#f97316;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">[Category]</p>
                <h2 style="margin:6px 0px 0px 0px;color:#1e3a5f;font-size:19px;line-height:1.35;font-weight:bold">[Story headline]</h2>
                <p style="margin:8px 0px 0px 0px;color:#5b6b7f;font-size:14px;line-height:1.6">[Two or three sentences summarizing the story.]</p>
                <p style="margin:10px 0px 0px 0px"><a href="https://vantly-ugc.com" style="color:#2563eb;font-size:14px;font-weight:bold;text-decoration:none">Read more &rarr;</a></p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 40px 0px 40px">
                <div style="border-top:1px solid #e6edf5;line-height:1px;font-size:1px">&nbsp;</div>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 40px 0px 40px">
                <p style="margin:0px;color:#f97316;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">[Category]</p>
                <h2 style="margin:6px 0px 0px 0px;color:#1e3a5f;font-size:19px;line-height:1.35;font-weight:bold">[Story headline]</h2>
                <p style="margin:8px 0px 0px 0px;color:#5b6b7f;font-size:14px;line-height:1.6">[Two or three sentences summarizing the story.]</p>
                <p style="margin:10px 0px 0px 0px"><a href="https://vantly-ugc.com" style="color:#2563eb;font-size:14px;font-weight:bold;text-decoration:none">Read more &rarr;</a></p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 40px 0px 40px">
                <div style="border-top:1px solid #e6edf5;line-height:1px;font-size:1px">&nbsp;</div>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 40px 0px 40px">
                <p style="margin:0px;color:#f97316;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">[Category]</p>
                <h2 style="margin:6px 0px 0px 0px;color:#1e3a5f;font-size:19px;line-height:1.35;font-weight:bold">[Story headline]</h2>
                <p style="margin:8px 0px 0px 0px;color:#5b6b7f;font-size:14px;line-height:1.6">[Two or three sentences summarizing the story.]</p>
                <p style="margin:10px 0px 0px 0px"><a href="https://vantly-ugc.com" style="color:#2563eb;font-size:14px;font-weight:bold;text-decoration:none">Read more &rarr;</a></p>
              </td>
            </tr>

            <tr>
              <td style="padding:32px 40px 0px 40px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0px">
                  <tbody>
                    <tr>
                      <td style="background-color:#f2f7fd;border-radius:10px;padding:18px 20px;text-align:center">
                        <span style="color:#5b6b7f;font-size:14px">Got feedback? Just reply to this email — </span><span style="color:#1e3a5f;font-size:14px;font-weight:bold">we read every one.</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 40px 40px 40px">
                <p style="margin:0px;color:#5b6b7f;font-size:14px;line-height:1.6">
                  — The Vantly UGC Team
                </p>
              </td>
            </tr>

          </tbody>
        </table>
      </td>
    </tr>
  </tbody>
</table>$html$,
  ARRAY['name'],
  'active'
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates WHERE name = 'Newsletter'
);

INSERT INTO public.email_templates (name, subject, html_content, variables, status)
SELECT
  'Password Reset',
  $subject$Reset your Vantly UGC password$subject$,
  $html$<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eaf2fb;margin:0px;padding:0px">
  <tbody>
    <tr>
      <td style="padding:40px 16px">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;margin:0px auto;background-color:#ffffff;border-radius:14px;border:1px solid #dbe7f5">
          <tbody>

            <tr>
              <td style="padding:40px 40px 0px 40px">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0px">
                  <tbody>
                    <tr>
                      <td style="background-color:#f2f7fd;border-radius:20px;padding:6px 16px">
                        <span style="color:#2563eb;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Security</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 40px 0px 40px">
                <h1 style="margin:0px;color:#1e3a5f;font-size:26px;line-height:1.3;font-weight:bold">Reset your password</h1>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 40px 0px 40px">
                <p style="margin:0px;color:#5b6b7f;font-size:15px;line-height:1.6">
                  Hi {{name}}, we received a request to reset the password for your
                  Vantly UGC account. Click the button below to choose a new one. This link
                  expires in [60 minutes].
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 40px 0px 40px;text-align:center">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0px auto">
                  <tbody>
                    <tr>
                      <td style="background-color:#f97316;border-radius:8px;text-align:center">
                        <a href="[reset_url]" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none">Reset Password</a>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 40px 0px 40px">
                <div style="border-top:1px solid #e6edf5;line-height:1px;font-size:1px">&nbsp;</div>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 40px 40px 40px">
                <p style="margin:0px;color:#7a8aa0;font-size:13px;line-height:1.6">
                  Didn't request this? You can safely ignore this email — your password won't change
                  unless you click the button above and set a new one.
                </p>
                <p style="margin:16px 0px 0px 0px;color:#5b6b7f;font-size:14px;line-height:1.6">
                  — The Vantly UGC Team
                </p>
              </td>
            </tr>

          </tbody>
        </table>
      </td>
    </tr>
  </tbody>
</table>$html$,
  ARRAY['name'],
  'active'
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates WHERE name = 'Password Reset'
);

INSERT INTO public.email_templates (name, subject, html_content, variables, status)
SELECT
  'Payment Receipt',
  $subject$Your Vantly UGC receipt — [Invoice #]$subject$,
  $html$<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eaf2fb;margin:0px;padding:0px">
  <tbody>
    <tr>
      <td style="padding:40px 16px">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;margin:0px auto;background-color:#ffffff;border-radius:14px;border:1px solid #dbe7f5">
          <tbody>

            <tr>
              <td style="padding:40px 40px 0px 40px">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0px">
                  <tbody>
                    <tr>
                      <td style="background-color:#f2f7fd;border-radius:20px;padding:6px 16px">
                        <span style="color:#2563eb;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Receipt</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 40px 0px 40px">
                <h1 style="margin:0px;color:#1e3a5f;font-size:26px;line-height:1.3;font-weight:bold">Thanks for your payment, {{name}}</h1>
              </td>
            </tr>

            <tr>
              <td style="padding:14px 40px 0px 40px">
                <p style="margin:0px;color:#5b6b7f;font-size:15px;line-height:1.6">
                  Here's a summary of your recent charge. Keep this email for your records.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:24px 40px 0px 40px">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0px;background-color:#f2f7fd;border-radius:10px">
                  <tbody>
                    <tr>
                      <td style="padding:16px 20px;border-bottom:1px solid #dbe7f5">
                        <span style="color:#7a8aa0;font-size:13px">[Plan/Item]</span>
                      </td>
                      <td style="padding:16px 20px;border-bottom:1px solid #dbe7f5;text-align:right">
                        <span style="color:#1e3a5f;font-size:13px;font-weight:bold">[$Amount]</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding:16px 20px">
                        <span style="color:#1e3a5f;font-size:14px;font-weight:bold">Total charged</span>
                      </td>
                      <td style="padding:16px 20px;text-align:right">
                        <span style="color:#1e3a5f;font-size:14px;font-weight:bold">[$Total]</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 40px 0px 40px">
                <p style="margin:0px;color:#7a8aa0;font-size:13px;line-height:1.6">
                  Invoice # [Invoice #] &middot; Charged to card ending [1234] &middot; [Date]
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 40px 0px 40px;text-align:center">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0px auto">
                  <tbody>
                    <tr>
                      <td style="background-color:#f97316;border-radius:8px;text-align:center">
                        <a href="[invoice_url]" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none">Download Invoice</a>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 40px 40px 40px">
                <p style="margin:0px;color:#7a8aa0;font-size:14px;line-height:1.6">
                  Questions about this charge? Reply to this email and we'll help.
                </p>
              </td>
            </tr>

          </tbody>
        </table>
      </td>
    </tr>
  </tbody>
</table>$html$,
  ARRAY['name'],
  'active'
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates WHERE name = 'Payment Receipt'
);

INSERT INTO public.email_templates (name, subject, html_content, variables, status)
SELECT
  'Payment Failed',
  $subject$Action needed: your Vantly UGC payment didn't go through$subject$,
  $html$<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eaf2fb;margin:0px;padding:0px">
  <tbody>
    <tr>
      <td style="padding:40px 16px">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;margin:0px auto;background-color:#ffffff;border-radius:14px;border:1px solid #dbe7f5">
          <tbody>

            <tr>
              <td style="padding:40px 40px 0px 40px">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0px">
                  <tbody>
                    <tr>
                      <td style="background-color:#fff1e6;border-radius:20px;padding:6px 16px">
                        <span style="color:#c2540a;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Payment Issue</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 40px 0px 40px">
                <h1 style="margin:0px;color:#1e3a5f;font-size:26px;line-height:1.3;font-weight:bold">We couldn't process your payment</h1>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 40px 0px 40px">
                <p style="margin:0px;color:#5b6b7f;font-size:15px;line-height:1.6">
                  Hi {{name}}, your card ending [1234] was declined for your
                  Vantly UGC subscription renewal. Update your payment method to keep your
                  account active without interruption.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 40px 0px 40px;text-align:center">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0px auto">
                  <tbody>
                    <tr>
                      <td style="background-color:#f97316;border-radius:8px;text-align:center">
                        <a href="[billing_url]" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none">Update Payment Method</a>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 40px 40px 40px;text-align:center">
                <p style="margin:0px;color:#a3aebd;font-size:12px;line-height:1.6">
                  We'll try charging your card again in [3 days]. If it fails again your plan may be
                  downgraded — reply to this email if you need help.
                </p>
              </td>
            </tr>

          </tbody>
        </table>
      </td>
    </tr>
  </tbody>
</table>$html$,
  ARRAY['name'],
  'active'
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates WHERE name = 'Payment Failed'
);

INSERT INTO public.email_templates (name, subject, html_content, variables, status)
SELECT
  'Trial Ending Soon',
  $subject$Your Vantly UGC trial ends in [3 days]$subject$,
  $html$<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eaf2fb;margin:0px;padding:0px">
  <tbody>
    <tr>
      <td style="padding:40px 16px">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;margin:0px auto;background-color:#ffffff;border-radius:14px;border:1px solid #dbe7f5">
          <tbody>

            <tr>
              <td style="padding:40px 40px 0px 40px;text-align:center">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0px auto">
                  <tbody>
                    <tr>
                      <td style="background-color:#fff1e6;border-radius:20px;padding:6px 16px">
                        <span style="color:#c2540a;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">3 Days Left</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 40px 0px 40px;text-align:center">
                <h1 style="margin:0px;color:#1e3a5f;font-size:28px;line-height:1.3;font-weight:bold">Your trial is almost up, {{name}}</h1>
              </td>
            </tr>

            <tr>
              <td style="padding:14px 40px 0px 40px;text-align:center">
                <p style="margin:0px;color:#5b6b7f;font-size:15px;line-height:1.6">
                  You've [built 2 agents and run 14 tasks] so far — nice start. Upgrade now to keep
                  everything running without a gap when your trial ends.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 40px 0px 40px;text-align:center">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0px auto">
                  <tbody>
                    <tr>
                      <td style="background-color:#f97316;border-radius:8px;text-align:center">
                        <a href="https://vantly-ugc.com" style="display:inline-block;padding:16px 40px;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none">Upgrade Now</a>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 40px 40px 40px;text-align:center">
                <p style="margin:0px;color:#7a8aa0;font-size:13px;line-height:1.6">
                  Not ready? No problem — you can pick a plan any time from your account settings.
                </p>
              </td>
            </tr>

          </tbody>
        </table>
      </td>
    </tr>
  </tbody>
</table>$html$,
  ARRAY['name'],
  'active'
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates WHERE name = 'Trial Ending Soon'
);

INSERT INTO public.email_templates (name, subject, html_content, variables, status)
SELECT
  'We Miss You (Win-back)',
  $subject${{name}}, come see what's new at Vantly UGC$subject$,
  $html$<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eaf2fb;margin:0px;padding:0px">
  <tbody>
    <tr>
      <td style="padding:40px 16px">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;margin:0px auto;background-color:#ffffff;border-radius:14px;border:1px solid #dbe7f5">
          <tbody>

            <tr>
              <td style="padding:40px 40px 0px 40px">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0px">
                  <tbody>
                    <tr>
                      <td style="background-color:#f2f7fd;border-radius:20px;padding:6px 16px">
                        <span style="color:#2563eb;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">It's been a while</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 40px 0px 40px">
                <h1 style="margin:0px;color:#1e3a5f;font-size:28px;line-height:1.3;font-weight:bold">We miss you, {{name}}</h1>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 40px 0px 40px">
                <p style="margin:0px;color:#5b6b7f;font-size:15px;line-height:1.6">
                  A lot's changed at Vantly UGC since your last visit — [new marketplace
                  agents, a faster builder, more integrations]. Come take a look.
                </p>
              </td>
            </tr>

            {% if coupon_code %}
            <tr>
              <td style="padding:24px 40px 0px 40px;text-align:center">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0px auto">
                  <tbody>
                    <tr>
                      <td style="background-color:#f2f7fd;border:1px dashed #9fc0e8;border-radius:10px;padding:14px 28px;text-align:center">
                        <span style="color:#7a8aa0;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Welcome-back offer</span><br>
                        <span style="color:#1e3a5f;font-size:20px;font-weight:bold;letter-spacing:2px">{{coupon_code}}</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
            {% endif %}

            <tr>
              <td style="padding:28px 40px 0px 40px;text-align:center">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0px auto">
                  <tbody>
                    <tr>
                      <td style="background-color:#f97316;border-radius:8px;text-align:center">
                        <a href="https://vantly-ugc.com" style="display:inline-block;padding:16px 40px;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none">See What's New</a>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 40px 40px 40px;text-align:center">
                <p style="margin:0px;color:#a3aebd;font-size:12px;line-height:1.6">
                  Rather not hear from us? You can unsubscribe any time from the link below.
                </p>
              </td>
            </tr>

          </tbody>
        </table>
      </td>
    </tr>
  </tbody>
</table>$html$,
  ARRAY['name', 'coupon_code'],
  'active'
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates WHERE name = 'We Miss You (Win-back)'
);

INSERT INTO public.email_templates (name, subject, html_content, variables, status)
SELECT
  'Low Credit Balance',
  $subject$Your Vantly UGC credit balance is running low$subject$,
  $html$<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eaf2fb;margin:0px;padding:0px">
  <tbody>
    <tr>
      <td style="padding:40px 16px">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;margin:0px auto;background-color:#ffffff;border-radius:14px;border:1px solid #dbe7f5">
          <tbody>

            <tr>
              <td style="padding:40px 40px 0px 40px">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0px">
                  <tbody>
                    <tr>
                      <td style="background-color:#fff1e6;border-radius:20px;padding:6px 16px">
                        <span style="color:#c2540a;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Low Balance</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 40px 0px 40px">
                <h1 style="margin:0px;color:#1e3a5f;font-size:26px;line-height:1.3;font-weight:bold">You're running low on credits</h1>
              </td>
            </tr>

            <tr>
              <td style="padding:16px 40px 0px 40px">
                <p style="margin:0px;color:#5b6b7f;font-size:15px;line-height:1.6">
                  Hi {{name}}, your Vantly UGC balance is down to
                  [<strong>120 credits</strong>]. At your current usage that's about [2 days] of
                  runs — top up now so your agents don't pause mid-task.
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 40px 0px 40px;text-align:center">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0px auto">
                  <tbody>
                    <tr>
                      <td style="background-color:#f97316;border-radius:8px;text-align:center">
                        <a href="https://vantly-ugc.com" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none">Add Credits</a>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 40px 40px 40px;text-align:center">
                <p style="margin:0px;color:#a3aebd;font-size:12px;line-height:1.6">
                  Tip: turn on auto-refill in Settings &rarr; Billing to never see this email again.
                </p>
              </td>
            </tr>

          </tbody>
        </table>
      </td>
    </tr>
  </tbody>
</table>$html$,
  ARRAY['name'],
  'active'
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates WHERE name = 'Low Credit Balance'
);

INSERT INTO public.email_templates (name, subject, html_content, variables, status)
SELECT
  'Promotional Offer',
  $subject$A limited-time offer just for you, {{name}}$subject$,
  $html$<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eaf2fb;margin:0px;padding:0px">
  <tbody>
    <tr>
      <td style="padding:40px 16px">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;margin:0px auto;background-color:#ffffff;border-radius:14px;border:1px solid #dbe7f5">
          <tbody>

            <tr>
              <td style="padding:40px 40px 0px 40px;text-align:center">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0px auto">
                  <tbody>
                    <tr>
                      <td style="background-color:#fff1e6;border-radius:20px;padding:6px 16px">
                        <span style="color:#c2540a;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Limited Time</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:20px 40px 0px 40px;text-align:center">
                <h1 style="margin:0px;color:#1e3a5f;font-size:32px;line-height:1.25;font-weight:bold">[Save 20%] on [Product/Plan]</h1>
              </td>
            </tr>

            <tr>
              <td style="padding:14px 40px 0px 40px;text-align:center">
                <p style="margin:0px;color:#5b6b7f;font-size:15px;line-height:1.6">
                  Hi {{name}} — [one sentence on the offer and why it's worth acting on
                  now]. Offer ends [date].
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 40px 0px 40px;text-align:center">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0px auto">
                  <tbody>
                    <tr>
                      <td style="background-color:#f2f7fd;border:1px dashed #9fc0e8;border-radius:10px;padding:14px 28px;text-align:center">
                        <span style="color:#7a8aa0;font-size:11px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Your code</span><br>
                        <span style="color:#1e3a5f;font-size:20px;font-weight:bold;letter-spacing:2px">[SAVE20]</span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 40px 0px 40px;text-align:center">
                <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0px auto">
                  <tbody>
                    <tr>
                      <td style="background-color:#f97316;border-radius:8px;text-align:center">
                        <a href="https://vantly-ugc.com" style="display:inline-block;padding:16px 40px;color:#ffffff;font-size:16px;font-weight:bold;text-decoration:none">Claim Your Offer</a>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding:28px 40px 40px 40px;text-align:center">
                <p style="margin:0px;color:#a3aebd;font-size:12px;line-height:1.6">
                  [Terms: one-time use per customer, cannot be combined with other offers, expires
                  [date] at 11:59pm.]
                </p>
              </td>
            </tr>

          </tbody>
        </table>
      </td>
    </tr>
  </tbody>
</table>$html$,
  ARRAY['name'],
  'active'
WHERE NOT EXISTS (
  SELECT 1 FROM public.email_templates WHERE name = 'Promotional Offer'
);

