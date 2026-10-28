-- Rent: one person per rental. The one it is rented to (the driver who takes the vehicle) owes its Rate per day for
-- every day it is out - a Receivable on their own ledger, labelled Daily rent - and pays it on the Received page.
-- The separate Employee / Daily amount of 0015-0018 asked for the same thing twice; their values are cleared and the
-- lines written again from Rented to and Rate per day. Run on its own (no transaction around it). Safe to run again.

create or replace function public.rental_wage_rows(p_owner uuid)
returns table (owner_id uuid, employee_id uuid, day date, amount numeric, note text, source_id uuid)
language sql stable security definer set search_path = public as $$
  select r.owner_id, r.customer_id, d::date, r.rate_per_day,
         'Daily rent · ' || r.car,
         md5('rental_wage:' || r.id::text || ':' || d::date::text)::uuid
    from public.rentals r
   cross join lateral generate_series(
           r.start_date,
           least(coalesce(r.returned_on, (now() at time zone 'Asia/Kathmandu')::date), (now() at time zone 'Asia/Kathmandu')::date),
           interval '1 day') d
   where r.customer_id is not null and r.rate_per_day > 0
     and (p_owner is null or r.owner_id = p_owner)
$$;

-- The old second person and amount are no longer used.
update public.rentals set employee_id = null, employee_name = null, wage_per_day = 0
 where employee_id is not null or wage_per_day <> 0;

select public.sync_rental_wages_for(null::uuid);

select r.car, r.customer_name as rented_to, r.rate_per_day,
       (select count(*) from customer_ledger_entries c
         where c.source_type = 'rental_wage' and c.customer_id = r.customer_id) as daily_lines
  from rentals r order by r.car;
