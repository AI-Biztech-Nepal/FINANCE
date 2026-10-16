-- Renaming a saved customer in the Ledger now carries to their bills.
-- A bill (business_transactions.party_name) keeps its own copy of the name, so a rename on the party
-- used to leave every older bill showing the old one. This keeps the copies in step, and fixes the
-- ones already out of step.
-- Safe to run more than once.

create or replace function public.sync_customer_name_to_records()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.name is distinct from old.name then
    update public.business_transactions set party_name = new.name
     where customer_id = new.id and party_name is distinct from new.name;
  end if;
  return new;
end;
$$;

drop trigger if exists customers_sync_name_to_records on public.customers;
create trigger customers_sync_name_to_records
  after update of name on public.customers
  for each row execute function public.sync_customer_name_to_records();

-- One-off: bring the bills already out of step into line.
update public.business_transactions bt
   set party_name = c.name
  from public.customers c
 where bt.customer_id = c.id and bt.party_name is distinct from c.name;
