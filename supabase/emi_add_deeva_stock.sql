-- Deeva Auto Enterprises: put EVERY vehicle into EMI, both ways (none is paid up).
--
-- One paste into the Supabase SQL editor, run once. It does these in one transaction:
--   1) the schema of migration 0021_emi_direction_interest.sql (direction, interest_rate, product_id on emi_plans -
--      additive, safe to run when it already ran), then
--   2) WE PAY THE VENDOR: a purchase plan for every vehicle in Stock and Inventory - in stock or since sold. The same
--      rules as the "Add N to EMI" button on Rent & EMI > EMI > We pay vendors:
--        price        what the vehicle's Purchase bills come to (else its cost price) - read the way Stock and
--                     Inventory read a car's bill: the whole bill, VAT and discount included, when the car is the
--                     only one on it, else the car's own line. A vehicle with no price anywhere is left out
--        vendor/model from the vehicle's latest Purchase bill
--        first due    a month after that bill (a month from today when there is no bill)
--   3) THE CUSTOMER PAYS US: a sale plan for every vehicle that is already out (it is on a Sale bill). The same rules
--      as the button on Rent & EMI > EMI > Customers pay us:
--        price        what the vehicle's Sale bills come to
--        customer     from the vehicle's latest Sale bill; the model from its Purchase bill
--        first due    a month after that sale
--   Both: 12 monthly instalments, no down payment, 10% interest a year on what is still unpaid (reducing balance, the
--   way banks work it out) - instalment = price x r x (1 + r)^12 / ((1 + r)^12 - 1) with r = 10% / 12, so the total
--   is about 1.055 x the price. What has already been paid is not taken off here: the EMI page reads it from the
--   Paid entries (vendor side) and the Received entries (customer side) that name the vehicle, so Remaining shows
--   what is left. A vehicle that already has a plan on a side is skipped there, so running this again adds nothing
--   twice.
--
-- It only touches the account whose business name reads "Deeva Auto..." / "Deva Auto..." and stops if that is not
-- exactly one profile. The plans it made are listed at the end. Remove one in the app (EMI > open it > Remove).
begin;

alter table public.emi_plans add column if not exists direction text not null default 'sale';
alter table public.emi_plans drop constraint if exists emi_plans_direction_check;
alter table public.emi_plans add constraint emi_plans_direction_check check (direction in ('sale', 'purchase'));
alter table public.emi_plans add column if not exists interest_rate numeric not null default 0 check (interest_rate >= 0);
alter table public.emi_plans add column if not exists product_id uuid references public.products(id) on delete set null;
create index if not exists emi_plans_product_idx on public.emi_plans (product_id);

do $$
declare
  v_owner      uuid;
  v_count      integer;
  v_bought     integer;
  v_sold       integer;
  v_left       integer;
  v_left_names text;
  v_months constant integer := 12;
  v_rate   constant numeric := 10;
