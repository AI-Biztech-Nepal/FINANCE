// lib/hooks/useFreshLedgerArea.ts
import { useCallback, useSyncExternalStore } from 'react';
import { useFocusEffect } from 'expo-router';
import { queryClient } from '../providers/QueryProvider';

// The screens of the Ledger area: the Ledger list, a person's own page and a person's own report.
// They are tab screens, and a tab screen stays mounted when you go to another one - so a person's
// page you left (its open form, its popup) and the list's open headers and search were all still
// there when you came back to it hours later.
//
// Moving between the Ledger's own pages (list -> a person -> back) keeps what is open, so a search
// is still there when you return to the list. Leaving the area for anywhere else - Home, the Day
// Book, a report - ends the visit: every page of it starts again from nothing the next time.
let areaVersion = 0;
let focusedHere = 0;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
const read = () => areaVersion;

function endVisit() {
  areaVersion += 1;
  // Whatever is read again on the way back is current, not what was cached when the visit began.
  for (const table of ['customers', 'customer_ledger_entries', 'vendor_ledger_entries', 'business_transactions']) {
    queryClient.invalidateQueries({ queryKey: [table] });
  }
  listeners.forEach((listener) => listener());
}

/** A number that changes each time the Ledger area has been left. Put it in the `key` of the
 * screen's content: the content is then built again - nothing open, nothing typed, data read again. */
export function useFreshLedgerArea(): number {
  const version = useSyncExternalStore(subscribe, read, read);

  useFocusEffect(
    useCallback(() => {
      focusedHere += 1;
      return () => {
        focusedHere -= 1;
        // Going to another page of the area focuses it in the same step; a beat later nothing of the
        // area is focused only when the area was really left.
        setTimeout(() => {
          if (focusedHere === 0) endVisit();
        }, 0);
      };
    }, [])
  );

  return version;
}
