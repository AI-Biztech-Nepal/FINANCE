-- EMI: a vehicle sold on instalments. One row per plan - the vehicle, the customer, the sale price, the down payment,
-- the monthly instalment, how many months, and the first instalment's day. The sale itself is the Sale bill (it puts
-- the price on the customer's ledger); the plan only says when the money is due. What has been paid is read from
-- the customer's Received entries that name the vehicle, so nothing here needs updating as payments come in.
-- Safe to run more than once.
begin;

create table if not exists public.emi_plans (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users(id),
  car            text not null,
  model          text,
  customer_id    uuid references public.customers(id) on delete set null,
  customer_name  text,
  sale_price     numeric not null default 0 check (sale_price >= 0),
  down_payment   numeric not null default 0 check (down_payment >= 0),
  installment    numeric not null default 0 check (installment >= 0),
  months         integer not null default 1 check (months > 0),
  -- The first instalment's day; the rest fall on the same day of each month after it.
  first_due      date not null,
  note           text,
  closed_on      date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists emi_plans_owner_idx on public.emi_plans (owner_id, first_due desc);

alter table public.emi_plans enable row level security;

drop policy if exists emi_plans_all_owner on public.emi_plans;
create policy emi_plans_all_owner on public.emi_plans
  for all using (owner_id = public.finance_current_owner())
  with check (owner_id = public.finance_current_owner());

drop policy if exists emi_plans_admin_all on public.emi_plans;
create policy emi_plans_admin_all on public.emi_plans
  for all using (public.finance_is_admin()) with check (public.finance_is_admin());

do $$
begin
  if to_regprocedure('public.finance_stamp_owner()') is not null then
    drop trigger if exists emi_plans_stamp_owner on public.emi_plans;
    create trigger emi_plans_stamp_owner before insert on public.emi_plans
      for each row execute function public.finance_stamp_owner();
  end if;
  if to_regprocedure('public.finance_touch_updated_at()') is not null then
    drop trigger if exists emi_plans_touch on public.emi_plans;
    create trigger emi_plans_touch before update on public.emi_plans
      for each row execute function public.finance_touch_updated_at();
  end if;
end
$$;

commit;

notify pgrst, 'reload schema';