begin
  select count(*) into v_count
  from public.profiles
  where business_name ~* 'dee?va[[:space:]]+auto' or full_name ~* 'dee?va[[:space:]]+auto';
  if v_count <> 1 then
    raise exception 'Expected exactly one Deeva Auto profile, found %. Nothing was added.', v_count;
  end if;
  select id into v_owner
  from public.profiles
  where business_name ~* 'dee?va[[:space:]]+auto' or full_name ~* 'dee?va[[:space:]]+auto';

  -- every line of every Purchase and Sale bill, by item name ...
  create temporary table _emi_lines on commit drop as
  select t.type::text as kind,
         lower(regexp_replace(btrim(li.item ->> 'description'), '\s+', ' ', 'g')) as k,
         nullif(btrim(li.item ->> 'model'), '') as model,
         case
           when coalesce(nullif(li.item ->> 'amount', '')::numeric, 0) > 0 then (li.item ->> 'amount')::numeric
           else coalesce(nullif(li.item ->> 'qty', '')::numeric, 0) * coalesce(nullif(li.item ->> 'rate', '')::numeric, 0)
         end as amount,
         t.id as bill_id, t.amount as bill_amount,
         -- how many different items the bill has (a car is "the only one" on its bill when this is 1)
         (select count(distinct lower(btrim(x.item ->> 'description')))
            from jsonb_array_elements(t.items) as x(item)
            where btrim(coalesce(x.item ->> 'description', '')) <> '') as n_items,
         t.customer_id, t.party_name,
         coalesce(t.bill_date, (t.created_at at time zone 'utc')::date) as bill_day,
         t.created_at
  from public.business_transactions t
  cross join lateral jsonb_array_elements(t.items) as li(item)
  where t.owner_id = v_owner and t.type in ('purchase', 'sale');

  -- ... what each item came to on each kind of bill, and the latest bill's party, model and day. A car's price is read
  -- the way Stock and Inventory and the Payable Report read it: the WHOLE bill (VAT and discount included) when the car
  -- is the only one on it, else the car's own line.
  create temporary table _emi_bills on commit drop as
  select kind, k,
         sum(per_bill) as billed,
         (array_agg(model order by bill_day desc, created_at desc))[1] as model,
         (array_agg(customer_id order by bill_day desc, created_at desc))[1] as customer_id,
         (array_agg(party_name order by bill_day desc, created_at desc))[1] as party_name,
         max(bill_day) as bill_day
  from (
    select kind, k, bill_id, customer_id, party_name, bill_day, created_at,
           max(model) as model,
           case when max(n_items) = 1 then max(bill_amount) else sum(amount) end as per_bill
    from _emi_lines
    where k <> ''
    group by kind, k, bill_id, customer_id, party_name, bill_day, created_at
  ) b
  group by kind, k;

  -- WE PAY THE VENDOR: every vehicle in Stock and Inventory (one row per name)
  insert into public.emi_plans
    (owner_id, direction, car, model, customer_id, customer_name, sale_price, down_payment,
     installment, months, interest_rate, first_due, product_id)
  select p.owner_id, 'purchase', p.name, p.model, p.customer_id, p.party_name, p.price, 0,
         round(p.price * (v_rate / 1200) * power(1 + v_rate / 1200, v_months) / (power(1 + v_rate / 1200, v_months) - 1), 2), v_months, v_rate,
         (coalesce(p.bill_day, current_date) + interval '1 month')::date, p.product_id
  from (
    select distinct on (s.k)
           s.id as product_id, s.owner_id, s.name, s.k,
           l.model, l.customer_id, l.party_name, l.bill_day,
           round(coalesce(nullif(l.billed, 0), nullif(s.purchase_price, 0) * greatest(s.stock_level, 1)), 2) as price
    from (
      select pr.*, lower(regexp_replace(btrim(pr.name), '\s+', ' ', 'g')) as k
      from public.products pr
      where pr.owner_id = v_owner and pr.is_active is not false
    ) s
    left join _emi_bills l on l.kind = 'purchase' and l.k = s.k
    order by s.k, s.created_at
  ) p
  where p.price > 0
    and not exists (
      select 1 from public.emi_plans e
      where e.owner_id = v_owner and e.direction = 'purchase'
        and lower(regexp_replace(btrim(e.car), '\s+', ' ', 'g')) = p.k
    );
  get diagnostics v_bought = row_count;

  -- THE CUSTOMER PAYS US: every vehicle that is already out (on a Sale bill)
  insert into public.emi_plans
    (owner_id, direction, car, model, customer_id, customer_name, sale_price, down_payment,
     installment, months, interest_rate, first_due, product_id)
  select p.owner_id, 'sale', p.name, p.model, p.customer_id, p.party_name, p.price, 0,
         round(p.price * (v_rate / 1200) * power(1 + v_rate / 1200, v_months) / (power(1 + v_rate / 1200, v_months) - 1), 2), v_months, v_rate,
         (p.bill_day + interval '1 month')::date, p.product_id
  from (
    select distinct on (s.k)
           s.id as product_id, s.owner_id, s.name, s.k,
           pb.model, l.customer_id, l.party_name, l.bill_day,
           round(l.billed, 2) as price
    from (
      select pr.*, lower(regexp_replace(btrim(pr.name), '\s+', ' ', 'g')) as k
      from public.products pr
      where pr.owner_id = v_owner and pr.is_active is not false
    ) s
    join _emi_bills l on l.kind = 'sale' and l.k = s.k
    left join _emi_bills pb on pb.kind = 'purchase' and pb.k = s.k
    order by s.k, s.created_at
  ) p
  where p.price > 0
    and not exists (
      select 1 from public.emi_plans e
      where e.owner_id = v_owner and e.direction = 'sale'
        and lower(regexp_replace(btrim(e.car), '\s+', ' ', 'g')) = p.k
    );
  get diagnostics v_sold = row_count;

  raise notice 'Added % purchase plans (we pay the vendor) and % sale plans (the customer pays us) for Deeva Auto.', v_bought, v_sold;

  -- Any vehicle still without a purchase plan has no price on any Purchase bill and no cost price: add its price, then run again.
  select count(*), string_agg(pr.name, ', ' order by pr.name) into v_left, v_left_names
  from public.products pr
  where pr.owner_id = v_owner and pr.is_active is not false
    and not exists (
      select 1 from public.emi_plans e
      where e.owner_id = v_owner and e.direction = 'purchase'
        and lower(regexp_replace(btrim(e.car), '\s+', ' ', 'g')) = lower(regexp_replace(btrim(pr.name), '\s+', ' ', 'g'))
    );
  if v_left > 0 then
    raise notice 'Left out of the vendor side, no price anywhere (% vehicles): %', v_left, v_left_names;
  end if;
end
$$;

commit;

notify pgrst, 'reload schema';

-- What is there now: every vehicle on EMI, both ways.
select case e.direction when 'purchase' then 'We pay vendor' else 'Customer pays us' end as side,
       e.car as vehicle, e.model, e.customer_name as party, e.sale_price as price, e.installment as per_month,
       e.months, e.interest_rate as percent_a_year, e.first_due
from public.emi_plans e
join public.profiles pf on pf.id = e.owner_id
where pf.business_name ~* 'dee?va[[:space:]]+auto' or pf.full_name ~* 'dee?va[[:space:]]+auto'
order by e.direction desc, e.car;
