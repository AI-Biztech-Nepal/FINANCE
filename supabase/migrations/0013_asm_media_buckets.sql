-- Auto Stock Manager's vehicle photos and legal documents, moved out of its MySQL database on the VPS (see
-- Auto-Stock-Manager/backend/media_storage.py). Its backend writes here with the service role key; nothing in
-- the Finance app reads these buckets. Safe to run more than once.
--   asm-photos     public: the storefront and the app load photos straight from the CDN
--   asm-documents  private: bluebook / insurance / tax scans, reached only through short-lived signed links
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('asm-photos', 'asm-photos', true, 26214400,
   array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']),
  ('asm-documents', 'asm-documents', false, 26214400,
   array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

commit;
