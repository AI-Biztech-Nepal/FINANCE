// lib/components/finance/KeyInput.tsx
import { useState, type Ref } from 'react';
import { TextInput, type StyleProp, type TextStyle } from 'react-native';
import { readKey, type WebKeyInfo } from '../../utils/webKeys';
import { decimalInput } from '../../utils/number';

/** A plain text/number box for keyboard-driven forms: visible focus ring,
 * select-all on focus (typing replaces the old value), Enter -> `onEnter`,
 * Ctrl+Enter -> `onRequestSave`. */
export function KeyInput({
  value,
  onChangeText,
  inputRef,
  onEnter,
  onRequestSave,
  onKey,
  accent,
  placeholder,
  numeric,
  align,
  accessibilityLabel,
  className,
  style,
}: {
  value: string;
  onChangeText: (v: string) => void;
  inputRef?: Ref<TextInput>;
  onEnter?: () => void;
  onRequestSave?: () => void;
  /** First look at every key, before Enter handling - lets a field claim a key (call k.prevent()). */
  onKey?: (k: WebKeyInfo) => void;
  accent: string;
  placeholder?: string;
  /** Digits and one decimal point only. */
  numeric?: boolean;
  align?: 'left' | 'right';
  accessibilityLabel?: string;
  className?: string;
  style?: StyleProp<TextStyle>;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      ref={inputRef}
      value={value}
      onChangeText={(v) => onChangeText(numeric ? decimalInput(v) : v)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyPress={(e) => {
        const k = readKey(e);
        onKey?.(k);
        if (k.key !== 'Enter') return;
        k.prevent();
        if (k.ctrl) onRequestSave?.();
        else onEnter?.();
      }}
      placeholder={placeholder}
      placeholderTextColor="#B2B8C1"
      keyboardType={numeric ? 'numeric' : 'default'}
      accessibilityLabel={accessibilityLabel}
      selectTextOnFocus
      className={className ?? 'rounded-lg px-3 py-2.5 text-sm font-semibold text-gray-900'}
      style={[
        {
          borderWidth: 1,
          borderColor: focused ? accent : '#D1D5DB',
          backgroundColor: '#FFFFFF',
          textAlign: align ?? 'left',
        },
        focused ? { boxShadow: `0 0 0 3px ${accent}29` } : null,
        { outlineStyle: 'none' } as object,
        style,
      ]}
    />
  );
}
