// lib/components/finance/ConfirmSave.tsx
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import { FINANCE_ENTRY_ACCENT } from './entryTheme';

export interface ConfirmSaveOptions {
  title: string;
  /** A short summary of what is about to be saved (kept to a handful of lines). */
  rows?: { label: string; value?: string }[];
  /** `color` tints the figure - green for money in, red for money out (see moneyColors). */
  total?: { label: string; value: string; color?: string };
  confirmLabel?: string;
}

export function DialogButton({
  label,
  onPress,
  primary,
  disabled,
  buttonRef,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
  buttonRef?: (el: View | null) => void;
}) {
  const [focused, setFocused] = useState(false);
  const accent = FINANCE_ENTRY_ACCENT;
  return (
    <Pressable
      ref={buttonRef}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      accessibilityRole="button"
      className="flex-1 items-center rounded-xl py-3"
      style={[
        primary
          ? { backgroundColor: accent }
          : { backgroundColor: '#fff', borderWidth: 1, borderColor: '#D1D5DB' },
        focused ? { boxShadow: `0 0 0 3px ${accent}40` } : null,
        disabled ? { opacity: 0.5 } : null,
        { outlineStyle: 'none' } as object,
      ]}
    >
      <Text className="text-sm font-bold" style={{ color: primary ? '#fff' : '#4B5563' }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** The question itself - title, summary, total, Cancel / Yes, save - with no modal
 * around it. A screen that is already showing its own dialog asks in place with
 * this instead of stacking a second modal on top: React Native Web's modals each
 * trap keyboard focus, and two of them fight over it, so Enter would never
 * reach the Save button. */
export function ConfirmSaveCard({
  options,
  onConfirm,
  onCancel,
}: {
  options: ConfirmSaveOptions;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const saveButton = useRef<View | null>(null);
  // Enter should confirm straight away - the safe, expected key here - so the
  // primary button takes focus as soon as the dialog is up.
  useEffect(() => {
    const t = setTimeout(() => (saveButton.current as unknown as { focus?: () => void } | null)?.focus?.(), 60);
    return () => clearTimeout(t);
  }, []);

  return (
    <View accessibilityRole="alert">
      <Text className="text-lg font-extrabold text-gray-900">{options.title}</Text>
      <Text className="mt-1 text-sm text-gray-500">Please check the details before saving.</Text>

      {!!options.rows?.length && (
        <View className="mt-4 rounded-xl bg-gray-50 px-4 py-2">
          {options.rows.map((r, i) => (
            <View
              key={`${r.label}-${i}`}
              className={`flex-row items-center justify-between py-2 ${i < options.rows!.length - 1 ? 'border-b border-gray-200' : ''}`}
              style={{ gap: 12 }}
            >
              <Text className="flex-1 text-[13px] text-gray-500" numberOfLines={1}>
                {r.label}
              </Text>
              {!!r.value && (
                <Text className="text-[13px] font-semibold text-gray-900" numberOfLines={1} style={{ maxWidth: '60%' }}>
                  {r.value}
                </Text>
              )}
            </View>
          ))}
        </View>
      )}

      {options.total && (
        <View className="mt-3 flex-row items-baseline justify-between px-1">
          <Text className="text-sm font-bold text-gray-900">{options.total.label}</Text>
          <Text className="text-xl font-extrabold" style={{ color: options.total.color ?? FINANCE_ENTRY_ACCENT }}>
            {options.total.value}
          </Text>
        </View>
      )}

      <View className="mt-5 flex-row" style={{ gap: 10 }}>
        <DialogButton label="Cancel" onPress={onCancel} />
        <DialogButton
          label={options.confirmLabel ?? 'Yes, save'}
          onPress={onConfirm}
          primary
          buttonRef={(el) => {
            saveButton.current = el;
          }}
        />
      </View>
    </View>
  );
}

function ConfirmSaveDialog({
  options,
  onConfirm,
  onCancel,
}: {
  options: ConfirmSaveOptions;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable className="flex-1 items-center justify-center bg-black/40 px-6" onPress={onCancel}>
        <Pressable
          onPress={() => {}}
          className="w-full rounded-2xl bg-white p-5"
          style={{ maxWidth: 400, boxShadow: '0 20px 50px rgba(16,24,40,0.25)' }}
        >
          <ConfirmSaveCard options={options} onConfirm={onConfirm} onCancel={onCancel} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** `const { confirm, dialog } = useConfirmSave()` - `await confirm({...})` right
 * before a save resolves true on "Yes, save" and false on Cancel / Esc / a tap
 * outside; render `{dialog}` anywhere in the screen. If it was cancelled, the
 * caret goes back to whichever field the user was in. */
export function useConfirmSave(): { confirm: (options: ConfirmSaveOptions) => Promise<boolean>; dialog: ReactNode } {
  const [pending, setPending] = useState<{ options: ConfirmSaveOptions; resolve: (ok: boolean) => void } | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const returnFocusTo = useRef<HTMLElement | null>(null);

  const confirm = useCallback((options: ConfirmSaveOptions) => {
    // A second save press while the dialog is already up must not stack another.
    if (pendingRef.current) return Promise.resolve(false);
    returnFocusTo.current = Platform.OS === 'web' ? ((document.activeElement as HTMLElement | null) ?? null) : null;
    return new Promise<boolean>((resolve) => setPending({ options, resolve }));
  }, []);

  const finish = (ok: boolean) => {
    pending?.resolve(ok);
    setPending(null);
    if (!ok) setTimeout(() => returnFocusTo.current?.focus?.(), 0);
  };

  const dialog = pending ? (
    <ConfirmSaveDialog options={pending.options} onConfirm={() => finish(true)} onCancel={() => finish(false)} />
  ) : null;

  return { confirm, dialog };
}
