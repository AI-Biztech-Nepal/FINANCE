// lib/components/web/WebSidebarShell.tsx
import { View, Text, Pressable, ScrollView } from 'react-native';
import { router, usePathname, useGlobalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuthStore } from '../../hooks/useAuth';
import { AppLogo } from '../AppLogo';
import { sellsVehicles } from '../../utils/accountFeatures';

export interface WebNavItem {
  href: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  // Sub-links shown nested under this item - for a section like Finance with
  // several destinations (Day Book, Ledger, Report, ...) that would otherwise
  // mean going back to a dashboard and re-picking a shortcut tile every time.
  // The children are always shown, indented one step further each level down:
  // nothing in the side panel opens or closes.
  children?: WebNavItem[];
}

/** One row of the nav list, indented by how deep it sits (0 = Home/Finance,
 * 1 = Finance's own children, 2 = a child's own children, ...), and its
 * children drawn the same way one level deeper, always visible (no dropdown).
 * Defined outside WebSidebarShell so its identity is stable across renders -
 * an inline component here would remount this whole branch (and its children)
 * on every render instead of just updating it. */
function NavRow({ item, depth, isActive }: { item: WebNavItem; depth: number; isActive: (href: string) => boolean }) {
  const active = isActive(item.href);
  const top = depth === 0;

  const color = active ? '#2563EB' : top ? '#6B7280' : '#9CA3AF';
  return (
    <View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderRadius: top ? 10 : 8,
          backgroundColor: active ? '#EFF6FF' : 'transparent',
        }}
      >
        <Pressable
          onPress={() => router.push(item.href as any)}
          accessibilityRole="link"
          accessibilityLabel={item.label}
          accessibilityState={{ selected: active }}
          aria-current={active ? 'page' : undefined}
          style={{
            flex: 1,
            flexDirection: 'row',
            alignItems: 'center',
            gap: top ? 12 : 10,
            paddingVertical: 10,
            paddingLeft: 14 + depth * 20,
            paddingRight: 14,
          }}
        >
          <Ionicons
            name={active ? item.icon : (`${item.icon}-outline` as keyof typeof Ionicons.glyphMap)}
            size={top ? 19 : 15}
            color={color}
          />
          <Text
            numberOfLines={top ? undefined : 1}
            style={{ flex: 1, fontSize: top ? 14 : 13, fontWeight: '600', color: active ? '#2563EB' : '#6B7280' }}
          >
            {item.label}
          </Text>
        </Pressable>
      </View>

      {!!item.children?.length && (
        <View style={{ marginTop: 2, marginBottom: 4, gap: 1 }}>
          {item.children.map((child) => (
            <NavRow key={child.href} item={child} depth={depth + 1} isActive={isActive} />
          ))}
        </View>
      )}
    </View>
  );
}

