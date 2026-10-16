// lib/hooks/useSupabase.ts
import { useQuery, useMutation, useQueryClient, type UseQueryOptions } from '@tanstack/react-query';
import { supabase } from '../supabase';
import { fetchAllRows } from '../utils/fetchAllRows';
import type { Database } from '../../types/database.types';

type TableName = keyof Database['public']['Tables'];
type Row<T extends TableName> = Database['public']['Tables'][T]['Row'];
type Insert<T extends TableName> = Database['public']['Tables'][T]['Insert'];
type Update<T extends TableName> = Database['public']['Tables'][T]['Update'];

interface QueryFilters {
  [column: string]: string | number | boolean | null;
}

// DB triggers cascade one table's write into others server-side; the
// query cache can't know that unless told, so a screen reading the other
// table would show stale data. Each entry is every table a write to the key
// table can touch:
//  - business_transactions -> customer/vendor ledgers: a Sale/Purchase against
//    a real party posts/reverses a debt there.
//  - business_transactions -> products: a Sale/Purchase moves stock
//    (0002_profiles_inventory.sql).
const LINKED_INVALIDATIONS: Partial<Record<TableName, TableName[]>> = {
  business_transactions: ['customer_ledger_entries', 'vendor_ledger_entries', 'products'],
  // Deleting a party type un-types its parties (on delete set null).
  party_types: ['customers'],
};

function invalidateWithLinked(queryClient: ReturnType<typeof useQueryClient>, table: TableName) {
  queryClient.invalidateQueries({ queryKey: [table] });
  for (const linked of LINKED_INVALIDATIONS[table] ?? []) {
    queryClient.invalidateQueries({ queryKey: [linked] });
  }
}

/**
 * Generic read hook for any table, with optional equality filters.
 *
 * Example:
 *   const { data, isLoading } = useSupabaseQuery('service_requests', {
 *     filters: { client_id: userId },
 *   });
 */
export function useSupabaseQuery<T extends TableName>(
  table: T,
  options?: {
    filters?: QueryFilters;
    columns?: string;
    orderBy?: { column: string; ascending?: boolean };
    /** Read every matching row, not just the first 1000 the API returns per
     * request. For anything that sums rows (ledger balances); the table needs
     * an `id` column. */
    all?: boolean;
    enabled?: boolean;
    queryOptions?: Omit<UseQueryOptions<Row<T>[]>, 'queryKey' | 'queryFn'>;
  }
) {
  const { filters = {}, columns = '*', orderBy, all = false, enabled = true, queryOptions } = options ?? {};

  return useQuery<Row<T>[]>({
    // `all` and a narrowed `columns` are part of the key: a full read, a capped
    // read and a few-columns read of the same table + filter are different data
    // and must never share a cache entry (a screen asking for every column would
    // otherwise be handed rows with no dates or amounts).
    // (Invalidations match on the leading [table], so they still reach all of them.)
    queryKey: [table, filters, orderBy, ...(all ? ['all'] : []), ...(columns === '*' ? [] : [columns])],
    enabled,
    queryFn: async () => {
      // Cast to `any` here: postgrest-js's `.select()`/`.eq()` overloads resolve
      // their column/query types from a literal table name, which breaks down
      // when `table` is itself a generic parameter. The hand-written `Row<T>`
      // cast below is what actually keeps this hook's return type safe.
      const buildQuery = (selectOptions?: { count: 'exact' }) => {
        let query = (supabase.from(table) as any).select(columns, selectOptions);

        for (const [column, value] of Object.entries(filters)) {
          query = query.eq(column, value);
        }
        if (orderBy) {
          query = query.order(orderBy.column, { ascending: orderBy.ascending ?? true });
        }
        return query;
      };

      if (all) {
        // `id` as the last sort key keeps page boundaries stable, so no row is
        // skipped or read twice between pages.
        return fetchAllRows<Row<T>>((from, to) => buildQuery({ count: 'exact' }).order('id').range(from, to));
      }

      const { data, error } = await buildQuery();
      if (error) throw error;
      return (data ?? []) as Row<T>[];
    },
    ...queryOptions,
  });
}

