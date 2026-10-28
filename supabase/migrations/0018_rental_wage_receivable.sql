-- Rent: the employee who goes out with a rented vehicle owes the business its daily amount (0015 had it the other way,
-- as owed to them). Each day the vehicle is out is now a Receivable on the employee's ledger - the customer side,
-- like a sale - and the money they hand over is entered on the Received page against it. The lines written by 0015 on
-- the vendor side are removed and written again on the customer side. Safe to run more than once.
begin;

create or replace function public.sync_rental_wages_for(p_owner uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  -- 0015's lines, owed to the employee: gone.
  delete from public.vendor_ledger_entries v
   where v.source_type = 'rental_wage' and (p_owner is null or v.owner_id = p_owner);

  -- Lines no longer due (a rental removed or returned earlier, its employee or amount changed).
  delete from public.customer_ledger_entries c
   where c.source_type = 'rental_wage'
     and (p_owner is null or c.owner_id = p_owner)
     and (c.source_id, c.customer_id) not in (select w.source_id, w.employee_id from public.rental_wage_rows(p_owner) w);

  -- Each day out: owed by the employee.
  insert into public.customer_ledger_entries (customer_id, owner_id, entry_type, amount, note, source, source_type, source_id, entry_date)
  select w.employee_id, w.owner_id, 'debit', w.amount, w.note, 'booking', 'rental_wage', w.source_id, w.day
    from public.rental_wage_rows(p_owner) w
  on conflict (source_type, source_id) where source_type is not null and source_id is not null
  do update set amount = excluded.amount, customer_id = excluded.customer_id, note = excluded.note, entry_date = excluded.entry_date;
end $$;
revoke execute on function public.sync_rental_wages_for(uuid) from public, anon, authenticated;

commit;

select public.sync_rental_wages_for(null);
