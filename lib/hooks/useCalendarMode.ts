// lib/hooks/useCalendarMode.ts
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setLabelCalendarMode, toAdLabel, toBsLabel } from '../utils/nepaliDate';

export type CalendarMode = 'bs' | 'ad';

interface CalendarModeState {
  mode: CalendarMode;
  setMode: (mode: CalendarMode) => void;
}

/** Which calendar the user reads dates in. Picking BS or AD inside any
 * DateField sets it for every date field and date heading (e.g. the Day
 * Book), and it's remembered across launches. Values are always stored as
 * AD 'YYYY-MM-DD' regardless - this only changes what's shown. */
export const useCalendarModeStore = create<CalendarModeState>()(
  persist(
    (set) => ({
      mode: 'bs',
      setMode: (mode) => set({ mode }),
    }),
    { name: 'calendar-mode', storage: createJSONStorage(() => AsyncStorage) }
  )
);

// The date labels that are plain functions (not hooks) read the choice from nepaliDate: keep it in
// step with the store - now, when it has been loaded from storage, and whenever it is changed.
setLabelCalendarMode(useCalendarModeStore.getState().mode);
useCalendarModeStore.subscribe((state) => setLabelCalendarMode(state.mode));

export function useCalendarMode(): [CalendarMode, (mode: CalendarMode) => void] {
  const mode = useCalendarModeStore((state) => state.mode);
  const setMode = useCalendarModeStore((state) => state.setMode);
  return [mode, setMode];
}

/** Main and secondary label for an AD 'YYYY-MM-DD' in the chosen calendar,
 * e.g. BS -> ["Bhadra 14, 2083", "Sun, Aug 30, 2026"],
 *      AD -> ["Sun, Aug 30, 2026", "Bhadra 14, 2083"]. */
export function dateLabels(value: string, mode: CalendarMode): [string, string] {
  const bs = toBsLabel(value);
  const ad = toAdLabel(value);
  return mode === 'ad' ? [ad, bs] : [bs, ad];
}
