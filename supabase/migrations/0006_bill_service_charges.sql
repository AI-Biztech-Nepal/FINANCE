-- A Sale bill can carry several service charges (installation, repair, delivery ...), each with its own
-- name and amount, as a small table above the remarks. They are direct income - no item, no stock and
-- no purchase cost behind them - and are kept apart from the items (and from the discount and VAT) so
-- the reports can show them on their own. The bill's `amount` already includes them, so the party's
-- ledger debt and every total that reads `amount` follow without any other change.
--
--   installation_charge  the total of the service lines (what the reports read)
--   service_charges      the lines themselves: [{ "name": "Installation", "amount": 500 }, ...]
-- Additive only. Safe to run more than once.
alter table public.business_transactions
  add column if not exists installation_charge numeric not null default 0;

alter table public.business_transactions
  add column if not exists service_charges jsonb not null default '[]'::jsonb;
