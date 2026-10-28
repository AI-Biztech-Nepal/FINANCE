// lib/components/finance/LedgerTypeMenuModal.tsx
import { useState } from 'react';
import { Modal, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Text } from './CapsText';
import { usePartyTypes } from '../../hooks/usePartyTypes';
import { showAlert, getErrorMessage } from '../../utils/alert';
import { themeColors } from '../../theme/accent';

const MAX_NAME_LENGTH = 30;

/**
 * The ledger types as a popup: tap one to give it to the party (or parties) being edited, and
 * manage the list right there - a pencil renames a type, a bin deletes it (its parties are kept,
 * just untyped), and the box at the bottom adds a new one. "No ledger type" clears the type.
 */
export function LedgerTypeMenuModal({
  visible,
  title,
  ownerId,
  selectedId,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  ownerId: string | undefined;
  /** The type ticked now, if any. */
  selectedId?: string | null;
  /** A type's id, or null for "No ledger type". */
  onPick: (id: string | null) => void;
  onClose: () => void;
}) {
  const { types, create, rename, remove } = usePartyTypes(ownerId);
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);

  const outline = { outlineStyle: 'none' } as object;

  async function handleAdd() {
    const name = newName.trim();
    if (!name || busy) return;
    if (types.some((t) => t.name.trim().toLowerCase() === name.toLowerCase())) {
      showAlert('Already there', `"${name}" is already a ledger type.`);
      return;
    }
    setBusy(true);
    try {
      await create(name);
      setNewName('');
    } catch (err) {
      showAlert('Could not add the ledger type', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(id: string) {
    const name = editName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await rename(id, name);
      setEditingId(null);
      queryClient.invalidateQueries({ queryKey: ['party_types'] });
    } catch (err) {
      showAlert('Could not rename the ledger type', getErrorMessage(err, 'A type with that name may already exist.'));
    } finally {
      setBusy(false);
    }
  }

  function confirmRemove(id: string, name: string) {
    showAlert(`Delete "${name}"?`, 'People with this ledger type are kept - they just have no ledger type.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await remove(id);
            queryClient.invalidateQueries({ queryKey: ['party_types'] });
            queryClient.invalidateQueries({ queryKey: ['customers'] });
          } catch (err) {
            showAlert('Could not delete the ledger type', getErrorMessage(err));
          }
        },
      },
    ]);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 items-center justify-center bg-black/40 px-6" onPress={onClose}>
        <Pressable onPress={() => {}} className="w-full max-w-sm rounded-xl bg-white p-3" style={{ maxHeight: '80%' }}>
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="flex-1 text-base font-semibold text-gray-900" numberOfLines={1}>
              {title}
            </Text>
            <Pressable onPress={onClose} className="px-2 py-1">
              <Text className="text-sm font-semibold text-blue-700">Close</Text>
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled">
            {types.map((t) => {
              const on = t.id === selectedId;
              if (editingId === t.id) {
                return (
                  <View key={t.id} className="mb-1.5 flex-row items-center gap-2 rounded-lg border border-blue-200 px-2 py-1.5">
                    <TextInput
                      value={editName}
                      onChangeText={setEditName}
                      onSubmitEditing={() => handleRename(t.id)}
                      autoFocus
                      selectTextOnFocus
                      maxLength={MAX_NAME_LENGTH}
                      accessibilityLabel="Ledger type name"
                      className="flex-1 px-1 py-1.5 text-sm text-gray-900"
                      style={outline}
                    />
                    <Pressable onPress={() => handleRename(t.id)} disabled={busy} hitSlop={6} accessibilityLabel="Save name">
                      <Ionicons name="checkmark-circle" size={22} color="#059669" />
                    </Pressable>
                    <Pressable onPress={() => setEditingId(null)} hitSlop={6} accessibilityLabel="Cancel rename">
                      <Ionicons name="close-circle" size={22} color="#9CA3AF" />
                    </Pressable>
                  </View>
                );
              }
              return (
                <View key={t.id} className="mb-1.5 flex-row items-center rounded-lg border border-gray-100">
                  <Pressable onPress={() => onPick(t.id)} className="flex-1 flex-row items-center gap-2 px-2 py-2.5" accessibilityState={{ selected: on }}>
                    <Ionicons name={on ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={on ? themeColors.c600 : '#D1D5DB'} />
                    <Text className="flex-1 text-sm font-medium text-gray-900" numberOfLines={1}>
                      {t.name}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      setEditingId(t.id);
                      setEditName(t.name);
                    }}
                    hitSlop={6}
                    className="px-2 py-2"
                    accessibilityLabel={`Rename ${t.name}`}
                  >
                    <Ionicons name="pencil" size={16} color="#6B7280" />
                  </Pressable>
                  <Pressable onPress={() => confirmRemove(t.id, t.name)} hitSlop={6} className="px-2 py-2" accessibilityLabel={`Delete ${t.name}`}>
                    <Ionicons name="trash-outline" size={16} color="#DC2626" />
                  </Pressable>
                </View>
              );
            })}
            <Pressable
              onPress={() => onPick(null)}
              className="mb-1.5 flex-row items-center gap-2 rounded-lg border border-gray-100 px-2 py-2.5"
              accessibilityState={{ selected: selectedId == null }}
            >
              <Ionicons name={selectedId == null ? 'checkmark-circle' : 'ellipse-outline'} size={16} color={selectedId == null ? themeColors.c600 : '#D1D5DB'} />
              <Text className="flex-1 text-sm font-medium text-gray-500">No ledger type</Text>
            </Pressable>
          </ScrollView>

          <View className="mt-2 flex-row items-center gap-2 border-t border-gray-100 pt-3">
            <TextInput
              value={newName}
              onChangeText={setNewName}
              onSubmitEditing={handleAdd}
              placeholder="Add a new ledger type"
              placeholderTextColor="#9CA3AF"
              maxLength={MAX_NAME_LENGTH}
              accessibilityLabel="New ledger type"
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
              style={outline}
            />
            <Pressable
              onPress={handleAdd}
              disabled={!newName.trim() || busy}
              className="flex-row items-center gap-1 rounded-lg bg-blue-700 px-3 py-2.5"
              style={{ opacity: !newName.trim() || busy ? 0.5 : 1 }}
              accessibilityLabel="Add ledger type"
            >
              <Ionicons name="add" size={16} color="#FFFFFF" />
              <Text className="text-sm font-semibold text-white">Add</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
