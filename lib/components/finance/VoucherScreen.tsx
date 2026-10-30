// lib/components/finance/VoucherScreen.tsx
import { View, Text, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useScreenHeader } from '../../hooks/useScreenHeader';
import { JournalVoucherForm } from './JournalVoucherForm';

/** The Journal Voucher as a page of its own, laid out like the Sale / Purchase / Payment forms:
 * a white card on the grey page, with the voucher's date, its debit and credit lines and the total. */
export function VoucherScreen({ basePath }: { basePath: string }) {
  const userId = useAuthStore((state) => state.ownerId ?? undefined);
  useScreenHeader({ title: 'Journal Voucher', resetTitle: 'Journal Voucher' }, []);
  const leave = () => (router.canGoBack() ? router.back() : router.replace(`${basePath}/daybook` as never));
  return (
    <ScrollView className="flex-1 bg-gray-50" contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <View className="px-4 pt-5 md:px-8 md:pt-6">
        <View
          className="rounded-2xl border border-gray-200 bg-white px-5 py-5"
          style={{ maxWidth: 1100, gap: 12, boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.03)' }}
        >
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <Ionicons name="document-text-outline" size={14} color="#6B7280" />
            <Text className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Journal voucher</Text>
          </View>
          {userId ? <JournalVoucherForm ownerId={userId} onDone={leave} /> : null}
        </View>
      </View>
    </ScrollView>
  );
}
