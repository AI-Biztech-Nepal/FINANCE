// app/(store)/stock.tsx
import { InventoryScreen } from '../../lib/components/finance/InventoryScreen';

// Stock: the Inventory list with only what is still in hand (a vehicle account's Finance page - see _layout.tsx).
export default function StoreStock() {
  return <InventoryScreen basePath="/(store)" inStockOnly />;
}
