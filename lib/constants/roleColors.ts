// lib/constants/roleColors.ts
import type { UserRole } from '../../types/database.types';

// One shared brand color across every role (Tailwind's orange-500, which is
// overridden to this same blue in tailwind.config.js), so the whole app
// reads as a single consistent brand.
const BRAND_BLUE = '#3b82f6';

export const ROLE_ACCENT: Record<UserRole, string> = {
  store: BRAND_BLUE,
};
