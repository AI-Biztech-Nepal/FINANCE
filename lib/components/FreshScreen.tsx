// lib/components/FreshScreen.tsx
import { Fragment, useEffect, useRef, useState, type ComponentProps, type ReactElement } from 'react';
import type { Tabs } from 'expo-router';
import { queryClient } from '../providers/QueryProvider';

// The pages are tab screens, and a tab screen stays mounted when you go to another one. So a page
// you left - what was typed in its search, the headings it had open, a popup, the date it was set to,
// the figures it read - was all still there, exactly as it was, when you came back to it.
//
// This wraps every page of a portal so that coming back to one is a fresh start: the page is built
// again from nothing, and what it shows is read again (the figures are current, not what they were
// when you left).
//
// A page that has been left is also taken off the screen, not just hidden: a popup or a card it had
// open belongs to it, and would otherwise stay over the page you went to.
type ScreenLayout = NonNullable<ComponentProps<typeof Tabs>['screenLayout']>;
type LayoutProps = Parameters<ScreenLayout>[0];

/** Pages that decide for themselves when to start again: the Ledger's own pages keep what is open
 * while you move between them (list -> a person -> back) and start again only once the whole
 * Ledger has been left - see useFreshLedgerArea. */
const OWN_RULES = new Set(['customers', 'customer/[id]', 'party-report']);

function FreshScreen({ navigation, children }: { navigation: LayoutProps['navigation']; children: ReactElement }) {
  // Changes each time the page is come back to; it is the key of everything inside the page.
  const [visit, setVisit] = useState(0);
  // Whether this is the page being shown. A page that is left is not kept behind: it is taken out, with
  // everything it had open, and built again when it is come back to.
  const [shown, setShown] = useState(() => navigation.isFocused());
  // Set when the page is left, so the focus that follows is a return and not the page's first showing.
  const left = useRef(false);

  useEffect(() => {
    const onBlur = navigation.addListener('blur', () => {
      left.current = true;
      setShown(false);
    });
    const onFocus = navigation.addListener('focus', () => {
      if (left.current) {
        left.current = false;
        // Everything read so far is out of date; the page built again below reads what it needs anew.
        queryClient.invalidateQueries({ refetchType: 'none' });
        setVisit((v) => v + 1);
      }
      setShown(true);
    });
    return () => {
      onBlur();
      onFocus();
    };
  }, [navigation]);

  return shown ? <Fragment key={visit}>{children}</Fragment> : null;
}

/** The `screenLayout` of a portal's Tabs: every page starts fresh when it is come back to. */
export const freshScreenLayout: ScreenLayout = ({ route, navigation, children }) =>
  OWN_RULES.has(route.name) ? children : <FreshScreen navigation={navigation}>{children}</FreshScreen>;
