-- Rent: an employee can go out with a rented vehicle (a driver), on a daily wage. Every day the vehicle is out
-- puts that day's wage on the employee's ledger as money owed to them - from the day it was rented to the day it
-- came back (or today, while it is still out), the same days the rent itself counts. Paying the employee on the
-- Paid page settles it, like any other payment to them.
--
-- The wage lines are kept in step by the database, never typed: one per rental per day (source_type
-- 'rental_wage'), written again whenever a rental is added, changed or removed, and once a night for the new day
-- (pg_cron; the app also asks for it when the Rent page or a ledger opens, so a missed night catches up).
-- Like a bill's own ledger line they are read-only on the ledger: change the rental instead.
-- Safe to run more than once.
begin;

alter table public.rentals
  add column if not exists employee_id   uuid references public.customers(id) on delete set null,
  add column if not exists employee_name text,
  add column if not exists wage_per_day  numeric not null default 0 check (wage_per_day >= 0);

-- Every wage line there should be: one per rental with an employee and a wage, per day it has been out.
create or replace function public.rental_wage_rows(p_owner uuid)
returns table (owner_id uuid, employee_id uuid, day date, amount numeric, note text, source_id uuid)
language sql stable security definer set search_path = public as $$
  select r.owner_id, r.employee_id, d::date, r.wage_per_day,
         'Daily wage · ' || r.car || coalesce(' · ' || nullif(btrim(r.customer_name), ''), ''),
         md5('rental_wage:' || r.id::text || ':' || d::date::text)::uuid
    from public.rentals r
   cross join lateral generate_series(
           r.start_date,
           least(coalesce(r.returned_on, (now() at time zone 'Asia/Kathmandu')::date), (now() at time zone 'Asia/Kathmandu')::date),
           interval '1 day') d
   where r.employee_id is not null and r.wage_per_day > 0
     and (p_owner is null or r.owner_id = p_owner)
$$;

-- Makes the ledger match: removes lines no longer due (a rental removed, returned earlier, its employee changed),
-- corrects changed ones, adds missing days. p_owner null = every account (the nightly run).
create or replace function public.sync_rental_wages_for(p_owner uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from public.vendor_ledger_entries v
   where v.source_type = 'rental_wage'
     and (p_owner is null or v.owner_id = p_owner)
     and (v.source_id, v.vendor_id) not in (select w.source_id, w.employee_id from public.rental_wage_rows(p_owner) w);

  insert into public.vendor_ledger_entries (vendor_id, owner_id, entry_type, amount, note, source, source_type, source_id, entry_date)
  select w.employee_id, w.owner_id, 'debit', w.amount, w.note, 'booking', 'rental_wage', w.source_id, w.day
    from public.rental_wage_rows(p_owner) w
  on conflict (source_type, source_id) where source_type is not null and source_id is not null
  do update set amount = excluded.amount, vendor_id = excluded.vendor_id, note = excluded.note, entry_date = excluded.entry_date;
end $$;
revoke execute on function public.sync_rental_wages_for(uuid) from public, anon, authenticated;
revoke execute on function public.rental_wage_rows(uuid) from public, anon, authenticated;

-- What the app calls (supabase.rpc('sync_rental_wages')): the signed-in account's own wages only.
create or replace function public.sync_rental_wages()
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  perform public.sync_rental_wages_for(auth.uid());
end $$;
grant execute on function public.sync_rental_wages() to authenticated;

-- A rental added, changed or removed puts its account's wage lines right at once.
create or replace function public.rentals_sync_wages()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.sync_rental_wages_for(coalesce(new.owner_id, old.owner_id));
  return null;
end $$;
drop trigger if exists rentals_sync_wages on public.rentals;
create trigger rentals_sync_wages after insert or update or delete on public.rentals
  for each row execute function public.rentals_sync_wages();

commit;

-- The new day's wage, every night just after midnight in Nepal (18:20 UTC). Needs the pg_cron extension
-- (Supabase: Database -> Extensions -> pg_cron); without it the app's catch-up call above does the job.
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('rental-wages', '20 18 * * *', 'select public.sync_rental_wages_for(null)');
exception when others then
  raise notice 'pg_cron not available (%): wages are caught up when the app opens the Rent page or a ledger', sqlerrm;
end $$;

-- Wages for rentals already out, from their first day.
select public.sync_rental_wages_for(null);

notify pgrst, 'reload schema';
