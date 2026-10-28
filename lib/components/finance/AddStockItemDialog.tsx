// lib/components/finance/AddStockItemDialog.tsx
import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';
import { DialogButton } from './ConfirmSave';
import { KeyInput } from './KeyInput';
import { entryAccent } from './entryTheme';

/** "Add new stock item" - the popup behind the dropdown's "+ Add ... as new
 * stock item" row. Nothing is created until Save; Cancel (or Esc, or a click
 * outside) leaves the bill line exactly as it was typed. Enter walks Name >
 * Cost rate > Save, so it stays usable from the keyboard. */
export function AddStockItemDialog({
  sale,
  initialName,
  initialRate,
  saveLabel = 'Save',
  onSave,
  onCancel,
}: {
  /** From a Sale the rate is a selling price and the quantity comes off the stock; from a Purchase, a cost and it goes on. */
  sale?: boolean;
  initialName: string;
  initialRate: string;
  /** The words on the button that adds the item. */
  saveLabel?: string;
  onSave: (name: string, rate: string) => void;
  onCancel: () => void;
}) {
  const accent = entryAccent();
  const [name, setName] = useState(initialName);
  const [rate, setRate] = useState(initialRate);
  const nameRef = useRef<TextInput>(null);
  const rateRef = useRef<TextInput>(null);
  const canSave = name.trim().length > 0;

  // The name is already filled in from what was typed, so the caret starts on
  // the one thing left to add.
  useEffect(() => {
    const t = setTimeout(() => rateRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, []);

  function submit() {
    if (!canSave) {
      nameRef.current?.focus();
      return;
    }
    onSave(name.trim(), rate.trim());
  }

  function onKey(k: { key: string; prevent: () => void }) {
    if (k.key === 'Escape') {
      k.prevent();
      onCancel();
    }
  }

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable className="flex-1 items-center justify-center bg-black/40 px-6" onPress={onCancel}>
        <Pressable
          onPress={() => {}}
          className="w-full rounded-2xl bg-white p-5"
          style={{ maxWidth: 400, boxShadow: '0 20px 50px rgba(16,24,40,0.25)' }}
        >
          <Text className="text-lg font-extrabold text-gray-900">Add new stock item</Text>
          <Text className="mt-1 text-sm text-gray-500">
            {sale
              ? "It is added to your Inventory with 0 in stock. This bill's quantity is taken off when you save the bill."
              : "It is added to your Inventory with 0 in stock. This bill's quantity is added when you save the bill."}
          </Text>

          <Text className="mb-1.5 mt-4 text-xs font-semibold text-gray-600">Item name</Text>
          <KeyInput
            value={name}
            onChangeText={setName}
            inputRef={nameRef}
            onEnter={() => rateRef.current?.focus()}
            onKey={onKey}
            accent={accent}
            placeholder="Item name"
            accessibilityLabel="Item name"
          />

          <Text className="mb-1.5 mt-3 text-xs font-semibold text-gray-600">
            {sale ? 'Selling rate (NPR) - optional' : 'Cost rate (NPR) - optional'}
          </Text>
          <KeyInput
            value={rate}
            onChangeText={setRate}
            inputRef={rateRef}
            onEnter={submit}
            onKey={onKey}
            accent={accent}
            placeholder="0"
            numeric
            align="right"
            accessibilityLabel={sale ? 'Selling rate' : 'Cost rate'}
          />

          <View className="mt-5 flex-row" style={{ gap: 10 }}>
            <DialogButton label="Cancel" onPress={onCancel} />
            <DialogButton label={saveLabel} onPress={submit} primary disabled={!canSave} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
