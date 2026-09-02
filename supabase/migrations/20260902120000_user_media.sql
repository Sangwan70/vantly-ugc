-- Copyright 2026 Vantly UGC contributors. Apache-2.0 license.

-- My Media: a personal library of images/video/audio a user uploads once
-- and then refers to by a short, memorable "short code" (e.g. brand-logo-x7)
-- from anywhere a script/prompt text field takes free text — the code is a
-- copy-paste reference for the user, not something the server parses out of
-- scripts (that would require touching every skill's dispatch path; kept
-- out of scope here by design). Mirrors the shape of user_characters.

-- ── Storage bucket ──────────────────────────────────────────────────────
-- Public (like generation-outputs): short codes are meant to be pasted as
-- the actual https URL into a script/broll_url/image field elsewhere in
-- the product, which requires a publicly fetchable URL — a private,
-- signed-URL bucket (like generation-inputs) would expire and break that.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'user-media',
  'user-media',
  true,
  52428800, -- 40 MiB decoded upload allowance (base64 requests run ~1.33x this)
  ARRAY[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime',
    'audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/ogg'
  ]
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "user_media_insert_own"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'user-media' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "user_media_select_own"
    ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'user-media' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "user_media_delete_own"
    ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'user-media' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Public read of the objects themselves (bucket is public) is handled by
-- Storage's own public-bucket serving, not an RLS SELECT policy — the
-- policy above only governs authenticated API access (listing/reading
-- metadata via the client library), matching generation-outputs' pattern.

-- ── Table ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_media (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
  name         text NOT NULL,
  short_code   text NOT NULL CHECK (short_code ~ '^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$'),
  storage_path text NOT NULL,
  url          text NOT NULL,
  mime_type    text,
  size_bytes   bigint,
  category     text CHECK (category IN ('branding', 'script', 'audio_sample', 'image', 'video', 'other')),
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, short_code)
);

CREATE INDEX IF NOT EXISTS user_media_user_id_created_at_idx
  ON public.user_media (user_id, created_at DESC);

CREATE TRIGGER trg_user_media_updated
  BEFORE UPDATE ON public.user_media
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.user_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_media_owner_select ON public.user_media
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY user_media_owner_insert ON public.user_media
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_media_owner_update ON public.user_media
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY user_media_owner_delete ON public.user_media
  FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY user_media_service_all ON public.user_media
  FOR ALL TO service_role USING (true) WITH CHECK (true);
