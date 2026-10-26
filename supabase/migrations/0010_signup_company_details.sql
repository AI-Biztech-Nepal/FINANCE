-- Sign-up asks for the company name and address with the person's name (app/(auth)/register.tsx), sent as
-- user metadata: the new profile takes all three. Safe to run more than once.
begin;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, business_name, business_address)
  values (
    new.id,
    new.raw_user_meta_data ->> 'full_name',
    nullif(btrim(new.raw_user_meta_data ->> 'business_name'), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'business_address'), '')
  )
  on conflict (id) do nothing;
  return new;
end $$;

commit;
