-- Every EMI on the vehicle account runs on what is still unpaid, for vendors and customers alike, not on the full price.
-- sale_price stays the price; down_payment becomes what was already paid, so the EMI amount (price less down payment) is
-- the balance, and the installment is worked out again on it at the plan's own rate and tenure (reducing balance).
-- ledger_paid is the part of that which named the vehicle, so those same payments do not count again against the
-- installments; a payment naming no vehicle counts when the party has only the one vehicle (as the ledger reads it).
-- not_placed: money from a party with several vehicles that names none of them, so it is on no plan. Safe to run again.
alter table public.emi_plans add column if not exists ledger_paid numeric not null default 0 check (ledger_paid >= 0);

with deeva as (
  select id from public.profiles
   where coalesce(nullif(btrim(business_name), ''), full_name) ~* '\ydee?va\s+auto\y'
), entries as (
  select 'sale'::text as dir, c.owner_id, c.customer_id as party, c.amount,
         lower(regexp_replace(btrim(split_part(coalesce(c.note, ''), ' · ', 1)), '\s+', ' ', 'g')) as car_key
    from public.customer_ledger_entries c
   where c.entry_type = 'credit' and c.owner_id in (select id from deeva) and coalesce(c.note, '') not ilike 'Journal voucher%'
  union all
  select 'purchase', v.owner_id, v.vendor_id, v.amount,
         lower(regexp_replace(btrim(split_part(coalesce(v.note, ''), ' · ', 1)), '\s+', ' ', 'g'))
    from public.vendor_ledger_entries v
   where v.entry_type = 'credit' and v.owner_id in (select id from deeva) and coalesce(v.note, '') not ilike 'Journal voucher%'
), party_vehicles as (
  select distinct t.owner_id, t.customer_id as party, t.type::text as dir,
         lower(regexp_replace(btrim(i ->> 'description'), '\s+', ' ', 'g')) as car_key
    from public.business_transactions t
   cross join lateral jsonb_array_elements(t.items) i
   where t.owner_id in (select id from deeva) and t.type::text in ('sale', 'purchase')
     and jsonb_typeof(t.items) = 'array' and btrim(coalesce(i ->> 'description', '')) <> ''
), plans as (
  select e.id, e.owner_id, e.customer_id, e.customer_name, e.car, e.sale_price, e.months,
         coalesce(e.direction, 'sale') as dir,
         lower(regexp_replace(btrim(e.car), '\s+', ' ', 'g')) as car_key,
         coalesce(e.interest_rate, 0)::numeric / 12 / 100 as r
    from public.emi_plans e
   where e.owner_id in (select id from deeva)
), figures as (
  select p.*,
         coalesce((select sum(x.amount) from entries x
                    where x.owner_id = p.owner_id and x.dir = p.dir and x.car_key = p.car_key
                      and (p.dir = 'purchase' or x.party = p.customer_id)), 0) as named,
         coalesce((select sum(x.amount) from entries x
                    where x.owner_id = p.owner_id and x.dir = p.dir and x.party = p.customer_id
                      and not exists (select 1 from party_vehicles v
                                       where v.owner_id = x.owner_id and v.party = x.party and v.dir = x.dir and v.car_key = x.car_key)
                      and not exists (select 1 from plans o
                                       where o.owner_id = x.owner_id and o.dir = x.dir and o.car_key = x.car_key)), 0) as unnamed,
         (select count(*) from party_vehicles v
           where v.owner_id = p.owner_id and v.party = p.customer_id and v.dir = p.dir) as vehicles
    from plans p
), balances as (
  select f.*,
         least(f.sale_price, f.named + case when f.vehicles <= 1 then f.unnamed else 0 end) as paid
    from figures f
), updated as (
  update public.emi_plans e
     set down_payment = b.paid,
         ledger_paid = b.named,
         installment = case
           when b.sale_price - b.paid <= 0 then 0
           when b.r > 0 then round((b.sale_price - b.paid) * b.r * power(1 + b.r, b.months) / (power(1 + b.r, b.months) - 1), 2)
           else round((b.sale_price - b.paid) / b.months, 2)
         end
    from balances b
   where b.id = e.id
  returning e.id, e.installment
)
select b.dir as direction, b.car, b.customer_name as party, b.sale_price as price, b.paid as already_paid,
       b.sale_price - b.paid as emi_amount, u.installment as monthly_emi,
       case when b.vehicles > 1 then b.unnamed else 0 end as not_placed
  from balances b
  join updated u on u.id = b.id
 order by not_placed desc, b.dir, b.car;
