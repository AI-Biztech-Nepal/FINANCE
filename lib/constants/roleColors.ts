// lib/constants/roleColors.ts
import type { UserRole } from '../../types/database.types';
import { themeColors } from '../theme/accent';

// One shared brand color across every role (Tailwind's orange-500, which is
// overridden to the account's accent in tailwind.config.js - blue, or green for
// an account with its own colour), so the whole app reads as a single
// consistent brand. Read when used, not kept: the accent is only known once
// the account has signed in.
export const ROLE_ACCENT: Record<UserRole, string> = {
  get store() {
    return themeColors.c500;
  },
};
