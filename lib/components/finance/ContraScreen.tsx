// lib/components/finance/ContraScreen.tsx
import { View, Text, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { useScreenHeader } from '../../hooks/useScreenHeader';
import { TransferForm } from './BankBalancesScreen';

/** Contra - money moved between your own accounts (cash and banks) - as a page of its own, laid out like
 * the other entry forms. */
export function ContraScreen({ basePath }: { basePath: string }) {
  const userId = useAuthStore((state) => state.ownerId ?? undefined);
  useScreenHeader({ title: 'Contra', resetTitle: 'Contra' }, []);
  const leave = () => (router.canGoBack() ? router.back() : router.replace(`${basePath}/daybook` as never));
  return (
    <ScrollView className="flex-1 bg-gray-50" contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
      <View className="px-4 pt-5 md:px-8 md:pt-6">
        <View
          className="rounded-2xl border border-gray-200 bg-white px-5 py-5"
          style={{ maxWidth: 900, gap: 12, boxShadow: '0 1px 2px rgba(16,24,40,0.04), 0 4px 12px rgba(16,24,40,0.03)' }}
        >
          <View className="flex-row items-center" style={{ gap: 8 }}>
            <Ionicons name="swap-horizontal" size={14} color="#6B7280" />
            <Text className="text-[11px] font-bold uppercase tracking-wider text-gray-500">Contra</Text>
          </View>
          {userId ? <TransferForm bare userId={userId} onDone={leave} /> : null}
        </View>
      </View>
    </ScrollView>
  );
}
