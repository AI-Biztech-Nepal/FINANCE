// lib/components/finance/NewPartyConfirm.tsx
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { TextInput } from 'react-native';
import { Text } from './CapsText';
import { Field, FieldRow, FormActions, INPUT, PopupCard } from './FormKit';
import { readKey } from '../../utils/webKeys';

export type NewPartyKind = 'customer' | 'vendor' | 'payee';

function NewPartyDialog({ kind, initial, onAdd, onCancel }: { kind: NewPartyKind; initial: string; onAdd: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initial);
  const add = () => {
    if (name.trim()) onAdd(name.trim());
  };
  return (
    // No cross: it has to be answered with Cancel (the name is dropped) or Add (it is saved).
    <PopupCard title={`Add new ${kind}`} onClose={onCancel} maxWidth={460} hideClose>
      <Text className="text-[13px] text-gray-500">
        This {kind} is not saved yet. Check the name - fix it if it needs it - and add.
      </Text>
      {/* In a row: a Field's width setting is a height in a column. */}
      <FieldRow>
        <Field label="Name" basis={240}>
          <TextInput
            value={name}
            onChangeText={setName}
            autoFocus
            selectTextOnFocus
            placeholder="Name"
            placeholderTextColor="#9CA3AF"
            onKeyPress={(e) => {
              const k = readKey(e);
              if (k.key === 'Enter') {
                k.prevent();
                add();
              } else if (k.key === 'Escape') {
                k.prevent();
                onCancel();
              }
            }}
            className={INPUT}
          />
        </Field>
      </FieldRow>
      <FormActions onCancel={onCancel} onSave={add} saveLabel={`Add ${kind}`} />
    </PopupCard>
  );
}

/** `const { askNewParty, dialog } = useConfirmNewParty()` - `await askNewParty({ name, kind })` right before a
 * new customer / vendor is saved from a typed name. It opens a popup with the name in an editable box:
 * resolves to the name to save ("Add"), or null on Cancel / Esc / a tap outside - then nothing is saved.
 * Render `{dialog}` anywhere in the screen. */
export function useConfirmNewParty(): {
  askNewParty: (options: { name: string; kind: NewPartyKind }) => Promise<string | null>;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<{ name: string; kind: NewPartyKind; resolve: (name: string | null) => void } | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const askNewParty = useCallback(
    ({ name, kind }: { name: string; kind: NewPartyKind }) => {
      // A second ask while one is already up must not stack another.
      if (pendingRef.current) return Promise.resolve<string | null>(null);
      return new Promise<string | null>((resolve) => setPending({ name, kind, resolve }));
    },
    []
  );

  const finish = (value: string | null) => {
    pending?.resolve(value);
    setPending(null);
  };

  const dialog = pending ? <NewPartyDialog kind={pending.kind} initial={pending.name} onAdd={(n) => finish(n)} onCancel={() => finish(null)} /> : null;
  return { askNewParty, dialog };
}
