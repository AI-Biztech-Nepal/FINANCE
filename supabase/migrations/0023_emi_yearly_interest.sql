-- EMI interest is now a YEARLY rate, worked out the way banks do (reducing balance): each month's interest is a twelfth
-- of the yearly rate on what is still unpaid, and every instalment is the same:
--   instalment = P x r x (1 + r)^n / ((1 + r)^n - 1)    P = price - down payment, r = rate / 12 / 100, n = months
-- (lib/utils/emi.ts, emiInstallment). Until now the rate was read as % a MONTH, flat: instalment = P / n + rate% of P.
-- Each plan keeps its rate (10 stays 10, now meaning 10% a year) and gets its instalment worked out again - only the
-- plans whose instalment is still the one the old rule gave; one typed in by hand is left as it is. Safe to run again:
-- a plan already worked out the new way no longer matches the old rule, so it is not touched twice.
begin;

update public.emi_plans
set installment = round(
      (sale_price - down_payment) * (interest_rate / 1200) * power(1 + interest_rate / 1200, months)
        / (power(1 + interest_rate / 1200, months) - 1),
      2)
where interest_rate > 0
  and sale_price - down_payment > 0
  and abs(installment - round((sale_price - down_payment) / months + (sale_price - down_payment) * interest_rate / 100, 2)) < 0.01;

commit;

-- What the plans come to now.
select case direction when 'purchase' then 'We pay vendor' else 'Customer pays us' end as side,
       car as vehicle, sale_price as price, down_payment, installment as per_month, months,
       interest_rate as percent_a_year, round(down_payment + installment * months, 2) as total
from public.emi_plans
order by direction desc, car;
