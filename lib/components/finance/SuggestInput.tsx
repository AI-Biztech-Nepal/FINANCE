// lib/components/finance/SuggestInput.tsx
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, TextInput, View, type StyleProp, type TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { readKey } from '../../utils/webKeys';
import { highlightText } from './Highlight';

export interface SuggestOption {
  key: string;
  label: string;
  hint?: string | null;
  /** 'add' draws the row as a "+ Add ..." action instead of a match. */
  kind?: 'add';
}

export type PickVia = 'enter' | 'tab' | 'click';

interface Props {
  value: string;
  onChangeText: (v: string) => void;
  /** Already filtered for the current text - shown while the box is focused and non-empty. */
  options: SuggestOption[];
  onSelectOption: (option: SuggestOption, via: PickVia) => void;
  inputRef?: (el: TextInput | null) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  /** Called for every key the suggestion list didn't consume (Enter, arrows...). */
  onKeyPress?: (e: unknown) => void;
  placeholder?: string;
  accessibilityLabel?: string;
  autoFocus?: boolean;
  accent: string;
  inputClassName?: string;
  inputStyle?: StyleProp<TextStyle>;
  /** Small indicator drawn inside the right edge of the box. */
  adornment?: ReactNode;
  adornmentWidth?: number;
  /** One text size down in the suggestion list (the box's own size comes from `inputClassName`). */
  compact?: boolean;
  /** Show the list as soon as the box is focused, even before anything is typed (a pick-from-all box). */
  showWhenEmpty?: boolean;
  /** Enter on a name nobody has takes the list's "Add ... as new" row - the owner then asks for confirmation -
   * instead of passing the typed name on unchecked. */
  enterAddsNew?: boolean;
}

/** A text box with a typeahead list that is fully driven from the keyboard:
 * type to filter, Up/Down to highlight, Enter (or Tab) to take the highlighted
 * suggestion, Esc to dismiss. Anything else is passed on to `onKeyPress`, so
 * the owner can layer its own navigation (Enter = next cell, ...) on top. */
export function SuggestInput({
  value,
  onChangeText,
  options,
  onSelectOption,
  inputRef,
  onFocus,
  onBlur,
  onKeyPress,
  placeholder,
  accessibilityLabel,
  autoFocus,
  accent,
  inputClassName,
  inputStyle,
  adornment,
  adornmentWidth = 0,
  compact,
  showWhenEmpty,
  enterAddsNew,
}: Props) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(-1);

  const visible = open && (showWhenEmpty || value.trim().length > 0) && options.length > 0;
  const activeIndex = Math.min(index, options.length - 1);

  function choose(option: SuggestOption, via: PickVia) {
    setOpen(false);
    setIndex(-1);
    onSelectOption(option, via);
  }

  // Nothing highlighted with the arrows: Enter / Tab still takes the name typed when it exists - exactly as typed -
  // so it never has to be picked by hand. A name that only starts like one that exists is not taken: it may be a
  // new name. (An "Add ... as new" row is not a name that exists, so it is never taken this way.)
  function autoPick(): SuggestOption | undefined {
    const typed = value.trim().toLowerCase();
    // Nothing typed (a list opened on an empty box): Enter just moves on.
    if (!typed) return undefined;
    return options.find((o) => o.kind !== 'add' && o.label.trim().toLowerCase() === typed);
  }

  function handleKeyPress(e: unknown) {
    const k = readKey(e);
    if (visible) {
      if (k.key === 'ArrowDown') {
        k.prevent();
        setIndex(Math.min(activeIndex + 1, options.length - 1));
        return;
      }
      if (k.key === 'ArrowUp' && activeIndex >= 0) {
        k.prevent();
        setIndex(activeIndex - 1);
        return;
      }
      if (k.key === 'Enter' && !k.ctrl) {
        const pick = activeIndex >= 0 ? options[activeIndex] : autoPick();
        if (pick) {
          k.prevent();
          choose(pick, 'enter');
          return;
        }
        // A name nobody has: Enter asks to add it, rather than letting it through unchecked.
        const add = enterAddsNew && activeIndex < 0 ? options.find((o) => o.kind === 'add') : undefined;
        if (add) {
          k.prevent();
          choose(add, 'enter');
          return;
        }
      }
      if (k.key === 'Tab' && !k.shift) {
        const pick = activeIndex >= 0 ? options[activeIndex] : autoPick();
        if (pick) {
          choose(pick, 'tab');
          return;
        }
      }
      if (k.key === 'Escape') {
        k.prevent();
        setOpen(false);
        return;
      }
    }
    onKeyPress?.(e);
  }

  return (
    <View style={{ minWidth: 0, zIndex: visible ? 40 : 0 }}>
      <View style={{ justifyContent: 'center' }}>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={(v) => {
            setOpen(true);
            setIndex(-1);
            onChangeText(v);
          }}
          onFocus={() => {
            setOpen(true);
            setIndex(-1);
            onFocus?.();
          }}
          onBlur={() => {
            setTimeout(() => setOpen(false), 120);
            onBlur?.();
          }}
          onKeyPress={handleKeyPress}
          placeholder={placeholder}
          placeholderTextColor="#B2B8C1"
          accessibilityLabel={accessibilityLabel}
          autoFocus={autoFocus}
          selectTextOnFocus
          className={inputClassName}
          style={[inputStyle, adornmentWidth ? { paddingRight: adornmentWidth } : null]}
        />
        {adornment ? (
          <View pointerEvents="none" style={{ position: 'absolute', right: 12 }}>
            {adornment}
          </View>
        ) : null}
      </View>

      {visible && (
        <View
          // Pressing the mouse on a suggestion would first blur the text box -
          // which closes this list before the click lands. Keeping the box
          // focused on mousedown lets the click select the suggestion.
          {...({ onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() } as object)}
          className="rounded-xl border border-gray-200 bg-white py-1"
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            zIndex: 50,
            marginTop: 2,
            boxShadow: '0 10px 28px rgba(16,24,40,0.14)',
          }}
        >
          <ScrollView style={{ maxHeight: 280 }} keyboardShouldPersistTaps="handled">
            {options.map((o, i) => (
              <Pressable
                key={o.key}
                tabIndex={-1}
                onPress={() => choose(o, 'click')}
                className={`flex-row items-center justify-between px-3 py-2 ${o.kind === 'add' && i > 0 ? 'mt-1 border-t border-gray-100' : ''}`}
                style={{ backgroundColor: i === activeIndex ? `${accent}14` : 'transparent' }}
              >
                {o.kind === 'add' ? (
                  <>
                    <Ionicons name="add-circle" size={16} color={accent} />
                    <Text
                      className={`ml-2 flex-1 font-semibold ${compact ? 'text-xs' : 'text-sm'}`}
                      style={{ color: accent }}
                      numberOfLines={1}
                    >
                      {o.label}
                    </Text>
                  </>
                ) : (
                  <Text className={`flex-1 text-gray-900 ${compact ? 'text-xs' : 'text-sm'}`} numberOfLines={1}>
                    {highlightText(o.label, value)}
                  </Text>
                )}
                {!!o.hint && <Text className={`ml-2 text-gray-400 ${compact ? 'text-[10px]' : 'text-[11px]'}`}>{o.hint}</Text>}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}
