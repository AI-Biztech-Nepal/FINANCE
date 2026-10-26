-- The company logo (Company Details, shown on the Dashboard): a public bucket, one folder per account, the
-- same shape as Jageer's business-assets bucket. Safe to run more than once.
begin;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-assets', 'business-assets', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists business_assets_insert_own on storage.objects;
create policy business_assets_insert_own on storage.objects
  for insert with check (
    bucket_id = 'business-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists business_assets_select_public on storage.objects;
create policy business_assets_select_public on storage.objects
  for select using (bucket_id = 'business-assets');

drop policy if exists business_assets_delete_own on storage.objects;
create policy business_assets_delete_own on storage.objects
  for delete using (
    bucket_id = 'business-assets'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;
