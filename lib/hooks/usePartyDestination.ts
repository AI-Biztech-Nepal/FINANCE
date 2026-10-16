// lib/hooks/usePartyDestination.ts
import { useCallback, useMemo } from 'react';
import { useSupabaseQuery } from './useSupabase';
import { usePartyTypes } from './usePartyTypes';
import type { BusinessTransactionType } from '../../types/database.types';

/** The report a Ledger type stands for, by its name. Types are the owner's own words (see
 * usePartyTypes), so "Expense" and "Expenses" both count, and "Wholesale" is not "Sale".
 * Anything else - Customer, Vendor, Employee, no type - has no report of its own. */
export function reportKindOfType(typeName: string | undefined): BusinessTransactionType | null {
  const name = typeName ?? '';
  if (/\bexpenses?\b/i.test(name)) return 'expense';
  if (/\bsales?\b/i.test(name)) return 'sale';
  if (/\bpurchases?\b/i.test(name)) return 'purchase';
  return null;
}

/** Whether a ledger of this type is a person on the payroll - Employee / Staff. What is paid to
 * them (a salary, an advance, fuel) is an expense with no bill behind it, so the Expense Report
 * lists it; a Vendor's or Customer's payments settle purchases and sales, which have their own
 * reports. Where a person opens from the Ledger list is reportKindOfType above. */
export function isStaffLedgerType(typeName: string | undefined): boolean {
  return /\b(employees?|staff)\b/i.test(typeName ?? '');
}

/** Where a person opens from the Ledger list, by the Ledger type they carry.
 *
 * A person typed Expense opens the Expense Report, Sales the Sales Report, Purchase the
 * Purchase Report - each scoped to that person and under their details (the person page
 * opened for everyone and was always titled "Customer"). Every other type, and a person
 * with none, opens their ledger as before.
 *
 * Returns the href for a party id. */
export function usePartyDestination(userId: string | undefined, basePath: string): (partyId: string) => string {
  // The same read (and so the same cache entry) as the Ledger list's own.
  const { data: customers } = useSupabaseQuery('customers', {
    filters: userId ? { owner_id: userId } : {},
    orderBy: { column: 'name' },
    enabled: !!userId,
  });
  const { nameById: typeName } = usePartyTypes(userId);

  const kindByParty = useMemo(() => {
    const map = new Map<string, BusinessTransactionType>();
    for (const c of customers ?? []) {
      const kind = c.party_type_id ? reportKindOfType(typeName.get(c.party_type_id)) : null;
      if (kind) map.set(c.id, kind);
    }
    return map;
  }, [customers, typeName]);

  return useCallback(
    (partyId: string) => {
      const kind = kindByParty.get(partyId);
      return kind ? `${basePath}/party-report?id=${partyId}&kind=${kind}` : `${basePath}/customer/${partyId}`;
    },
    [kindByParty, basePath]
  );
}
