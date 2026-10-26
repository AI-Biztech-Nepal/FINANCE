// app/(store)/profile.tsx
import { useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '../../lib/hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { resizeImageForUpload } from '../../lib/utils/resizeImage';
import { AccountSecurityCard } from '../../lib/components/auth/AccountSecurityCard';
import { useSupabaseUpdate } from '../../lib/hooks/useSupabase';
import { showAlert, getErrorMessage } from '../../lib/utils/alert';

const FIELDS = [
  ['full_name', 'Your name', 'name'],
  ['phone', 'Your phone', 'tel'],
  ['city', 'City', 'off'],
  ['business_name', 'Company name (printed on bills)', 'organization'],
  ['business_address', 'Company address', 'street-address'],
  ['business_phone', 'Company phone', 'off'],
  ['business_vat_no', 'VAT / PAN no.', 'off'],
  ['business_reg_no', 'Registration no.', 'off'],
] as const;
// Asked for when the account is made (see register.tsx), and kept filled in.
const REQUIRED: readonly string[] = ['full_name', 'business_name', 'business_address'];

export default function StoreProfile() {
  const profile = useAuthStore((state) => state.profile);
  const setProfile = useAuthStore((state) => state.setProfile);
  const signOut = useAuthStore((state) => state.signOut);
  const email = useAuthStore((state) => state.session?.user.email);
  // What was typed at sign-up: an account made before 0010_signup_company_details.sql ran has its company
  // name and address only here, so the form starts from them until they are saved onto the profile.
  const signupData = useAuthStore((state) => state.session?.user.user_metadata) as Record<string, unknown> | undefined;
  const update = useSupabaseUpdate('profiles');
  const [form, setForm] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      FIELDS.map(([k]) => {
        const saved = ((profile as any)?.[k] as string | null) ?? '';
        const typed = typeof signupData?.[k] === 'string' ? (signupData[k] as string) : '';
        return [k, saved || typed];
      })
    )
  );
  // The company logo, shown on the Dashboard (see 0011_business_assets_bucket.sql). It is put on the profile
  // as soon as it is uploaded - not held back for Save, which waits on the required fields.
  const [logoPath, setLogoPath] = useState<string | null>(profile?.business_logo_path ?? null);
  const [uploading, setUploading] = useState(false);
  const logoUrl = logoPath ? supabase.storage.from('business-assets').getPublicUrl(logoPath).data.publicUrl : null;

  async function pickLogo() {
    if (!profile) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showAlert('Photo access needed', 'Allow photo library access to add your logo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    setUploading(true);
    try {
      const asset = result.assets[0];
      const resizedUri = await resizeImageForUpload(asset.uri, asset.width, 600);
      const arraybuffer = await fetch(resizedUri).then((res) => res.arrayBuffer());
      const path = `${profile.id}/logo-${Date.now()}.jpg`;
      const { error } = await supabase.storage.from('business-assets').upload(path, arraybuffer, { contentType: 'image/jpeg' });
      if (error) throw error;
      const saved = await update.mutateAsync({ id: profile.id, values: { business_logo_path: path } });
      setProfile(saved);
      setLogoPath(path);
    } catch (err) {
      showAlert('Could not upload logo', getErrorMessage(err));
    } finally {
      setUploading(false);
    }
  }

  async function save() {
    if (!profile) return;
    const missing = FIELDS.filter(([k]) => REQUIRED.includes(k) && !form[k].trim()).map(([, label]) => label.replace(/\s*\(.*\)$/, ''));
    if (missing.length > 0) {
      showAlert('Fill in the required details', `Still needed: ${missing.join(', ')}.`);
      return;
    }
    const values = { ...Object.fromEntries(FIELDS.map(([k]) => [k, form[k].trim() || null])), business_logo_path: logoPath };
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
      <View className="mb-4 flex-row items-center gap-4">
        <Pressable
          onPress={pickLogo}
          disabled={uploading}
          className="h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-dashed border-gray-300 bg-white"
        >
          {logoUrl ? (
            <Image source={{ uri: logoUrl }} style={{ width: 80, height: 80 }} resizeMode="contain" />
          ) : (
            <Ionicons name="image-outline" size={26} color="#9CA3AF" />
          )}
        </Pressable>
        <View className="flex-1">
          <Text className="text-base font-bold text-gray-900">Company logo</Text>
          <Text className="mt-0.5 text-xs text-gray-400">
            {uploading ? 'Uploading…' : logoUrl ? 'Tap the logo to replace it' : 'Tap to add - shown on your Dashboard'}
          </Text>
        </View>
      </View>
      {FIELDS.map(([key, label, autoComplete]) => (
        <View key={key} className="mb-3">
          <Text className="mb-1 text-xs font-semibold text-gray-500">
            {label}
            {REQUIRED.includes(key) && <Text className="text-red-500"> *</Text>}
          </Text>
          <TextInput
            value={form[key]}
            onChangeText={(v) => setForm((f) => ({ ...f, [key]: v }))}
            // What the browser may fill in: a saved email never lands in a company field.
            autoComplete={autoComplete}
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
