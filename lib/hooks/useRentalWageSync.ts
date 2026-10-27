// lib/hooks/useRentalWageSync.ts
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../supabase';

/**
 * Brings the employees' daily rental wages up to today (sync_rental_wages, 0015_rental_employee_wages.sql). The
 * database also does it every night, and whenever a rental changes; this catches up a missed night the moment
 * the Rent page or a ledger opens. Before that migration has run the call simply fails and nothing happens.
 */
export function useRentalWageSync(userId: string | undefined) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    let live = true;
    void (supabase.rpc as unknown as (fn: string) => PromiseLike<{ error: unknown }>)('sync_rental_wages').then(({ error }) => {
      if (live && !error) queryClient.invalidateQueries({ queryKey: ['vendor_ledger_entries'] });
    });
    return () => {
      live = false;
    };
  }, [userId, queryClient]);
}
