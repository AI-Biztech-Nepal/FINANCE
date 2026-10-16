// lib/hooks/useStatementImport.ts
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { supabase } from '../supabase';
import { parseStatementWorkbook, type ParsedStatementRow, type StatementAction } from '../utils/parseStatement';
import { showAlert, getErrorMessage } from '../utils/alert';
import { tidyName } from '../utils/nameCaps';
import type { Customer } from '../../types/database.types';

export interface ReviewRow extends Omit<ParsedStatementRow, 'suggestedType' | 'suggestedParty'> {
  selected: boolean;
  type: StatementAction;
  party: string;
  expenseCategoryId: string | null;
}

/** Hand-off from the Sagar chat's attach button: the chat picks and parses
 * the file, parks the review rows here, and ImportStatementScreen takes them
 * (whether it mounts fresh or is already open) - too many rows for a route
 * param. */
export const usePendingStatementRows = create<{
  rows: ReviewRow[] | null;
  setRows: (rows: ReviewRow[]) => void;
  clear: () => void;
}>((set) => ({
  rows: null,
  setRows: (rows) => set({ rows }),
  clear: () => set({ rows: null }),
}));

/** Picks a bank/wallet statement file (.xls/.xlsx), parses it, and finds
 * which rows (by Reference Code) were already imported before - so
 * re-running the same statement, or one with an overlapping date range,
 * never creates duplicate Finance entries. Nothing here writes an entry by
 * itself; see importSelected for the actual commit step, which only ever
 * runs on rows the reseller has reviewed and left checked. */
export function useStatementImport(ownerId: string | undefined) {
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [importing, setImporting] = useState(false);

  async function pickAndParse(): Promise<ReviewRow[] | null> {
    if (!ownerId) return null;
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/vnd.ms-excel',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets?.[0]) return null;

      const file = new File(result.assets[0].uri);
      const base64 = await file.base64();
      const parsed = parseStatementWorkbook(base64);
      if (parsed.length === 0) {
        showAlert('No transactions found', "That file doesn't look like a supported statement export.");
        return null;
      }

      const codes = parsed.map((r) => r.referenceCode);
      const { data: already, error } = await (supabase.from('statement_imports') as any)
        .select('reference_code')
        .eq('owner_id', ownerId)
        .in('reference_code', codes);
      if (error) throw error;
      const importedSet = new Set((already ?? []).map((r: { reference_code: string }) => r.reference_code));

      return parsed
        .filter((r) => !importedSet.has(r.referenceCode))
        .map(({ suggestedType, suggestedParty, description, ...rest }) => ({
          ...rest,
          description: `${description} (Ref: ${rest.referenceCode})`,
          selected: true,
          type: suggestedType,
          party: suggestedParty,
          expenseCategoryId: null,
        }));
    } catch (err) {
      showAlert('Could not read that file', getErrorMessage(err));
      return null;
    } finally {
      setPicking(false);
    }
  }

  async function importSelected(
    rows: ReviewRow[],
    existingCustomers: Customer[]
  ): Promise<{ imported: number; failed: number }> {
    if (!ownerId) return { imported: 0, failed: 0 };
    setImporting(true);
    let imported = 0;
    let failed = 0;
    // Matched/created once per unique name so ten rows for the same person
    // don't create ten duplicate customers.
    const customerCache = new Map<string, Customer>();
    for (const c of existingCustomers) customerCache.set(c.name.trim().toLowerCase(), c);

    async function resolveCustomer(name: string): Promise<Customer> {
      const key = name.trim().toLowerCase();
      const cached = customerCache.get(key);
      if (cached) return cached;
      const { data, error } = await (supabase.from('customers') as any)
        .insert({ owner_id: ownerId, name: tidyName(name.trim()), phone: null })
        .select()
        .single();
      if (error) throw error;
      customerCache.set(key, data as Customer);
      return data as Customer;
    }

    for (const row of rows.filter((r) => r.selected)) {
      try {
        const amount = row.credit > 0 ? row.credit : row.debit;
        if (row.type === 'expense') {
          const { error } = await (supabase.from('business_transactions') as any).insert({
            owner_id: ownerId,
            type: 'expense',
            amount,
            note: row.description,
            party_name: tidyName(row.party.trim()) || null,
            bill_date: row.date,
            expense_category_id: row.expenseCategoryId,
          });
          if (error) throw error;
        } else if (row.type === 'payment_in') {
          const customer = await resolveCustomer(row.party || 'Unknown');
          const { error } = await (supabase.from('customer_ledger_entries') as any).insert({
            customer_id: customer.id,
            owner_id: ownerId,
            entry_type: 'credit',
            amount,
            note: row.description,
            source: 'manual',
            entry_date: row.date,
          });
          if (error) throw error;
        } else if (row.type === 'payment_out') {
          // Money paid out settles what you owe a vendor - the same
          // vendor-ledger credit Quick Payment's Payment Out records. Booking
          // it as a customer debit inflated "To Receive" for people you only
          // ever paid.
          const vendor = await resolveCustomer(row.party || 'Unknown');
          const { error } = await (supabase.from('vendor_ledger_entries') as any).insert({
            vendor_id: vendor.id,
            owner_id: ownerId,
            entry_type: 'credit',
            amount,
            note: row.description,
            source: 'manual',
            entry_date: row.date,
          });
          if (error) throw error;
        }
        // withdraw/deposit: the reseller's own money moving in or out of the
        // wallet, not a sale/expense/customer payment - just mark it as
        // reviewed so it doesn't show up again.
        const { error: markError } = await (supabase.from('statement_imports') as any).insert({
          owner_id: ownerId,
          reference_code: row.referenceCode,
        });
        if (markError) throw markError;
        imported += 1;
      } catch {
        failed += 1;
      }
    }
    if (imported > 0) {
      queryClient.invalidateQueries({ queryKey: ['business_transactions'] });
      queryClient.invalidateQueries({ queryKey: ['customer_ledger_entries'] });
      queryClient.invalidateQueries({ queryKey: ['vendor_ledger_entries'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    }
    setImporting(false);
    return { imported, failed };
  }

  return { picking, importing, pickAndParse, importSelected };
}
