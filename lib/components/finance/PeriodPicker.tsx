// lib/components/finance/PeriodPicker.tsx
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCalendarMode } from '../../hooks/useCalendarMode';
import { localTodayIso } from '../../utils/localDate';
import { BS_MONTHS, adStringToBs, bsDaysInMonth, bsToAdString } from '../../utils/nepaliDate';
import { monthRange } from './DateRangeFilter';
import { KeyboardDateInput } from './KeyboardDateInput';

export type PeriodKey = 'today' | 'yesterday' | 'week' | 'month' | 'lastMonth' | 'year' | 'all' | 'custom';
/** A period: its days ('YYYY-MM-DD'), both '' for All Time. */
export interface Period {
  key: PeriodKey;
  from: string;
  to: string;
}

export const ALL_TIME: Period = { key: 'all', from: '', to: '' };

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const AD_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2083 Kar 10" in BS, "2026 Oct 27" in AD. */
function dayLabel(iso: string, mode: 'bs' | 'ad'): string {
  if (mode === 'bs') {
    const bs = adStringToBs(iso);
    if (bs) return `${bs.year} ${BS_MONTHS[bs.month].slice(0, 3)} ${pad(bs.date)}`;
  }
  const [y, m, d] = iso.split('-').map(Number);
  return `${y} ${AD_MONTHS[m - 1]} ${pad(d)}`;
}

/** The days a period covers, from today: weeks run Sunday to Saturday, months and years are BS ones when the app
 * is read in BS (Baisakh to Chaitra), else AD. */
export function periodRange(key: PeriodKey, mode: 'bs' | 'ad', today = localTodayIso()): { from: string; to: string } {
  const [y, m, d] = today.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  switch (key) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const v = ymd(new Date(y, m - 1, d - 1));
      return { from: v, to: v };
    }
    case 'week':
      return { from: ymd(new Date(y, m - 1, d - date.getDay())), to: ymd(new Date(y, m - 1, d - date.getDay() + 6)) };
    case 'month': {
      const r = monthRange(today, 0, mode);
      return { from: r.start, to: r.end };
    }
    case 'lastMonth': {
      const r = monthRange(today, -1, mode);
      return { from: r.start, to: r.end };
    }
    case 'year': {
      const bs = mode === 'bs' ? adStringToBs(today) : null;
      if (bs) {
        try {
          return { from: bsToAdString(bs.year, 0, 1), to: bsToAdString(bs.year, 11, bsDaysInMonth(bs.year, 11)) };
        } catch {
          // outside the supported years - the AD year below
        }
      }
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    }
    default:
      return { from: '', to: '' };
  }
}

const OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This Week' },
  { key: 'month', label: 'This Month' },
  { key: 'lastMonth', label: 'Last Month' },
  { key: 'year', label: 'This Year' },
  { key: 'all', label: 'All Time' },
  { key: 'custom', label: 'Custom Date' },
];

/** The button that shows the period, and the Select Date sheet it opens. */
export function PeriodPicker({ value, onChange, accent = '#059669' }: { value: Period; onChange: (p: Period) => void; accent?: string }) {
  const [mode] = useCalendarMode();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null);
  const today = localTodayIso();
  const rangeText = (from: string, to: string) => (from === to ? dayLabel(from, mode) : `${dayLabel(from, mode)} - ${dayLabel(to, mode)}`);
  const subOf = (key: PeriodKey) => {
    if (key === 'all') return 'See transactions of all time';
    if (key === 'custom') return value.key === 'custom' && value.from ? rangeText(value.from, value.to) : 'Select date from calendar';
    const r = periodRange(key, mode, today);
    return rangeText(r.from, r.to);
  };
  const buttonLabel = value.key === 'custom' && value.from ? rangeText(value.from, value.to) : OPTIONS.find((o) => o.key === value.key)?.label ?? 'All Time';

  const pick = (key: PeriodKey) => {
    if (key === 'custom') {
      setCustom({ from: value.from || today, to: value.to || today });
      return;
    }
    onChange({ key, ...periodRange(key, mode, today) });
    setOpen(false);
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        className="flex-row items-center rounded-lg border border-gray-300 bg-white px-3 py-2"
        style={{ gap: 6 }}
        accessibilityLabel="Select date"
      >
        <Ionicons name="calendar-outline" size={15} color="#374151" />
        <Text className="text-[13px] font-semibold text-gray-800" numberOfLines={1}>
          {buttonLabel}
        </Text>
        <Ionicons name="chevron-down" size={14} color="#6B7280" />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 items-center justify-center bg-black/40 p-4" onPress={() => setOpen(false)}>
          <Pressable className="w-full overflow-hidden rounded-3xl bg-white" style={{ maxWidth: 420 }} onPress={(e) => e.stopPropagation()}>
            <View className="flex-row items-center justify-between border-b border-gray-100 px-6 py-4">
              <Text className="text-lg font-bold text-gray-900">Select Date</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8} accessibilityLabel="Close">
                <Ionicons name="close" size={20} color="#6B7280" />
              </Pressable>
            </View>
            {custom ? (
              <View className="px-6 py-5" style={{ gap: 12 }}>
                <Text className="text-sm font-semibold text-gray-700">From</Text>
                <KeyboardDateInput value={custom.from} onChange={(v) => setCustom((c) => (c ? { ...c, from: v } : c))} accent={accent} />
                <Text className="text-sm font-semibold text-gray-700">To</Text>
                <KeyboardDateInput value={custom.to} onChange={(v) => setCustom((c) => (c ? { ...c, to: v } : c))} accent={accent} />
                <View className="mt-2 flex-row justify-end" style={{ gap: 10 }}>
                  <Pressable onPress={() => setCustom(null)} className="rounded-lg border border-gray-300 px-4 py-2.5">
                    <Text className="text-sm font-semibold text-gray-600">Back</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      const from = custom.from <= custom.to ? custom.from : custom.to;
                      const to = custom.from <= custom.to ? custom.to : custom.from;
                      onChange({ key: 'custom', from, to });
                      setCustom(null);
                      setOpen(false);
                    }}
                    className="rounded-lg px-5 py-2.5"
                    style={{ backgroundColor: accent }}
                  >
                    <Text className="text-sm font-bold text-white">Apply</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              OPTIONS.map((o, i) => {
                const on = value.key === o.key;
                return (
                  <Pressable
                    key={o.key}
                    onPress={() => pick(o.key)}
                    className={`flex-row items-center px-6 py-3.5 ${i < OPTIONS.length - 1 ? 'border-b border-gray-100' : ''}`}
                  >
                    <View className="flex-1">
                      <Text className="text-[15px] font-semibold text-gray-900">{o.label}</Text>
                      <Text className="mt-0.5 text-[12.5px] text-gray-500">{subOf(o.key)}</Text>
                    </View>
                    <View
                      className="items-center justify-center rounded-full"
                      style={{ width: 22, height: 22, borderWidth: 2, borderColor: on ? accent : '#D1D5DB' }}
                    >
                      {on && <View className="rounded-full" style={{ width: 11, height: 11, backgroundColor: accent }} />}
                    </View>
                  </Pressable>
                );
              })
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}
