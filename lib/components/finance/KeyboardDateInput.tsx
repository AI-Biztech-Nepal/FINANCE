// lib/components/finance/KeyboardDateInput.tsx
import { useState, type Ref } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DateField } from '../DateTimeFields';
import { dateLabels, useCalendarMode, type CalendarMode } from '../../hooks/useCalendarMode';
import { adStringToBs, bsDaysInMonth, bsToAdString } from '../../utils/nepaliDate';
import { localTodayIso } from '../../utils/localDate';
import { readKey } from '../../utils/webKeys';

// Same supported windows as the calendar popup (see DateTimeFields) - the
// BS<->AD converter throws outside them.
const BS_MIN_YEAR = 2000;
const BS_MAX_YEAR = 2090;
const AD_MIN_YEAR = 1943;
const AD_MAX_YEAR = 2033;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

interface DateFields {
  y: number;
  m: number; // 1-based
  d: number;
}

function fieldsOf(adValue: string, mode: CalendarMode): DateFields {
  const base = adValue || localTodayIso();
  if (mode === 'bs') {
    const bs = adStringToBs(base) ?? adStringToBs(localTodayIso())!;
    return { y: bs.year, m: bs.month + 1, d: bs.date };
  }
  const [y, m, d] = base.split('-').map(Number);
  return { y, m, d };
}

function toEditText(adValue: string, mode: CalendarMode): string {
  if (!adValue) return '';
  const f = fieldsOf(adValue, mode);
  return `${f.y}-${pad(f.m)}-${pad(f.d)}`;
}

/** What was typed -> an AD 'YYYY-MM-DD', or null if it isn't a real date in
 * the calendar currently in use. A full date ("2083-06-15"), a month and day
 * ("6-15") or just a day ("15") are all accepted - the missing parts come from
 * the date already in the field, so correcting one number is a few keystrokes. */
function parseTyped(text: string, mode: CalendarMode, current: string): string | null {
  const nums = text.trim().split(/[^0-9]+/).filter(Boolean);
  if (nums.length === 0 || nums.length > 3) return null;
  const cur = fieldsOf(current, mode);
  let { y, m, d } = cur;
  if (nums.length === 1) {
    d = Number(nums[0]);
  } else if (nums.length === 2) {
    m = Number(nums[0]);
    d = Number(nums[1]);
  } else {
    y = Number(nums[0]);
    m = Number(nums[1]);
    d = Number(nums[2]);
    if (nums[0].length <= 2) y += 2000;
  }
  if (m < 1 || m > 12 || d < 1) return null;

  let result: string;
  if (mode === 'bs') {
    if (y < BS_MIN_YEAR || y > BS_MAX_YEAR || d > bsDaysInMonth(y, m - 1)) return null;
    try {
      result = bsToAdString(y, m - 1, d);
    } catch {
      return null;
    }
  } else {
    if (y < AD_MIN_YEAR || y > AD_MAX_YEAR) return null;
    const probe = new Date(y, m - 1, d);
    if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) return null;
    result = `${y}-${pad(m)}-${pad(d)}`;
  }
  return adStringToBs(result) ? result : null;
}

function shiftDay(adValue: string, delta: number): string {
  const [y, m, d] = (adValue || localTodayIso()).split('-').map(Number);
  const next = new Date(y, m - 1, d + delta);
  const result = `${next.getFullYear()}-${pad(next.getMonth() + 1)}-${pad(next.getDate())}`;
  return adStringToBs(result) ? result : adValue;
}

/** A typeable date box for keyboard-only entry, sharing the app's BS/AD
 * calendar mode and the existing calendar popup (the icon opens it).
 *  - type a date (2083-06-15, 6-15 or 15) and press Enter/Tab to apply it
 *  - Up/Down arrows move the date a day at a time
 *  - T jumps to today
 *  - Enter moves on (`onEnter`), Ctrl+Enter saves (`onRequestSave`) */
