// app/(auth)/register.tsx
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ScrollView, KeyboardAvoidingView, Platform, Keyboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Link, router } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { AppLogo } from '../../lib/components/AppLogo';
import { PasswordInput } from '../../lib/components/auth/PasswordInput';
import { authErrorMessage, authRedirectUrl, isValidEmail, normalizeEmail, passwordIssue } from '../../lib/utils/authFlow';
import { showAlert } from '../../lib/utils/alert';

export default function Register() {
  const [fullName, setFullName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // On some Android devices KeyboardAvoidingView's automatic resize doesn't
  // kick in (edge-to-edge layouts can make its measurement unreliable), so
  // track the keyboard's real height directly and pad the scroll content by
  // that amount - that guarantees the fields stay reachable by scrolling.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  async function handleRegister() {
    const trimmedEmail = normalizeEmail(email);
    if (!fullName.trim()) {
      showAlert('Add your name', 'Enter your full name so others know who they are dealing with.');
      return;
    }
    if (!address.trim()) {
      showAlert('Add your address', 'Enter your address - it is printed on your bills.');
      return;
    }
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length < 7 || phoneDigits.length > 15) {
      showAlert('Check your phone number', 'Enter a valid phone number, e.g. 98XXXXXXXX.');
      return;
    }
    if (!isValidEmail(trimmedEmail)) {
      showAlert('Check your email', 'Enter a valid email address, e.g. you@example.com.');
      return;
    }
    const issue = passwordIssue(password);
    if (issue) {
      showAlert('Choose a stronger password', issue);
      return;
    }

    setIsSubmitting(true);
    const { data, error } = await supabase.auth.signUp({
      email: trimmedEmail,
      password,
      // The company name (optional), address and phone go onto the new profile with the name (see
      // 0010_signup_company_details.sql and 0022_signup_phone.sql).
      options: {
        data: {
          full_name: fullName.trim(),
          business_name: companyName.trim(),
          business_address: address.trim(),
          business_phone: phone.trim(),
          phone: phone.trim(),
        },
        emailRedirectTo: authRedirectUrl(),
      },
    });
    setIsSubmitting(false);

    if (error) {
      showAlert('Registration failed', authErrorMessage(error));
      return;
    }
    // With "Confirm email" switched off in Supabase, signUp signs the person
    // in on the spot - nothing to verify.
    if (data.session) {
      router.replace('/');
      return;
    }
    // For an address that already has an account Supabase doesn't error: it
    // returns a user with no identities and sends no email. Without this
    // check the next screen would wait for a code that is never coming.
    if (data.user?.identities?.length === 0) {
      showAlert('You already have an account', 'Sign in instead, or reset your password if you’ve forgotten it.');
      return;
    }
    router.replace({ pathname: '/(auth)/verify-email', params: { email: trimmedEmail } });
  }

  return (
    <KeyboardAvoidingView className="flex-1 bg-white" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, padding: 24, paddingTop: 64, paddingBottom: 24 + keyboardHeight }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="mb-5 items-center">
          <AppLogo size={100} />
        </View>
        <Text className="mb-6 text-center text-2xl font-extrabold text-gray-900">Create your account</Text>

        <Text className="mb-1.5 text-xs font-semibold text-gray-500">
          Your name<Text className="text-red-500"> *</Text>
        </Text>
        <TextInput
          value={fullName}
          onChangeText={setFullName}
          placeholder="Your name"
          placeholderTextColor="#9CA3AF"
          className="mb-3.5 rounded-xl border-[1.5px] border-gray-200 px-4 py-3.5 text-sm text-gray-900"
        />

        <Text className="mb-1.5 text-xs font-semibold text-gray-500">
          Company name<Text className="font-normal text-gray-400"> (optional)</Text>
        </Text>
        <TextInput
          value={companyName}
          onChangeText={setCompanyName}
          placeholder="Printed on your bills (optional)"
          placeholderTextColor="#9CA3AF"
          className="mb-3.5 rounded-xl border-[1.5px] border-gray-200 px-4 py-3.5 text-sm text-gray-900"
        />

        <Text className="mb-1.5 text-xs font-semibold text-gray-500">
          Address<Text className="text-red-500"> *</Text>
        </Text>
        <TextInput
          value={address}
          onChangeText={setAddress}
          placeholder="Your address"
          placeholderTextColor="#9CA3AF"
          className="mb-3.5 rounded-xl border-[1.5px] border-gray-200 px-4 py-3.5 text-sm text-gray-900"
        />

        <Text className="mb-1.5 text-xs font-semibold text-gray-500">
          Phone number<Text className="text-red-500"> *</Text>
        </Text>
        <TextInput
          value={phone}
          onChangeText={setPhone}
          autoComplete="tel"
          keyboardType="phone-pad"
          placeholder="98XXXXXXXX"
          placeholderTextColor="#9CA3AF"
          className="mb-3.5 rounded-xl border-[1.5px] border-gray-200 px-4 py-3.5 text-sm text-gray-900"
        />

        <Text className="mb-1.5 text-xs font-semibold text-gray-500">
          Email<Text className="text-red-500"> *</Text>
        </Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          keyboardType="email-address"
          placeholder="you@example.com"
          placeholderTextColor="#9CA3AF"
          className="mb-3.5 rounded-xl border-[1.5px] border-gray-200 px-4 py-3.5 text-sm text-gray-900"
        />

        <Text className="mb-1.5 text-xs font-semibold text-gray-500">Password</Text>
        <PasswordInput value={password} onChangeText={setPassword} autoComplete="new-password" textContentType="newPassword" />
        <Text className="mb-6 mt-1.5 text-[11px] text-gray-400">At least 8 characters, with letters and numbers.</Text>

        <Pressable
          onPress={handleRegister}
          disabled={isSubmitting}
          className="mb-4 items-center rounded-xl bg-orange-500 py-3.5 disabled:opacity-50"
        >
          <Text className="text-[15px] font-bold text-white">
            {isSubmitting ? 'Creating account…' : 'Create account'}
          </Text>
        </Pressable>

        <Link href="/(auth)/login" className="text-center text-[12.5px] text-gray-500">
          Already have an account? <Text className="font-bold text-orange-600">Sign in</Text>
        </Link>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
