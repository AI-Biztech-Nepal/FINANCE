// lib/components/ContactPickerModal.tsx
import { useEffect, useState } from 'react';
import { View, TextInput, Pressable, FlatList, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { Text, useCaps } from './finance/CapsText';
import { highlightText } from './finance/Highlight';
import { useConfirmNewParty, type NewPartyKind } from './finance/NewPartyConfirm';
import { Ionicons } from '@expo/vector-icons';
import { buildCustomerSuggestions, type CustomerSuggestion } from '../utils/customerSuggestions';
import { useAuthStore } from '../hooks/useAuth';
import { usePartyTypes } from '../hooks/usePartyTypes';
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
  partyKind = 'customer',
}: {
  visible: boolean;
  initialQuery: string;
  customers: Customer[];
  phoneContacts: PhoneContactEntry[];
  onSelectCustomer: (customer: Customer) => void;
  /** A person who is not saved yet, after the confirmation popup (name, phone, Ledger type) was answered with Add. */
  onSelectNew: (name: string, phone: string | null, partyTypeId: string | null) => void;
  onClose: () => void;
  title?: string;
  placeholder?: string;
  /** Also search the saved customers' phone numbers, not only their names. */
  matchPhone?: boolean;
  /** What the confirmation popup calls the person being added. */
  partyKind?: NewPartyKind;
}) {
  // The Ledger type each person is filed under, shown under their name.
  const userId = useAuthStore((state) => state.session?.user.id);
  const { nameById: partyTypeName } = usePartyTypes(userId);
  const [search, setSearch] = useState(initialQuery);
  // On a page whose words are all capitals (the Ledger) what is typed here is too.
  const caps = useCaps();
  // "Add as a new customer" never saves the instant it's tapped - this window closes and the same confirmation
  // popup as everywhere else opens (name, phone, Ledger type). Only its Add hands the person on; a click outside,
  // Esc or Cancel goes back with nothing saved.
  const { askNewParty, dialog: newPartyDialog } = useConfirmNewParty();

  useEffect(() => {
    if (visible) setSearch(initialQuery);
  }, [visible, initialQuery]);

  const suggestions = buildCustomerSuggestions(customers, phoneContacts, search, undefined, matchPhone);

  function handleSelect(s: CustomerSuggestion) {
    if (s.customer) onSelectCustomer(s.customer);
    else void startAdd(s.name, s.phone);
  }

  async function startAdd(name: string, phone: string | null) {
    // Two popups open at once fight over the keyboard focus, so this window goes first.
    const save = onSelectNew;
    onClose();
    const asked = await askNewParty({ name, kind: partyKind, askPhone: true, phone });
    if (asked) save(asked.name, asked.phone, asked.partyTypeId);
  }

  return (
    <>
      <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <Pressable className="flex-1 items-center justify-center bg-black/40 px-6" onPress={onClose}>
          <Pressable onPress={() => {}} className="w-full max-w-sm rounded-xl bg-white p-3" style={{ maxHeight: '75%' }}>
            <View className="mb-2 flex-row items-center justify-between">
              <Text className="text-base font-semibold text-gray-900">{title}</Text>
              <Pressable onPress={onClose} className="px-2 py-1">
                <Text className="text-sm font-semibold text-blue-700">Close</Text>
              </Pressable>
            </View>
            <TextInput
              value={search}
              onChangeText={setSearch}
              // Enter takes the name that exists: exactly as typed, else the first that starts with it, else the
              // first match. A name nobody has is added with the row below.
              onSubmitEditing={() => {
                const typed = search.trim().toLowerCase();
                if (!typed) return;
                const name = (s: (typeof suggestions)[number]) => s.name.trim().toLowerCase();
                const pick = suggestions.find((s) => name(s) === typed) ?? suggestions.find((s) => name(s).startsWith(typed)) ?? suggestions[0];
                if (pick) handleSelect(pick);
              }}
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
                    <Text className="text-sm font-semibold text-gray-900">{highlightText(s.name, search)}</Text>
                    {!!s.customer?.party_type_id && !!partyTypeName.get(s.customer.party_type_id) && (
                      <Text className="text-[11px] font-medium text-gray-500">{partyTypeName.get(s.customer.party_type_id)}</Text>
                    )}
                    {!!s.phone && <Text className="text-xs text-gray-500">{highlightText(s.phone, search)}</Text>}
                  </View>
                  {!s.customer && <Ionicons name="person-outline" size={14} color="#9CA3AF" />}
                </Pressable>
              )}
              ListEmptyComponent={<Text className="px-2 py-3 text-center text-sm text-gray-400">No matches.</Text>}
              ListFooterComponent={
                search.trim() ? (
                  <Pressable onPress={() => void startAdd(search.trim(), null)} className="flex-row items-center gap-1.5 px-2 py-2.5">
                    <Ionicons name="add-circle-outline" size={15} color="#EA580C" />
                    <Text className="text-sm font-semibold text-orange-600">Add "{search.trim()}" as a new {partyKind}</Text>
                  </Pressable>
                ) : null
              }
            />
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>
      {newPartyDialog}
    </>
  );
}
