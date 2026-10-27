// lib/components/finance/Highlight.tsx
import type { ReactNode } from 'react';
import { Text } from 'react-native';

/** What a search match looks like: the brand blue on a pale background. */
const MARK = { color: '#1D4ED8', backgroundColor: '#DBEAFE' } as const;

/** `text` with every part that matches what was typed in the search marked - so a search shows why each
 * line is there. Not case-sensitive; with nothing typed (or no match) the text is returned as it is. Put it
 * inside a Text: `<Text>{highlightText(name, search)}</Text>`. */
export function highlightText(text: string | null | undefined, query: string): ReactNode {
  const value = text ?? '';
  const q = query.trim();
  if (!q || !value) return value;
  const lower = value.toLowerCase();
  const needle = q.toLowerCase();
  let at = lower.indexOf(needle);
  if (at < 0) return value;
  const parts: ReactNode[] = [];
  let from = 0;
  let key = 0;
  while (at >= 0) {
    if (at > from) parts.push(value.slice(from, at));
    parts.push(
      <Text key={key++} style={MARK}>
        {value.slice(at, at + needle.length)}
      </Text>
    );
    from = at + needle.length;
    at = lower.indexOf(needle, from);
  }
  if (from < value.length) parts.push(value.slice(from));
  return <>{parts}</>;
}
