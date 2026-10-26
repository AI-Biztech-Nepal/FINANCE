// lib/components/finance/FormKit.tsx
//
// The compact add / edit form the finance pages share (Bank Accounts, a
// customer's details and ledger entries): a small titled card, fields side by
// side that wrap on a narrow screen, and Cancel / Save on the right.
import { type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from 'react-native';
import { Text } from './CapsText';
import { Ionicons } from '@expo/vector-icons';
import { FINANCE_ENTRY_ACCENT, FINANCE_ENTRY_SHADOW } from './entryTheme';
import { readKey } from '../../utils/webKeys';

export const INPUT = 'rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900';

/** A label over its input. Fields sit side by side and wrap onto the next line
 * when the window is narrow, so one form fits a desktop and a phone. */
export function Field({ label, basis = 220, children }: { label: string; basis?: number; children: ReactNode }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: basis, minWidth: 0 }}>
      <Text className="mb-1.5 text-xs font-semibold text-gray-600">{label}</Text>
      {children}
    </View>
  );
}

/** The row the fields of a form sit in. */
export function FieldRow({ children }: { children: ReactNode }) {
  return (
    <View className="flex-row flex-wrap" style={{ columnGap: 14, rowGap: 12 }}>
      {children}
    </View>
  );
}

/** The card a form sits in: a small title, then whatever the form holds. */
export function FormCard({ icon, title, children }: { icon: keyof typeof Ionicons.glyphMap; title: string; children: ReactNode }) {
  return (
    <View
      className="rounded-2xl border border-gray-200 bg-white px-5 py-4"
      style={{ gap: 12, boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.03)' }}
    >
      <View className="flex-row items-center gap-2">
        <Ionicons name={icon} size={14} color="#6B7280" />
        <Text className="text-[11px] font-bold capitalize tracking-wider text-gray-500">{title}</Text>
      </View>
      {children}
    </View>
  );
}

/** Two or three choices side by side, one chosen - each in its own colour
 * (green for money in, red for money out). */
export function Segmented<K extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: K; label: string; color: string; bg: string; border: string }[];
  value: K;
  onChange: (key: K) => void;
}) {
  return (
    <View className="flex-row flex-wrap" style={{ gap: 8 }}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            className="items-center rounded-lg border px-4 py-2"
            style={{ borderColor: on ? o.border : '#D1D5DB', backgroundColor: on ? o.bg : '#FFFFFF' }}
          >
            <Text className="text-xs font-bold" style={{ color: on ? o.color : '#6B7280' }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Cancel and Save on the right; an optional Remove stays on the left. */
export function FormActions({
  onCancel,
  onSave,
  saving,
  saveLabel = 'Save',
  onRemove,
}: {
  onCancel: () => void;
  onSave: () => void;
  saving?: boolean;
  saveLabel?: string;
  /** Called when Remove is pressed - the caller asks "are you sure". */
  onRemove?: () => void;
}) {
  return (
    <View className="flex-row flex-wrap items-center justify-end" style={{ gap: 10 }}>
      {onRemove && (
        <Pressable
          onPress={onRemove}
          className="mr-auto flex-row items-center rounded-xl border border-red-200 bg-red-50 px-4 py-2.5"
          style={{ gap: 6 }}
        >
          <Ionicons name="trash-outline" size={15} color="#DC2626" />
          <Text className="text-sm font-semibold text-red-600">Remove</Text>
        </Pressable>
      )}
      <Pressable onPress={onCancel} className="items-center rounded-xl border border-gray-300 bg-white px-6 py-2.5">
        <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
      </Pressable>
      <Pressable
        onPress={onSave}
        disabled={saving}
        className="items-center rounded-xl px-8 py-2.5 disabled:opacity-50"
        style={{ backgroundColor: FINANCE_ENTRY_ACCENT, boxShadow: `0 2px 6px ${FINANCE_ENTRY_SHADOW}` }}
      >
        <Text className="text-sm font-bold text-white">{saving ? 'Saving…' : saveLabel}</Text>
      </Pressable>
    </View>
  );
}

/** A form in a popup: the page dims behind a card with a blue title bar and a
 * close button - the same popup the Day Book's entry editor uses. Mount it to
 * open it and unmount it to close it, so every opening starts blank.
 *
 * Clicking the dimmed area does not close it (what has been typed would be
 * lost by a stray click); the close button, Cancel and Esc do. A card that only
 * shows something - nothing typed in it - can set `closeOnOutside`, and then the
 * dimmed area closes it too. */
export function PopupCard({
  title,
  onClose,
  maxWidth = 560,
  headerRight,
  closeOnOutside = false,
  children,
}: {
  title: string;
  onClose: () => void;
  maxWidth?: number;
  /** Buttons in the blue bar, left of the close button - so they take no room from the form below. */
  headerRight?: ReactNode;
  /** A click on the dimmed area closes the card - for one with nothing typed in it. */
  closeOnOutside?: boolean;
  children: ReactNode;
}) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View className="flex-1 items-center justify-center bg-black/50 px-4">
          {/* Behind the card, so a click on the card never reaches it. */}
          {closeOnOutside && (
            <Pressable
              onPress={onClose}
              accessibilityLabel="Close"
              style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
            />
          )}
          <View className="w-full overflow-hidden rounded-2xl bg-white" style={{ maxWidth, maxHeight: '92%' }}>
            <View className="flex-row items-center gap-2.5 px-5 py-4" style={{ backgroundColor: '#1D4ED8' }}>
              <Text className="flex-1 text-[16px] font-bold text-white" numberOfLines={1}>
                {title}
              </Text>
              {headerRight}
              <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
                <Ionicons name="close" size={22} color="#FFFFFF" />
              </Pressable>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 14 }}>
              {children}
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

/** Fixing the name of a customer, vendor or payee, from the page it is picked on - a popup over the page,
 * the same one on every page (the name card behind it stays as it is). Enter saves, Esc closes. */
export function RenamePartyPopup({
  title,
  value,
  onChange,
  onSave,
  onClose,
  saving,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onClose: () => void;
  saving?: boolean;
}) {
  return (
    <PopupCard title={title} onClose={onClose} maxWidth={460}>
      <Field label="Name" basis={240}>
        <TextInput
          value={value}
          onChangeText={onChange}
          autoFocus
          placeholder="Name"
          placeholderTextColor="#9CA3AF"
          onKeyPress={(e) => {
            const k = readKey(e);
            if (k.key === 'Enter') {
              k.prevent();
              onSave();
            } else if (k.key === 'Escape') {
              k.prevent();
              onClose();
            }
          }}
          className={INPUT}
        />
      </Field>
      <FormActions onCancel={onClose} onSave={onSave} saving={saving} />
    </PopupCard>
  );
}
