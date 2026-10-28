-- EMI both ways, with interest.
--   direction      'sale'     a vehicle sold to a customer on instalments (the customer pays us) - what 0019 made;
--                  'purchase' stock bought on instalments (we pay the vendor). The vendor is a row of `customers`
--                             (customer_id / customer_name), like every vendor, and what has been paid is read from
--                             the Paid entries on that vendor's ledger that name the item.
--   interest_rate  percent per month, flat on the financed amount: instalment = financed / months + rate% of financed.
--   product_id     the stock item a purchase plan was made from (null for a plan typed in by hand).
-- Plans made before this one stay as they are: sale, no interest. Safe to run more than once.
begin;

alter table public.emi_plans add column if not exists direction text not null default 'sale';
alter table public.emi_plans drop constraint if exists emi_plans_direction_check;
alter table public.emi_plans add constraint emi_plans_direction_check check (direction in ('sale', 'purchase'));

alter table public.emi_plans add column if not exists interest_rate numeric not null default 0 check (interest_rate >= 0);

alter table public.emi_plans add column if not exists product_id uuid references public.products(id) on delete set null;
create index if not exists emi_plans_product_idx on public.emi_plans (product_id);

commit;

notify pgrst, 'reload schema';
