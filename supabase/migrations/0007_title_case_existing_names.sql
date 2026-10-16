-- OPTIONAL data tidy: one house style, the first letter of every word is a capital ("Aadarsha Store").
-- The app now writes names that way (lib/utils/nameCaps.ts) and draws all text that way; this brings
-- the names already saved into line.
--
-- Only values written in ONE case are touched - ALL CAPITALS or all small letters. A name somebody
-- wrote in mixed case ("iPhone Repair", "McDonald") is left exactly as typed. Where a type / category /
-- item would collide with one that already has the new spelling, it is left alone rather than failing
-- the unique index. Nothing else about any row changes.
-- Safe to run more than once. Skip it if you would rather keep the names exactly as they were typed.

create or replace function _title_case(t text) returns text
language sql immutable as $$
  select initcap(lower(t));
$$;

-- "Is a one-case value that would actually change" (has letters, is all-upper or all-lower).
create or replace function _needs_title_case(t text) returns boolean
language sql immutable as $$
  select t is not null
     and t ~ '[A-Za-z]'
     and (t = upper(t) or t = lower(t))
     and t <> _title_case(t);
$$;

-- Customers / vendors in the Ledger.
update public.customers
   set name = _title_case(name)
 where _needs_title_case(name);

update public.customers
   set address = _title_case(address)
 where _needs_title_case(address);

update public.customers
   set contact_person_name = _title_case(contact_person_name)
 where _needs_title_case(contact_person_name);

-- The party written on each bill.
update public.business_transactions
   set party_name = _title_case(party_name)
 where _needs_title_case(party_name);

-- Ledger types, expense categories and saved bill items: unique per owner and name.
update public.party_types p
   set name = _title_case(p.name)
 where _needs_title_case(p.name)
   and not exists (
     select 1 from public.party_types o
      where o.owner_id = p.owner_id and o.id <> p.id and o.name = _title_case(p.name)
   );

update public.expense_categories c
   set name = _title_case(c.name)
 where _needs_title_case(c.name)
   and not exists (
     select 1 from public.expense_categories o
      where o.owner_id = c.owner_id and o.id <> c.id and o.name = _title_case(c.name)
   );

update public.finance_items f
   set name = _title_case(f.name)
 where _needs_title_case(f.name)
   and not exists (
     select 1 from public.finance_items o
      where o.owner_id = f.owner_id and o.id <> f.id and o.name = _title_case(f.name)
   );

drop function _needs_title_case(text);
drop function _title_case(text);
