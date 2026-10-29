-- 0024: services on Sale and Purchase bills (synced from Jageer Nepal).
--
-- A Sale bill can carry service lines (installation, repair, labour ...) and a Purchase bill services bought
-- in (outsourced work), each with its own name and amount. They are part of the bill: the discount and VAT
-- apply to the items and the services together, and the bill's `amount` already includes them, so the
-- party's ledger and every total that reads `amount` follow without any other change. The Profit & Loss
-- shows services sold as a direct income and services bought as a direct expense.
--
--   installation_charge  the total of the service lines
--   service_charges      the lines themselves: [{ "name": "Installation", "amount": 500 }, ...]
--
-- Replaces 0006_bill_service_charges.sql, removed on 2026-10-16. Additive only; safe to run more than once.
-- Until it is run, bills without services still save (the app only sends these columns when there is one).
alter table public.business_transactions
  add column if not exists installation_charge numeric not null default 0;

alter table public.business_transactions
  add column if not exists service_charges jsonb not null default '[]'::jsonb;
