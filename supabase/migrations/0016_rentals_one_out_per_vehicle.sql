-- Rent: a vehicle is out with one renter at a time. A vehicle still out (no returned_on) cannot be rented
-- again until that rental is given its Returned on date. The Rent form says so first; this is the database's
-- own guard behind it.
--
-- Before the guard, what is already there is put right:
--   1. the same rental entered twice (same vehicle, day, renter and rate) keeps one - the one with an employee
--      or payments on it, else the first entered;
--   2. a vehicle with two different rentals both still open (rented again before Returned on existed) - the
--      earlier one is closed on the day the next one began. Nothing is deleted there.
-- Removing or closing a rental also puts its employee's wage lines right (0015). Safe to run more than once.
begin;

-- 1. Exact duplicates.
with ranked as (
  select id, row_number() over (
           partition by owner_id, lower(regexp_replace(btrim(car), '\s+', ' ', 'g')), start_date,
                        coalesce(customer_id::text, lower(btrim(customer_name)), ''), rate_per_day
           order by (employee_id is not null) desc, jsonb_array_length(payments) desc, created_at) as n
    from public.rentals
)
delete from public.rentals where id in (select id from ranked where n > 1);

-- 2. Two open rentals of one vehicle: the earlier comes back the day the next one went out.
with open_ones as (
  select id, start_date,
         lead(start_date) over (partition by owner_id, lower(regexp_replace(btrim(car), '\s+', ' ', 'g'))
                                order by start_date, created_at) as next_start
    from public.rentals
   where returned_on is null
)
update public.rentals r
   set returned_on = o.next_start
  from open_ones o
 where r.id = o.id and o.next_start is not null;

-- The guard.
create unique index if not exists rentals_one_out_per_car
  on public.rentals (owner_id, lower(regexp_replace(btrim(car), '\s+', ' ', 'g')))
  where returned_on is null;

commit;
