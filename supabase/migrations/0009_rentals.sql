-- Rentals: cars given out on rent. One row per rental - which car, who has it, from when to when, the
-- rate for a day, and the payments received on it (a small list kept on the row: each is
-- {"date": "YYYY-MM-DD", "amount": 1000, "note": "..."}). What a rental comes to (days x rate) and what is
-- still due are worked out in the app from these, so nothing here needs updating as days pass.
--
-- Separate from Sale and Purchase bills on purpose: a car on rent comes back, so it must not take the car off
-- the stock or count as a sale. Additive only. Safe to run more than once.
begin;

create table if not exists public.rentals (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users(id),
  car            text not null,
  model          text,
  customer_id    uuid references public.customers(id) on delete set null,
  customer_name  text,
  start_date     date not null,
  -- The day it is due back, if one was agreed; returned_on is the day it actually came back.
  end_date       date,
  returned_on    date,
  rate_per_day   numeric not null default 0 check (rate_per_day >= 0),
  payments       jsonb not null default '[]'::jsonb,
  note           text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists rentals_owner_start_idx on public.rentals (owner_id, start_date desc);

alter table public.rentals enable row level security;

drop policy if exists rentals_all_owner on public.rentals;
create policy rentals_all_owner on public.rentals
  for all using (owner_id = public.finance_current_owner())
  with check (owner_id = public.finance_current_owner());

drop policy if exists rentals_admin_all on public.rentals;
create policy rentals_admin_all on public.rentals
  for all using (public.finance_is_admin()) with check (public.finance_is_admin());

-- Fills owner_id in on insert when the app leaves it out, and keeps updated_at current. Only where 0001 / 0002
-- created those functions.
do $$
begin
  if to_regprocedure('public.finance_stamp_owner()') is not null then
    drop trigger if exists rentals_stamp_owner on public.rentals;
    create trigger rentals_stamp_owner before insert on public.rentals
      for each row execute function public.finance_stamp_owner();
  end if;
  if to_regprocedure('public.finance_touch_updated_at()') is not null then
    drop trigger if exists rentals_touch on public.rentals;
    create trigger rentals_touch before update on public.rentals
      for each row execute function public.finance_touch_updated_at();
  end if;
end
$$;

commit;
