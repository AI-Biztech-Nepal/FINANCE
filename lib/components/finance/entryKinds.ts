import { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';

export interface EntryKind {
  key: string;
  label: string;
  menuLabel?: string;
  icon: ComponentProps<typeof Ionicons>['name'];
  color: string;
  path: string;
}

export const ENTRY_KINDS: EntryKind[] = [
  {
    key: 'payment-in',
    label: 'Received',
    icon: 'arrow-down-circle',
    color: '#059669',
    path: '/quick-payment?type=in',
  },
  {
    key: 'payment-out',
    label: 'Paid',
    icon: 'arrow-up-circle',
    color: '#DC2626',
    path: '/quick-payment?type=out',
  },
  {
    key: 'sales',
    label: 'Sales',
    menuLabel: 'Sale',
    icon: 'trending-up',
    color: '#059669',
    path: '/transactions?type=sale&add=1',
  },
  {
    key: 'purchase',
    label: 'Purchase',
    icon: 'cart',
    color: '#DC2626',
    path: '/transactions?type=purchase&add=1',
  },
  {
    key: 'expenses',
    label: 'Expenses',
    menuLabel: 'Expenses',
    icon: 'receipt',
    color: '#DC2626',
    path: '/transactions?type=expense&add=1',
  },
];
