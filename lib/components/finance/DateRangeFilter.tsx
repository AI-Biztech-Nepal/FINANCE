// lib/components/finance/DateRangeFilter.tsx
import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DateField } from '../DateTimeFields';
import { useCalendarMode, type CalendarMode } from '../../hooks/useCalendarMode';
import { BS_MONTHS, adStringToBs, bsDaysInMonth, bsToAdString } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';
import { DropdownPanel, useDropdown } from './DropdownMenu';
import { themeColors } from '../../theme/accent';

// Dates throughout are 'YYYY-MM-DD'; '' means "no limit on this side".

function shiftDay(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const s = new Date(y, m - 1, d + delta);
  return `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`;
}

/** "Aswin 14" (Bikram Sambat) or "Oct 1" - short enough for a button. */
function shortLabel(ymd: string, mode: CalendarMode): string {
  if (mode === 'ad') {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  const bs = adStringToBs(ymd);
  return bs ? `${BS_MONTHS[bs.month]} ${bs.date}` : ymd;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const ymdOf = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** The first and last day ('YYYY-MM-DD') of the calendar month `delta` months from the one `ymd` is
 * in - a Bikram Sambat month when the app is read in BS (the calendar Nepal runs on), a Gregorian
 * one otherwise. A date outside the BS range the library supports is read as Gregorian. */
export function monthRange(ymd: string, delta: number, mode: CalendarMode): { start: string; end: string } {
  if (mode === 'bs') {
    const bs = adStringToBs(ymd);
    if (bs) {
      const index = bs.year * 12 + bs.month + delta;
      const year = Math.floor(index / 12);
      const month = index - year * 12;
      try {
        return { start: bsToAdString(year, month, 1), end: bsToAdString(year, month, bsDaysInMonth(year, month)) };
      } catch {
        // outside the supported years - fall through to the Gregorian month
      }
    }
  }
  const [y, m] = ymd.split('-').map(Number);
  return { start: ymdOf(new Date(y, m - 1 + delta, 1)), end: ymdOf(new Date(y, m + delta, 0)) };
}

/** "Aswin 2083" (BS) or "Oct 2026" when `from`..`to` is exactly one whole calendar month, else null. */
export function monthLabelOf(from: string, to: string, mode: CalendarMode): string | null {
  if (!from || !to) return null;
  const bounds = monthRange(from, 0, mode);
  if (bounds.start !== from || bounds.end !== to) return null;
  if (mode === 'bs') {
    const bs = adStringToBs(from);
    return bs ? `${BS_MONTHS[bs.month]} ${bs.year}` : null;
  }
  const [y, m] = from.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

function rangeLabel(from: string, to: string, mode: CalendarMode): string {
  // A whole month reads as the month - "Aswin 2083" - not as its first and last day.
  const month = monthLabelOf(from, to, mode);
  if (month) return month;
  if (from && to && from === to) {
    // Today and yesterday by name - they are the days stepped to most, and the arrows beside the
    // button would otherwise leave it saying a date.
    const today = localTodayIso();
    if (from === today) return 'Today';
    if (from === shiftDay(today, -1)) return 'Yesterday';
    return shortLabel(from, mode);
  }
  if (from && to) {
    // Two days of one month read "Aswin 14 – 28", not "Aswin 14 – Aswin 28": it is shorter, so a
    // button of one fixed size can hold it.
    const a = shortLabel(from, mode);
    const b = shortLabel(to, mode);
    const month = (label: string) => label.slice(0, label.lastIndexOf(' '));
    return month(a) === month(b) ? `${a} – ${b.slice(b.lastIndexOf(' ') + 1)}` : `${a} – ${b}`;
  }
  return from ? `From ${shortLabel(from, mode)}` : `Until ${shortLabel(to, mode)}`;
}

const POPUP_PRESETS = [
  { label: '7 days', days: 7 },
  { label: '14 days', days: 14 },
  { label: '30 days', days: 30 },
] as const;

/** The Filter button, as a popup in the middle of the screen (the Statement's). It shows the range that is on (or just "Filter") and opens
 * a dialog with two ways in: one tap for "the last 7 / 14 / 30 days" (counting
 * today as the last day), which applies straight away, or From and To dates
 * chosen on the calendar, which apply when you press Apply. */
function DateFilterPopup({ from, to, onApply, idleLabel = 'Filter' }: {
  from: string;
  to: string;
  onApply: (from: string, to: string) => void;
  /** What the button says while no range is on - a page with a default range can name it ("Today"). */
  idleLabel?: string;
}) {
  const [mode] = useCalendarMode();
  const [open, setOpen] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const active = !!from || !!to;
  const today = localTodayIso();

  const openDialog = () => {
    setDraftFrom(from);
    setDraftTo(to);
    setOpen(true);
  };
  const applyRange = (f: string, t: string) => {
    setOpen(false);
    onApply(f, t);
  };
  const apply = () => {
    // A From after the To is just the two the wrong way round.
    if (draftFrom && draftTo && draftFrom > draftTo) applyRange(draftTo, draftFrom);
    else applyRange(draftFrom, draftTo);
  };

  return (
    <>
      <View className="flex-row items-center" style={{ gap: 6 }}>
        <Pressable
          onPress={openDialog}
          accessibilityLabel="Filter by date"
          className="h-9 flex-row items-center rounded-lg border px-3"
          style={{ gap: 6, borderColor: active ? themeColors.c600 : '#D1D5DB', backgroundColor: active ? themeColors.c50 : '#FFFFFF' }}
        >
          <Ionicons name="funnel-outline" size={14} color={active ? themeColors.c700 : '#4B5563'} />
          <Text className={`text-[13px] font-semibold ${active ? 'text-blue-700' : 'text-gray-700'}`} numberOfLines={1} style={{ maxWidth: 170 }}>
            {active ? rangeLabel(from, to, mode) : idleLabel}
          </Text>
        </Pressable>
        {active && (
          <Pressable onPress={() => onApply('', '')} hitSlop={8} accessibilityLabel="Clear dates">
            <Ionicons name="close-circle" size={18} color="#9CA3AF" />
          </Pressable>
        )}
      </View>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <View className="flex-1 items-center justify-center bg-black/40 px-6">
          <View className="w-full rounded-2xl bg-white" style={{ maxWidth: 420, padding: 24, boxShadow: '0 20px 50px rgba(16,24,40,0.25)' }}>
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="text-lg font-extrabold text-gray-900">Filter by date</Text>
              <Pressable onPress={() => setOpen(false)} hitSlop={8} accessibilityLabel="Close">
                <Ionicons name="close" size={24} color="#374151" />
              </Pressable>
            </View>

            <Text className="mb-2 text-xs font-semibold text-gray-500">Last</Text>
            <View className="flex-row" style={{ gap: 8 }}>
              {POPUP_PRESETS.map((p) => {
                const start = shiftDay(today, -(p.days - 1));
                const on = from === start && to === today;
                return (
                  <Pressable
                    key={p.days}
                    onPress={() => applyRange(start, today)}
                    accessibilityLabel={`Last ${p.label}`}
                    className="flex-1 items-center rounded-xl border py-2.5"
                    style={{ borderColor: on ? themeColors.c600 : '#D1D5DB', backgroundColor: on ? themeColors.c50 : '#FFFFFF' }}
                  >
                    <Text className={`text-sm font-bold ${on ? 'text-blue-700' : 'text-gray-700'}`}>{p.label}</Text>
                  </Pressable>
                );
              })}
            </View>

            <View className="my-5 flex-row items-center" style={{ gap: 10 }}>
              <View className="h-px flex-1 bg-gray-200" />
              <Text className="text-[11px] font-semibold capitalize tracking-wide text-gray-400">or pick dates</Text>
              <View className="h-px flex-1 bg-gray-200" />
            </View>

            <Text className="mb-1 text-xs font-semibold text-gray-500">From</Text>
            <DateField value={draftFrom} onChange={(v) => v && setDraftFrom(v)} />
            <Text className="mb-1 mt-3 text-xs font-semibold text-gray-500">To</Text>
            <DateField value={draftTo} onChange={(v) => v && setDraftTo(v)} />
            <Text className="mt-2 text-[11px] text-gray-400">Leave one empty for no limit on that side.</Text>

            <View className="mt-5 flex-row items-center" style={{ gap: 10 }}>
              <Pressable
                onPress={() => {
                  setDraftFrom('');
                  setDraftTo('');
                }}
                className="rounded-xl border border-gray-300 px-4 py-3"
              >
                <Text className="text-sm font-bold text-gray-600">Clear</Text>
              </Pressable>
              <View className="flex-1" />
              <Pressable onPress={() => setOpen(false)} className="rounded-xl border border-gray-300 px-5 py-3">
                <Text className="text-sm font-bold text-gray-600">Cancel</Text>
              </Pressable>
              <Pressable onPress={apply} accessibilityLabel="Apply dates" className="rounded-xl px-6 py-3" style={{ backgroundColor: themeColors.c700 }}>
                <Text className="text-sm font-bold text-white">Apply</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const PRESETS = [
  { label: 'Last 7 days', days: 7 },
  { label: 'Last 14 days', days: 14 },
  { label: 'Last 30 days', days: 30 },
] as const;

const PANEL_WIDTH = 270;
/** The dropdown's button is always this wide - about what it was when it held a date ("Aswin 25"),
 * with room for "Yesterday" and a month's range ("Aswin 14 – 28"). A longer label is cut short
 * rather than making the button, and the arrows beside it, move. */
const BUTTON_WIDTH = 140;

/** The Filter button. It shows the range that is on (or just "Filter" - or what the page calls
 * its resting range) and drops a menu down from itself: the page's own `shortcuts` first
 * (Today, All time ...), then "the last 7 / 14 / 30 days" (counting today as the last day), each
 * applying with one tap, and Custom range, which opens From and To dates on the calendar right
 * there in the menu and applies when you press Apply. Tapping anywhere else closes it. */
function DateFilterDropdown({ from, to, onApply, idleLabel = 'Filter', shortcuts = [], presets = true }: {
  from: string;
  to: string;
  onApply: (from: string, to: string) => void;
  /** What the button says while no range is on - a page with a default range can name it ("Today"). */
  idleLabel?: string;
  /** Ranges only the page knows how to set (its resting day, "all time"), listed first. */
  shortcuts?: { label: string; on: boolean; onSelect: () => void }[];
  /** The last 7 / 14 / 30 days, between the shortcuts and Custom range. */
  presets?: boolean;
}) {
  const [mode] = useCalendarMode();
  const dropdown = useDropdown(PANEL_WIDTH);
  const [custom, setCustom] = useState(false);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const active = !!from || !!to;
  const today = localTodayIso();

  const openMenu = () => {
    setDraftFrom(from);
    setDraftTo(to);
    setCustom(false);
    dropdown.show();
  };
  const close = dropdown.hide;
  const applyRange = (f: string, t: string) => {
    close();
    onApply(f, t);
  };
  const apply = () => {
    // A From after the To is just the two the wrong way round.
    if (draftFrom && draftTo && draftFrom > draftTo) applyRange(draftTo, draftFrom);
    else applyRange(draftFrom, draftTo);
  };

  const presetStart = (days: number) => shiftDay(today, -(days - 1));
  const matchesPreset = presets && PRESETS.some((p) => from === presetStart(p.days) && to === today);
  const matchesShortcut = shortcuts.some((x) => x.on);
  // Custom range is the one in use when the range on is none of the ready-made ones.
  const customOn = active && !matchesPreset && !matchesShortcut;

  const option = (key: string, label: string, on: boolean, onPress: () => void, trailing?: 'chevron-up' | 'chevron-down') => (
    <Pressable
      key={key}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      className="flex-row items-center px-4 py-3"
      style={{ gap: 10, backgroundColor: on ? themeColors.c50 : undefined }}
    >
      <Text className={`flex-1 text-[14px] ${on ? 'font-bold text-blue-700' : 'font-medium text-gray-900'}`} numberOfLines={1}>
        {label}
      </Text>
      {on ? <Ionicons name="checkmark" size={17} color={themeColors.c700} /> : trailing ? <Ionicons name={trailing} size={16} color="#9CA3AF" /> : null}
    </Pressable>
  );

  return (
    <>
      <View className="flex-row items-center" style={{ gap: 6 }}>
        <Pressable
          ref={dropdown.buttonRef}
          onPress={openMenu}
          accessibilityRole="button"
          accessibilityLabel="Filter by date"
          accessibilityState={{ expanded: dropdown.open }}
          className="h-9 flex-row items-center rounded-lg border px-3"
          // One size whatever it says ("Today", "Aswin 25", a range): the arrows beside it would
          // otherwise shift about every time the day changes.
          style={{ gap: 6, width: BUTTON_WIDTH, borderColor: active ? themeColors.c600 : '#D1D5DB', backgroundColor: active ? themeColors.c50 : '#FFFFFF' }}
        >
          <Ionicons name="funnel-outline" size={14} color={active ? themeColors.c700 : '#4B5563'} />
          <Text className={`flex-1 text-[13px] font-semibold ${active ? 'text-blue-700' : 'text-gray-700'}`} numberOfLines={1}>
            {active ? rangeLabel(from, to, mode) : idleLabel}
          </Text>
          <Ionicons name="chevron-down" size={13} color={active ? themeColors.c700 : '#6B7280'} />
        </Pressable>
      </View>

      <DropdownPanel dropdown={dropdown}>
        {shortcuts.map((x) =>
          option(x.label, x.label, x.on, () => {
            close();
            x.onSelect();
          })
        )}
        {presets &&
          PRESETS.map((p) => {
            const start = presetStart(p.days);
            return option(String(p.days), p.label, from === start && to === today, () => applyRange(start, today));
          })}
        <View className="border-t border-gray-100" />
        {option('custom', 'Custom range', customOn, () => setCustom((c) => !c), custom ? 'chevron-up' : 'chevron-down')}

        {custom && (
          <View className="border-t border-gray-100 px-4 pb-4 pt-3">
            <Text className="mb-1 text-xs font-semibold text-gray-500">From</Text>
            <DateField value={draftFrom} onChange={(v) => v && setDraftFrom(v)} />
            <Text className="mb-1 mt-3 text-xs font-semibold text-gray-500">To</Text>
            <DateField value={draftTo} onChange={(v) => v && setDraftTo(v)} />
            <Text className="mt-2 text-[11px] text-gray-400">Leave one empty for no limit on that side.</Text>
            <View className="mt-3 flex-row items-center" style={{ gap: 8 }}>
              <Pressable
                onPress={() => {
                  setDraftFrom('');
                  setDraftTo('');
                }}
                className="rounded-lg border border-gray-300 px-3 py-2"
              >
                <Text className="text-[13px] font-bold text-gray-600">Clear</Text>
              </Pressable>
              <View className="flex-1" />
              <Pressable onPress={apply} accessibilityLabel="Apply dates" className="rounded-lg px-5 py-2" style={{ backgroundColor: themeColors.c700 }}>
                <Text className="text-[13px] font-bold text-white">Apply</Text>
              </Pressable>
            </View>
          </View>
        )}
      </DropdownPanel>
    </>
  );
}

/** The date Filter button. By default it opens a popup (the Statement's); with `dropdown` the
 * choices hang from the button as a menu instead (the Day Book's), where the page can add its
 * own `shortcuts` (Today ...) at the top of it. */
export function DateFilterButton({ dropdown, shortcuts, presets, ...rest }: {
  from: string;
  to: string;
  onApply: (from: string, to: string) => void;
  /** What the button says while no range is on - a page with a default range can name it ("Today"). */
  idleLabel?: string;
  /** Hang the choices from the button as a menu, instead of opening a popup. */
  dropdown?: boolean;
  /** Ranges only the page knows how to set (its resting day ...), listed first in the menu. */
  shortcuts?: { label: string; on: boolean; onSelect: () => void }[];
  /** In the menu: whether the last 7 / 14 / 30 days are listed (they are by default). */
  presets?: boolean;
}) {
  return dropdown ? <DateFilterDropdown {...rest} shortcuts={shortcuts} presets={presets} /> : <DateFilterPopup {...rest} />;
}

/** The arrow beside the date button: one day back, or one day forward. */
export function DayStepButton({
  direction,
  disabled,
  onPress,
  unit = 'day',
}: {
  direction: 'back' | 'forward';
  disabled?: boolean;
  onPress: () => void;
  /** What one press moves by (for the screen reader). */
  unit?: 'day' | 'month';
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={direction === 'back' ? `Previous ${unit}` : `Next ${unit}`}
      className="h-9 w-9 items-center justify-center rounded-lg border border-gray-300 bg-white"
      style={{ opacity: disabled ? 0.4 : 1 }}
    >
      <Ionicons name={direction === 'back' ? 'chevron-back' : 'chevron-forward'} size={17} color="#374151" />
    </Pressable>
  );
}

/** The date control for a report page: an arrow back, the date button with its menu (the page's own
 * shortcuts, This month and a custom range), and an arrow forward.
 *
 * `from` / `to` are 'YYYY-MM-DD'; both '' is the page's resting view (named by `idleLabel` - "This
 * year", "All dates"). The arrows page by calendar month - a Bikram Sambat month when the app is read
 * in BS: the first press from anywhere lands on the month the period ends in (this month, from the
 * resting view), then each press is one month earlier, or later as far as the current month. */
export function DateStepFilter({
  from,
  to,
  onChange,
  idleLabel,
  shortcuts = [],
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
  /** What the button says while neither date is set. */
  idleLabel: string;
  /** The page's own ready-made ranges, listed first in the menu. */
  shortcuts?: { label: string; on: boolean; onSelect: () => void }[];
}) {
  const [mode] = useCalendarMode();
  const today = localTodayIso();
  const resting = !from && !to;
  const thisMonth = monthRange(today, 0, mode);

  /** The month a press lands on, or null when there is none (nothing after the current month). */
  function target(delta: -1 | 1): { start: string; end: string } | null {
    if (resting) return delta < 0 ? thisMonth : null;
    const anchor = to || today;
    const current = monthRange(anchor, 0, mode);
    const whole = from === current.start && anchor === current.end;
    // On a whole month the arrows move a month; on anything else (a day, a week, a custom range) the
    // first press goes to the month the period ends in.
    const next = whole ? monthRange(current.start, delta, mode) : delta < 0 ? current : monthRange(anchor, 1, mode);
    return delta > 0 && next.start > today ? null : next;
  }
  const back = target(-1);
  const forward = target(1);

  return (
    <View className="flex-row items-center" style={{ gap: 6 }}>
      <DayStepButton direction="back" unit="month" disabled={!back} onPress={() => back && onChange(back.start, back.end)} />
      <DateFilterButton
        dropdown
        presets={false}
        from={from}
        to={to}
        idleLabel={idleLabel}
        onApply={onChange}
        shortcuts={[
          ...shortcuts,
          { label: 'This month', on: from === thisMonth.start && to === thisMonth.end, onSelect: () => onChange(thisMonth.start, thisMonth.end) },
        ]}
      />
      <DayStepButton direction="forward" unit="month" disabled={!forward} onPress={() => forward && onChange(forward.start, forward.end)} />
    </View>
  );
}
