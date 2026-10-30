-- Every EMI on the vehicle account starts on Kartik 1, 2083 (2026-10-18). first_due is the first installment, a month
-- after the start date on the EMI form, so it is set to 2026-11-18. Other accounts are not touched. Safe to run again.
update public.emi_plans e
   set first_due = date '2026-11-18'
  from public.profiles p
 where p.id = e.owner_id
   and coalesce(nullif(btrim(p.business_name), ''), p.full_name) ~* '\ydee?va\s+auto\y';

select e.direction, count(*) as plans, min(e.first_due) as first_due_from, max(e.first_due) as first_due_to
  from public.emi_plans e
  join public.profiles p on p.id = e.owner_id
 where coalesce(nullif(btrim(p.business_name), ''), p.full_name) ~* '\ydee?va\s+auto\y'
 group by e.direction;
