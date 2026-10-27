-- Ledger type for every party. Most parties are made on the spot by a form (Sale, Purchase, Paid, Received,
-- Rent ...) that saves no type, so the Ledger listed them under no type at all. Now:
--   * a party with no type takes one from its first ledger entry: the customer side (a sale, money received)
--     makes it a Customer, the vendor side (a purchase, money paid) a Vendor;
--   * the parties already there with no type take theirs from what their ledger holds most of.
-- A type someone chose (Employee, Expense ...) is never changed. Safe to run more than once.
begin;

-- The account's party type of this name, made if it has none yet.
create or replace function public.party_type_id_for(p_owner uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  select id into tid from party_types where owner_id = p_owner and lower(btrim(name)) = lower(p_name) order by created_at limit 1;
  if tid is null then
    insert into party_types (owner_id, name) values (p_owner, p_name) on conflict (owner_id, name) do nothing returning id into tid;
    if tid is null then
      select id into tid from party_types where owner_id = p_owner and name = p_name;
    end if;
  end if;
  return tid;
end $$;
revoke execute on function public.party_type_id_for(uuid, text) from public, anon, authenticated;

create or replace function public.type_party_from_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  pid  uuid;
  kind text;
begin
  -- Read the party field through jsonb: a vendor entry has no customer_id and a customer entry no vendor_id.
  if tg_table_name = 'customer_ledger_entries' then
    pid := (to_jsonb(new) ->> 'customer_id')::uuid;
    kind := 'Customer';
  else
    pid := (to_jsonb(new) ->> 'vendor_id')::uuid;
    kind := 'Vendor';
  end if;
  update customers
     set party_type_id = party_type_id_for(new.owner_id, kind)
   where id = pid and party_type_id is null;
  return new;
end $$;

drop trigger if exists customer_ledger_types_party on public.customer_ledger_entries;
create trigger customer_ledger_types_party after insert on public.customer_ledger_entries
  for each row execute function public.type_party_from_ledger();
drop trigger if exists vendor_ledger_types_party on public.vendor_ledger_entries;
create trigger vendor_ledger_types_party after insert on public.vendor_ledger_entries
  for each row execute function public.type_party_from_ledger();

-- The parties already there: the side their ledger has more entries on.
update public.customers c
   set party_type_id = public.party_type_id_for(c.owner_id, x.kind)
  from (
    select c2.id,
           case when (select count(*) from public.vendor_ledger_entries v where v.vendor_id = c2.id)
                   > (select count(*) from public.customer_ledger_entries e where e.customer_id = c2.id)
                then 'Vendor' else 'Customer' end as kind
      from public.customers c2
     where c2.party_type_id is null
       and (exists (select 1 from public.customer_ledger_entries e where e.customer_id = c2.id)
            or exists (select 1 from public.vendor_ledger_entries v where v.vendor_id = c2.id))
  ) x
 where c.id = x.id;

commit;
