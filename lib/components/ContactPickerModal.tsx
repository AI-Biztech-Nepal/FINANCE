// lib/components/ContactPickerModal.tsx
import { useEffect, useState } from 'react';
import { View, TextInput, Pressable, FlatList, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, useCaps } from './finance/CapsText';
import { Ionicons } from '@expo/vector-icons';
import { buildCustomerSuggestions, type CustomerSuggestion } from '../utils/customerSuggestions';
import type { Customer } from '../../types/database.types';
import type { PhoneContactEntry } from '../hooks/usePhoneContacts';

/** Explicit popup for picking a customer name, opened by tapping a
 * customer-name field (see onFocus wiring at each call site) rather than
 * an inline dropdown that expanded on its own - that felt like it was
 * opening itself. Merges saved customers with phone contacts, and always
 * offers "Add as new customer" for whatever's currently typed. */
export function ContactPickerModal({
  visible,
  initialQuery,
  customers,
  phoneContacts,
  onSelectCustomer,
  onSelectNew,
  onClose,
  title = 'Pick a customer',
  placeholder = 'Search saved customers or phone contacts',
  matchPhone,
  onAddNewTyped,
}: {
  visible: boolean;
  initialQuery: string;
  customers: Customer[];
  phoneContacts: PhoneContactEntry[];
  onSelectCustomer: (customer: Customer) => void;
  onSelectNew: (name: string, phone: string | null) => void;
  onClose: () => void;
  title?: string;
  placeholder?: string;
  /** Also search the saved customers' phone numbers, not only their names. */
  matchPhone?: boolean;
  /** When given, "Add "x" as a new customer" hands the typed name to this straight away,
   * instead of opening this popup's own name / phone step. */
  onAddNewTyped?: (name: string) => void;
}) {
  const [search, setSearch] = useState(initialQuery);
  // On a page whose words are all capitals (the Ledger) what is typed here is too.
  const caps = useCaps();
  // "Add as a new customer" no longer saves the instant it's tapped - it
  // switches this popup to a small confirm step (name + optional phone,
  // Save/Cancel) so a stray tap or typo doesn't silently create a customer.
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');

  useEffect(() => {
    if (visible) {
      setSearch(initialQuery);
      setAddingNew(false);
      setNewPhone('');
    }
  }, [visible, initialQuery]);

  const suggestions = buildCustomerSuggestions(customers, phoneContacts, search, undefined, matchPhone);

  function handleSelect(s: CustomerSuggestion) {
    if (s.customer) {
      onSelectCustomer(s.customer);
    } else {
      setNewName(s.name);
      setNewPhone(s.phone ?? '');
      setAddingNew(true);
    }
  }

  function handleSaveNew() {
    if (!newName.trim()) return;
    onSelectNew(newName.trim(), newPhone.trim() || null);
    setAddingNew(false);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
      <Pressable className="flex-1 items-center justify-center bg-black/40 px-6" onPress={onClose}>
        <Pressable onPress={() => {}} className="w-full max-w-sm rounded-xl bg-white p-3" style={{ maxHeight: '75%' }}>
          {addingNew ? (
            <>
              <View className="mb-2 flex-row items-center justify-between">
                <Text className="text-base font-semibold text-gray-900">Add new customer</Text>
              </View>
              <Text className="mb-1 text-xs font-medium text-gray-500">Name</Text>
              <TextInput
                value={newName}
                onChangeText={setNewName}
                placeholder="Customer name"
                autoFocus
                className="mb-3 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              />
              <Text className="mb-1 text-xs font-medium text-gray-500">Phone (optional)</Text>
              <TextInput
                value={newPhone}
                onChangeText={setNewPhone}
                placeholder="98XXXXXXXX"
                keyboardType="phone-pad"
                className="mb-4 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
              />
              <View className="flex-row gap-2">
                <Pressable
                  onPress={() => setAddingNew(false)}
                  className="flex-1 items-center rounded-lg border border-gray-300 py-2.5"
                >
                  <Text className="text-sm font-semibold text-gray-600">Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={handleSaveNew}
                  disabled={!newName.trim()}
                  className="flex-1 items-center rounded-lg bg-blue-600 py-2.5 disabled:opacity-40"
                >
                  <Text className="text-sm font-semibold text-white">Save</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <>
              <View className="mb-2 flex-row items-center justify-between">
                <Text className="text-base font-semibold text-gray-900">{title}</Text>
                <Pressable onPress={onClose} className="px-2 py-1">
                  <Text className="text-sm font-semibold text-blue-700">Close</Text>
                </Pressable>
              </View>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder={placeholder}
                autoFocus
                className="mb-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                style={caps ? { textTransform: 'capitalize' } : undefined}
              />
              <FlatList
                data={suggestions}
                keyExtractor={(s) => s.key}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item: s }) => (
                  <Pressable onPress={() => handleSelect(s)} className="flex-row items-center justify-between border-b border-gray-100 px-2 py-2.5">
                    <View>
                      <Text className="text-sm font-semibold text-gray-900">{s.name}</Text>
                      {!!s.phone && <Text className="text-xs text-gray-500">{s.phone}</Text>}
                    </View>
                    {!s.customer && <Ionicons name="person-outline" size={14} color="#9CA3AF" />}
                  </Pressable>
                )}
                ListEmptyComponent={<Text className="px-2 py-3 text-center text-sm text-gray-400">No matches.</Text>}
                ListFooterComponent={
                  search.trim() ? (
                    <Pressable
                      onPress={() => {
                        if (onAddNewTyped) {
                          onAddNewTyped(search.trim());
                          return;
                        }
                        setNewName(search.trim());
                        setNewPhone('');
                        setAddingNew(true);
                      }}
                      className="flex-row items-center gap-1.5 px-2 py-2.5"
                    >
                      <Ionicons name="add-circle-outline" size={15} color="#EA580C" />
                      <Text className="text-sm font-semibold text-orange-600">Add "{search.trim()}" as a new customer</Text>
                    </Pressable>
                  ) : null
                }
              />
            </>
          )}
        </Pressable>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}
