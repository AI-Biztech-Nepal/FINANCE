-- Accounts made before 0010_signup_company_details.sql ran kept the company name and address typed at sign-up
-- only on the login (auth.users metadata), and a logo uploaded while Save was held back by the required fields
-- was never put on the profile. This fills both in where the profile has none. Safe to run more than once.
begin;

update public.profiles p
   set business_name = nullif(btrim(u.raw_user_meta_data ->> 'business_name'), '')
  from auth.users u
 where u.id = p.id
   and coalesce(btrim(p.business_name), '') = ''
   and coalesce(btrim(u.raw_user_meta_data ->> 'business_name'), '') <> '';

update public.profiles p
   set business_address = nullif(btrim(u.raw_user_meta_data ->> 'business_address'), '')
  from auth.users u
 where u.id = p.id
   and coalesce(btrim(p.business_address), '') = ''
   and coalesce(btrim(u.raw_user_meta_data ->> 'business_address'), '') <> '';

-- The newest logo in the account's own folder.
update public.profiles p
   set business_logo_path = latest.name
  from (
    select distinct on ((storage.foldername(name))[1]) (storage.foldername(name))[1] as owner, name
      from storage.objects
     where bucket_id = 'business-assets'
     order by (storage.foldername(name))[1], created_at desc
  ) latest
 where latest.owner = p.id::text
   and p.business_logo_path is null;

commit;