function initialsOf(name: string | null | undefined) {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

// The content column fills the space beside the sidebar, so the gap on its
// left and right is just the page's own gutter on any laptop or desktop
// screen. The cap only matters on ultra-wide monitors, where an unbounded
// column would stretch a table or chart past readable width.
const CONTENT_MAX_WIDTH = 1840;

// Below this viewport width, each _layout.tsx renders plain Tabs (bottom
// bar and all) instead of this shell - a phone browser hitting the website
// is still "web" (Platform.OS === 'web'), but a 240px sidebar plus content
// squeezed into a ~360-400px phone screen has nowhere near enough room and
// collapses into single characters per line. 768px comfortably fits the
// 240px sidebar plus a readable content column beside it.
export const WEB_SIDEBAR_MIN_WIDTH = 768;

/** Web-only desktop shell: a persistent left sidebar (the same sections as
 * the mobile bottom tabs, always visible) beside the actual screen content.
 * Mobile is untouched - each role's _layout.tsx only reaches for this on
 * Platform.OS === 'web', still rendering plain Tabs (bottom bar and all)
 * everywhere else. The Tabs navigator underneath keeps managing real
 * navigation state/headers/hidden routes exactly as before; this only adds
 * a parallel nav rail beside it and hides the now-redundant bottom bar. */
export function WebSidebarShell({
  items,
  roleLabel,
  profileHref,
  children,
}: {
  items: WebNavItem[];
  roleLabel: string;
  /** Where the account block at the bottom leads (the role's profile screen). */
  profileHref?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useGlobalSearchParams<Record<string, string>>();
  const profile = useAuthStore((state) => state.profile);

  // Several Finance sub-links share one route with a different `type` query
  // param (Payment In/Out both go to quick-payment, Sales/Purchase/Expenses
  // all go to transactions) - usePathname() never includes the query
  // string, so a plain pathname match would light up both Payment In and
  // Payment Out together. Split the query off the href and compare it
  // against the real URL's params too, so only the one actually open highlights.
  //
  // usePathname() also strips route-group segments (e.g. "(reseller)"),
  // while every href here is written the way router.push needs it, group
  // segment included - comparing them as-is against pathname never matched
  // anything, so nothing in this sidebar (not just the new children) ever
  // actually highlighted. Strip the same segments from the href side before
  // comparing.
  function withoutGroups(path: string): string {
    return path.replace(/\/\([^/]+\)/g, '') || '/';
  }

  function isActive(href: string): boolean {
    const [hrefPathRaw, hrefQuery] = href.split('?');
    const hrefPath = withoutGroups(hrefPathRaw);
    const pathMatches = pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
    if (!pathMatches) return false;
    // A link with no query (Transactions) is the plain route - the same route
    // opened with ?type= is one of its siblings (Sales, Purchase, Expenses).
    if (!hrefQuery) return !searchParams.type;
    return Array.from(new URLSearchParams(hrefQuery).entries()).every(
      ([key, value]) => (searchParams[key] ?? '') === value
    );
  }

  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: '#F9FAFB' }}>
      <View
        style={{
          width: 240,
          flexShrink: 0,
          backgroundColor: '#fff',
          borderRightWidth: 1,
          borderRightColor: '#E5E7EB',
          paddingTop: 20,
          paddingBottom: 14,
          paddingHorizontal: 14,
        }}
      >
        {/* The brand mark: the app's own logo and name (DEEVA on Deeva Auto's account). Pressing it goes back to the
            first page of the side panel (the Dashboard). */}
        <Pressable
          onPress={() => items[0] && router.push(items[0].href as never)}
          accessibilityRole="link"
          accessibilityLabel="Go to the dashboard"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 8, marginBottom: 20 }}
        >
          <AppLogo size={34} />
          <Text style={{ fontSize: 15, fontWeight: '800', color: '#111827' }}>
            {sellsVehicles(profile?.business_name?.trim() || profile?.full_name) ? 'DEEVA' : 'Finance Nepal'}
          </Text>
        </Pressable>

        {/* The nav list scrolls on its own (minHeight: 0 lets a flex child
            shrink below its content), so a long open submenu like Finance's
            can never push the account block below the fold - it stays
            pinned at the bottom of the panel instead. */}
        <ScrollView
          style={{ flex: 1, minHeight: 0 }}
          contentContainerStyle={{ gap: 2 }}
          showsVerticalScrollIndicator={false}
        >
          {/* A parent (Finance, Report, ...) is "active" only by its own href, not by
              whichever descendant route is open - that one carries its own highlight
              instead, so the parent doesn't stay lit up while browsing a child. */}
          {items.map((item) => (
            <NavRow key={item.href} item={item} depth={0} isActive={isActive} />
          ))}
        </ScrollView>

        <Pressable
          onPress={profileHref ? () => router.push(profileHref as any) : undefined}
          disabled={!profileHref}
          accessibilityLabel="Account and company details"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            marginTop: 8,
            paddingTop: 12,
            paddingHorizontal: 8,
            borderTopWidth: 1,
            borderTopColor: '#F3F4F6',
          }}
        >
          <View
            style={{
              width: 34,
              height: 34,
              borderRadius: 999,
              backgroundColor: '#2563EB',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: '800', color: '#fff' }}>{initialsOf(profile?.full_name)}</Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: '700', color: '#111827' }}>
              {profile?.full_name ?? 'Account'}
            </Text>
            <Text style={{ fontSize: 12, color: '#6B7280' }}>{roleLabel}</Text>
          </View>
        </Pressable>
      </View>

      {/* `alignItems: 'center'` here (rather than `marginHorizontal: 'auto'`
          on the capped child) made the capped child fall back to
          content-based sizing on react-native-web instead of filling the
          row's remaining space - `flex-row` children collapsed to a sliver
          just wide enough for one category icon, wrapping every subsequent
          word/icon onto its own line. Default `alignItems: 'stretch'` (by
          simply not setting it) lets the child fill available width first,
          then centers within that via auto margins. */}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flex: 1, width: '100%', maxWidth: CONTENT_MAX_WIDTH, marginHorizontal: 'auto' }}>
          {children}
        </View>
      </View>
    </View>
  );
}
