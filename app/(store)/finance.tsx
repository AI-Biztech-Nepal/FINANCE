// app/(store)/finance.tsx
import { BalanceSheetScreen } from '../../lib/components/finance/BalanceSheetScreen';

export default function FinanceScreen() {
  return <BalanceSheetScreen basePath="/(store)" />;
}
