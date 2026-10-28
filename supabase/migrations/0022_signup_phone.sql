-- Sign-up now also asks for a phone number (app/(auth)/register.tsx), and the company name is optional. The phone goes
-- on the new profile twice: as the person's own phone and as the phone printed on the letterhead. A sign-up with no
-- company name leaves business_name empty (the app then uses the person's name). Safe to run more than once.
begin;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, phone, business_name, business_address, business_phone)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    nullif(btrim(new.raw_user_meta_data ->> 'business_phone'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'business_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'business_address'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'business_phone'), '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

commit;