/** Fetch a single row by id. */
export function useSupabaseRow<T extends TableName>(table: T, id: string | undefined, columns = '*') {
  return useQuery<Row<T> | null>({
    // A narrowed column list gets its own cache entry, so a partial row
    // never stands in for a full one elsewhere.
    queryKey: columns === '*' ? [table, 'row', id] : [table, 'row', id, columns],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await (supabase.from(table) as any).select(columns).eq('id', id!).single();
      if (error) throw error;
      return data as Row<T>;
    },
  });
}

/** Insert a row and invalidate that table's queries on success. */
export function useSupabaseInsert<T extends TableName>(table: T) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: Insert<T>) => {
      const { data, error } = await (supabase.from(table) as any).insert(values).select().single();
      if (error) throw error;
      return data as Row<T>;
    },
    onSuccess: () => invalidateWithLinked(queryClient, table),
  });
}

/** Update a row by id and invalidate that table's queries on success. */
export function useSupabaseUpdate<T extends TableName>(table: T) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, values }: { id: string; values: Update<T> }) => {
      const { data, error } = await (supabase.from(table) as any).update(values).eq('id', id).select().single();
      if (error) throw error;
      return data as Row<T>;
    },
    onSuccess: () => invalidateWithLinked(queryClient, table),
  });
}

/** Upsert a row by a unique constraint and invalidate that table's queries on success. */
export function useSupabaseUpsert<T extends TableName>(table: T, conflictColumns: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: Insert<T>) => {
      const { data, error } = await (supabase.from(table) as any)
        .upsert(values, { onConflict: conflictColumns })
        .select()
        .single();
      if (error) throw error;
      return data as Row<T>;
    },
    onSuccess: () => invalidateWithLinked(queryClient, table),
  });
}

/**
 * Delete a row by id and invalidate that table's queries on success.
 *
 * NOTE: this only deletes the database row (e.g. a `profiles` row). It does
 * NOT delete the corresponding Supabase Auth user — that requires the
 * service_role key via the Auth Admin API, which must never ship inside a
 * client app (anyone could extract it and bypass all your RLS policies).
 * To support true account deletion, add a Supabase Edge Function that runs
 * server-side with the service_role key and call it from here instead.
 */
/**
 * `requireRow`: fail when the delete matched nothing. The API reports success
 * for a delete that a permission rule filtered down to zero rows, so for
 * something the user has to see really go (a person from the ledger) ask for
 * the deleted row back and treat "none" as a failure instead of a silent no-op.
 */
export function useSupabaseDelete<T extends TableName>(table: T, options?: { requireRow?: boolean }) {
  const queryClient = useQueryClient();
  const requireRow = options?.requireRow ?? false;
  return useMutation({
    mutationFn: async (id: string) => {
      const query = (supabase.from(table) as any).delete().eq('id', id);
      const { data, error } = requireRow ? await query.select('id') : await query;
      if (error) throw error;
      if (requireRow && (!data || data.length === 0)) {
        throw new Error('Nothing was deleted - you may not have permission to remove this.');
      }
      return id;
    },
    onSuccess: () => invalidateWithLinked(queryClient, table),
  });
}

/**
 * Subscribe to realtime changes on a table (optionally filtered), invalidating
 * the matching React Query cache whenever a row changes. Use inside a
 * useEffect in screens that need live updates (e.g. client issue tracking).
 *
 * `channelKey` keeps two listeners on the same table+filter apart: supabase
 * hands back the existing channel for a topic it already has, so a second
 * subscriber with the same topic would share (and on unmount, tear down)
 * the first one's channel.
 */
export function subscribeToTable(table: TableName, onChange: () => void, filter?: string, channelKey?: string) {
  const channel = supabase
    .channel(`realtime:${table}:${filter ?? 'all'}${channelKey ? `:${channelKey}` : ''}`)
    .on('postgres_changes', { event: '*', schema: 'public', table, filter }, onChange)
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