export function KeyboardDateInput({
  value,
  onChange,
  inputRef,
  onEnter,
  onRequestSave,
  accent,
  compact,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  inputRef?: Ref<TextInput>;
  onEnter?: () => void;
  onRequestSave?: () => void;
  /** The caret starts here when the page opens. */
  autoFocus?: boolean;
  accent: string;
  /** One text size down - the box and the line of helper text under it. */
  compact?: boolean;
}) {
  const [mode] = useCalendarMode();
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);

  const labels = value ? dateLabels(value, mode) : ['', ''];
  const preview = focused && draft.trim() ? parseTyped(draft, mode, value) : null;

  function apply(next: string) {
    if (next !== value) onChange(next);
    setDraft(toEditText(next, mode));
    setInvalid(false);
  }

  // Applies what's typed; false (and the red state) if it isn't a real date.
  function commit(): boolean {
    const parsed = parseTyped(draft, mode, value);
    if (!parsed) {
      setInvalid(true);
      return false;
    }
    apply(parsed);
    return true;
  }

  function handleKeyPress(e: unknown) {
    const k = readKey(e);
    if (k.key === 'Enter') {
      k.prevent();
      if (!commit()) return;
      if (k.ctrl) onRequestSave?.();
      else onEnter?.();
      return;
    }
    if (k.key === 'ArrowUp' || k.key === 'ArrowDown') {
      k.prevent();
      const base = parseTyped(draft, mode, value) ?? value;
      apply(shiftDay(base, k.key === 'ArrowUp' ? 1 : -1));
      return;
    }
    if ((k.key === 't' || k.key === 'T') && !k.ctrl && !k.alt) {
      k.prevent();
      apply(localTodayIso());
    }
  }

  function handleBlur() {
    const parsed = draft.trim() ? parseTyped(draft, mode, value) : null;
    if (parsed && parsed !== value) onChange(parsed);
    setFocused(false);
    setInvalid(false);
  }

  const helper = invalid
    ? `Type a ${mode === 'bs' ? 'BS' : 'AD'} date like ${toEditText(value || localTodayIso(), mode)}`
    : preview
      ? dateLabels(preview, mode).join('  ·  ')
      : labels[1];

  return (
    <DateField
      value={value}
      onChange={onChange}
      renderTrigger={(open) => (
        <View>
          <View style={{ justifyContent: 'center' }}>
            <TextInput
              ref={inputRef}
              value={focused ? draft : labels[0]}
              onChangeText={(v) => {
                setDraft(v.replace(/[^0-9\-/. ]/g, ''));
                setInvalid(false);
              }}
              onFocus={() => {
                setDraft(toEditText(value, mode));
                setFocused(true);
                setInvalid(false);
              }}
              onBlur={handleBlur}
              onKeyPress={handleKeyPress}
              selectTextOnFocus
              autoFocus={autoFocus}
              placeholder="Select a date"
              placeholderTextColor="#9CA3AF"
              accessibilityLabel="Date"
              className={`rounded-lg border bg-white py-2.5 pl-3 pr-10 font-semibold text-gray-900 ${compact ? 'text-xs' : 'text-sm'}`}
              style={[
                { borderColor: invalid ? '#DC2626' : focused ? accent : '#D1D5DB' },
                focused ? { boxShadow: `0 0 0 3px ${invalid ? '#DC262629' : `${accent}29`}` } : null,
                { outlineStyle: 'none' } as object,
              ]}
            />
            <Pressable
              onPress={open}
              tabIndex={-1}
              hitSlop={6}
              accessibilityLabel="Open calendar"
              style={{ position: 'absolute', right: 10 }}
            >
              <Ionicons name="calendar-outline" size={17} color="#6B7280" />
            </Pressable>
          </View>
          <Text className={`mt-1.5 ${compact ? 'text-[11px]' : 'text-xs'}`} style={{ color: invalid ? '#DC2626' : '#9CA3AF' }} numberOfLines={1}>
            {helper}
          </Text>
        </View>
      )}
    />
  );
}
