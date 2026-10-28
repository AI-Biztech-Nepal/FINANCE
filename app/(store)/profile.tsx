// app/(store)/profile.tsx
import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, Image, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuthStore } from '../../lib/hooks/useAuth';
import { supabase } from '../../lib/supabase';
import { resizeImageForUpload } from '../../lib/utils/resizeImage';
import { builtInLogo } from '../../lib/utils/accountFeatures';
import { AccountSecurityCard } from '../../lib/components/auth/AccountSecurityCard';
import { useSupabaseUpdate } from '../../lib/hooks/useSupabase';
import { showAlert, getErrorMessage } from '../../lib/utils/alert';
import { themeColors } from '../../lib/theme/accent';

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
  // Until one is uploaded, the logo the app keeps for this company (if any) is the one in use.
  const fallbackLogo = logoUrl ? null : builtInLogo(profile?.business_name?.trim() || profile?.full_name);

  // Puts an image on as the logo: made small enough for the bucket, uploaded to the account's own folder,
  // and set on the profile straight away.
  async function uploadLogo(uri: string, width: number | undefined) {
    if (!profile) return;
    setUploading(true);
    try {
      const resizedUri = await resizeImageForUpload(uri, width, 600);
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

  async function pickLogo() {
    if (!profile || uploading) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showAlert('Photo access needed', 'Allow photo library access to add your logo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.9 });
    if (result.canceled || !result.assets[0]) return;
    await uploadLogo(result.assets[0].uri, result.assets[0].width);
  }

  function removeLogo() {
    if (!profile || !logoPath) return;
    showAlert('Remove the logo?', 'The Dashboard goes back to the plain icon until a new one is added.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          try {
            const saved = await update.mutateAsync({ id: profile.id, values: { business_logo_path: null } });
            setProfile(saved);
            setLogoPath(null);
          } catch (err) {
            showAlert('Could not remove logo', getErrorMessage(err));
          }
        },
      },
    ]);
  }

  // On the web an image file can be dragged onto the logo box. React Native has no drop events, so they are
  // put on the box's own element; the handler is read through a ref so it always uploads for this render.
  const dropZone = useRef<View>(null);
  const [dragging, setDragging] = useState(false);
  const onDropFile = useRef<(file: File) => void>(() => {});
  onDropFile.current = (file: File) => {
    if (!file.type.startsWith('image/')) {
      showAlert('Not an image', 'Drop a JPG, PNG or WebP image for the logo.');
      return;
    }
    const url = URL.createObjectURL(file);
    const probe = new window.Image();
    probe.onload = () => void uploadLogo(url, probe.naturalWidth);
    probe.onerror = () => showAlert('Could not read image', 'Try another image file.');
    probe.src = url;
  };
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const node = dropZone.current as unknown as HTMLElement | null;
    if (!node) return;
    const over = (e: DragEvent) => {
      e.preventDefault();
      setDragging(true);
    };
    const leave = () => setDragging(false);
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer?.files?.[0];
      if (file) onDropFile.current(file);
    };
    node.addEventListener('dragover', over);
    node.addEventListener('dragleave', leave);
    node.addEventListener('drop', drop);
    return () => {
      node.removeEventListener('dragover', over);
      node.removeEventListener('dragleave', leave);
      node.removeEventListener('drop', drop);
    };
  }, []);

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
      <Text className="mb-1 text-xs font-semibold text-gray-500">Company logo</Text>
      <View
        ref={dropZone}
        className="mb-4 flex-row items-center rounded-2xl border-2 border-dashed p-4"
        style={{ gap: 16, borderColor: dragging ? themeColors.c600 : '#D1D5DB', backgroundColor: dragging ? themeColors.c50 : '#FFFFFF' }}
      >
        <Pressable
          onPress={pickLogo}
          disabled={uploading}
          className="h-20 w-20 items-center justify-center overflow-hidden rounded-2xl border border-gray-200 bg-gray-50"
        >
          {logoUrl || fallbackLogo ? (
            <Image source={logoUrl ? { uri: logoUrl } : fallbackLogo!} style={{ width: 76, height: 76 }} resizeMode="contain" />
          ) : (
            <Ionicons name="cloud-upload-outline" size={28} color={dragging ? themeColors.c600 : '#9CA3AF'} />
          )}
        </Pressable>
        <View className="flex-1" style={{ gap: 2 }}>
          <Text className="text-[15px] font-bold text-gray-900">
            {uploading ? 'Uploading…' : dragging ? 'Drop to upload' : logoUrl || fallbackLogo ? 'Your company logo' : 'Add your company logo'}
          </Text>
          <Text className="text-xs text-gray-500">
            {Platform.OS === 'web' ? 'Drag and drop an image here, or click to choose one.' : 'Tap to choose an image.'} Shown on your Dashboard.
          </Text>
          <Text className="text-[11px] text-gray-400">JPG, PNG or WebP</Text>
        </View>
        <View style={{ gap: 8 }}>
          <Pressable onPress={pickLogo} disabled={uploading} className="flex-row items-center rounded-lg bg-blue-600 px-3 py-2 disabled:opacity-50" style={{ gap: 6 }}>
            <Ionicons name={logoUrl || fallbackLogo ? 'swap-horizontal' : 'add'} size={15} color="#FFFFFF" />
            <Text className="text-[13px] font-semibold text-white">{logoUrl || fallbackLogo ? 'Change' : 'Choose'}</Text>
          </Pressable>
          {logoUrl && (
            <Pressable onPress={removeLogo} disabled={uploading} className="flex-row items-center rounded-lg border border-gray-300 px-3 py-2 disabled:opacity-50" style={{ gap: 6 }}>
              <Ionicons name="trash-outline" size={15} color="#B91C1C" />
              <Text className="text-[13px] font-semibold text-red-700">Remove</Text>
            </Pressable>
          )}
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
