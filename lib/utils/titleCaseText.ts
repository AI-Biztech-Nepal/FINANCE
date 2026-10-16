// lib/utils/titleCaseText.ts
//
// One house style for every word the app shows: the first letter of each word is a capital.
// This puts `textTransform: 'capitalize'` under every <Text> as its default, so a screen only
// has to set its own textTransform (or a `uppercase` / `lowercase` class) to differ. It changes
// how the text is drawn, never the text itself - what is saved and searched stays as typed.
// Imported once, first thing, from the root layout.
import { Text } from 'react-native';

const patched = Text as unknown as {
  render?: (props: { style?: unknown }, ref: unknown) => unknown;
  __titleCased?: boolean;
};

if (patched.render && !patched.__titleCased) {
  const original = patched.render;
  patched.render = function render(this: unknown, props, ref) {
    return original.call(this, { ...props, style: [{ textTransform: 'capitalize' }, props.style] }, ref);
  };
  patched.__titleCased = true;
}
