// app/(store)/profile.tsx
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView } from 'react-native';
import { useAuthStore } from '../../lib/hooks/useAuth';
import { AccountSecurityCard } from '../../lib/components/auth/AccountSecurityCard';
import { useSupabaseUpdate } from '../../lib/hooks/useSupabase';
import { showAlert, getErrorMessage } from '../../lib/utils/alert';

const FIELDS = [
  ['full_name', 'Your name'],
  ['phone', 'Your phone'],
  ['city', 'City'],
  ['business_name', 'Company name (printed on bills)'],
  ['business_address', 'Company address'],
  ['business_phone', 'Company phone'],
  ['business_vat_no', 'VAT / PAN no.'],
  ['business_reg_no', 'Registration no.'],
] as const;
// Asked for when the account is made (see register.tsx), and kept filled in.
const REQUIRED: readonly string[] = ['full_name', 'business_name', 'business_address'];

export default function StoreProfile() {
  const profile = useAuthStore((state) => state.profile);
  const setProfile = useAuthStore((state) => state.setProfile);
  const signOut = useAuthStore((state) => state.signOut);
  const email = useAuthStore((state) => state.session?.user.email);
  const update = useSupabaseUpdate('profiles');
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIELDS.map(([k]) => [k, ((profile as any)?.[k] as string | null) ?? '']))
  );

  async function save() {
    if (!profile) return;
    const missing = FIELDS.filter(([k]) => REQUIRED.includes(k) && !form[k].trim()).map(([, label]) => label.replace(/\s*\(.*\)$/, ''));
    if (missing.length > 0) {
      showAlert('Fill in the required details', `Still needed: ${missing.join(', ')}.`);
      return;
    }
    const values = Object.fromEntries(FIELDS.map(([k]) => [k, form[k].trim() || null]));
    try {
      const saved = await update.mutateAsync({ id: profile.id, values });
      setProfile(saved);
      showAlert('Saved', 'Company details updated.');
    } catch (err) {
      showAlert('Could not save', getErrorMessage(err));
    }
  }

  return (
    <ScrollView className="flex-1 bg-gray-50 px-6 pt-4" contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
      {FIELDS.map(([key, label]) => (
        <View key={key} className="mb-3">
          <Text className="mb-1 text-xs font-semibold text-gray-500">
            {label}
            {REQUIRED.includes(key) && <Text className="text-red-500"> *</Text>}
          </Text>
          <TextInput
            value={form[key]}
            onChangeText={(v) => setForm((f) => ({ ...f, [key]: v }))}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900"
          />
        </View>
      ))}
      <Pressable onPress={save} disabled={update.isPending} className="mt-2 items-center rounded-xl bg-blue-600 py-3.5 disabled:opacity-50">
        <Text className="text-[15px] font-bold text-white">Save</Text>
      </Pressable>
      {email ? <AccountSecurityCard email={email} /> : null}
      <Pressable onPress={signOut} className="mt-3 items-center rounded-xl border border-gray-300 py-3.5">
        <Text className="text-[15px] font-bold text-gray-700">Sign out</Text>
      </Pressable>
    </ScrollView>
  );
}
