// lib/components/finance/CapsText.tsx
//
// Capital letters for a whole page. The finance building blocks (BookKit, FormKit,
// LedgerUi, ...) are shared by many pages, so they draw their words with this `Text`
// instead of react-native's: it looks exactly the same, except that inside a
// <CapsProvider> every word turns into capitals - popups included, since a context
// travels through a Modal - and a `heading` into Title Case (each word starts with a
// capital) instead. Outside a provider nothing changes.
import { createContext, useContext, type ReactNode } from 'react';
import { Text as NativeText, type TextProps } from 'react-native';

const CapsContext = createContext(false);

export function CapsProvider({ children }: { children: ReactNode }) {
  return <CapsContext.Provider value>{children}</CapsContext.Provider>;
}

/** Whether the words here are capitals - for the few that are not drawn by a `Text`
 * (a text box's placeholder and typed text). */
export function useCaps(): boolean {
  return useContext(CapsContext);
}

export function Text({ style, heading, ...props }: TextProps & {
  /** A heading (a column title, a card's name): Title Case on a page of capitals, not all capitals. */
  heading?: boolean;
}) {
  const caps = useContext(CapsContext);
  return <NativeText {...props} style={caps ? [style, { textTransform: 'capitalize' }] : style} />;
}
