// lib/components/finance/NewPartyConfirm.tsx
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { TextInput } from 'react-native';
import { Text } from './CapsText';
import { Field, FieldRow, FormActions, INPUT, PopupCard } from './FormKit';
import { PartyTypeField } from './PartyTypeField';
import { useAuthStore } from '../../hooks/useAuth';
import { usePartyTypes } from '../../hooks/usePartyTypes';
import { readKey } from '../../utils/webKeys';

export type NewPartyKind = 'customer' | 'vendor' | 'payee';

/** What the popup answers with: the name to save, and the Ledger type to file the person under (null: none). */
export interface NewPartyAnswer {
  name: string;
  partyTypeId: string | null;
}

/** The type to save on the new customer row: `{ ...withType(answer) }`. */
export const withType = (answer: NewPartyAnswer): { party_type_id?: string } => (answer.partyTypeId ? { party_type_id: answer.partyTypeId } : {});

function NewPartyDialog({
  kind,
  initial,
  typeId,
  onAdd,
  onCancel,
}: {
  kind: NewPartyKind;
  initial: string;
  typeId?: string | null;
  onAdd: (answer: NewPartyAnswer) => void;
  onCancel: () => void;
}) {
  const userId = useAuthStore((state) => state.session?.user.id);
  const { types, remove: removeType } = usePartyTypes(userId);
  const [name, setName] = useState(initial);
  // A Ledger type made in this popup is kept only if the person is added: on Cancel it is taken back out.
  const madeTypes = useRef<string[]>([]);
  const cancel = () => {
    for (const id of madeTypes.current) void removeType(id).catch(() => undefined);
    madeTypes.current = [];
    onCancel();
  };
  // The Ledger type starts on the one that fits what is being added (a customer under Customer, a vendor or payee
  // under Vendor) - or the one the caller asked for - until another is picked or typed.
  const fitting = useMemo(() => {
    if (typeId) return typeId;
    const word = kind === 'customer' ? /^customers?$/i : /^vendors?$/i;
    return types.find((t) => word.test(t.name.trim()))?.id ?? null;
  }, [typeId, kind, types]);
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const partyTypeId = picked === undefined ? fitting : picked;
  const add = () => {
    if (name.trim()) onAdd({ name: name.trim(), partyTypeId });
  };
  return (
    // No cross, but a click outside, Esc and Cancel all go back: the name is dropped and nothing is saved. Only Add saves.
    <PopupCard title={`Add new ${kind}`} onClose={cancel} maxWidth={460} hideClose closeOnOutside>
      <Text className="text-[13px] text-gray-500">
        This {kind} is not saved yet. Check the name - fix it if it needs it - and the Ledger type it belongs to, then add.
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
                cancel();
              }
            }}
            className={INPUT}
          />
        </Field>
      </FieldRow>
      <PartyTypeField ownerId={userId} value={partyTypeId} onChange={setPicked} onCreated={(id) => madeTypes.current.push(id)} />
      <FormActions onCancel={cancel} onSave={add} saveLabel={`Add ${kind}`} />
    </PopupCard>
  );
}

/** `const { askNewParty, dialog } = useConfirmNewParty()` - `await askNewParty({ name, kind })` right before a
 * new customer / vendor is saved from a typed name. It opens a popup with the name in an editable box and the
 * Ledger type it will be filed under: resolves to the name and type to save ("Add"), or null on Cancel / Esc -
 * then nothing is saved. `typeId` starts the Ledger type on a given one (an employee). Render `{dialog}`
 * anywhere in the screen. */
export function useConfirmNewParty(): {
  askNewParty: (options: { name: string; kind: NewPartyKind; typeId?: string | null }) => Promise<NewPartyAnswer | null>;
  dialog: ReactNode;
} {
  const [pending, setPending] = useState<{
    name: string;
    kind: NewPartyKind;
    typeId?: string | null;
    resolve: (answer: NewPartyAnswer | null) => void;
  } | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;

  const askNewParty = useCallback(
    ({ name, kind, typeId }: { name: string; kind: NewPartyKind; typeId?: string | null }) => {
      // A second ask while one is already up must not stack another.
      if (pendingRef.current) return Promise.resolve<NewPartyAnswer | null>(null);
      return new Promise<NewPartyAnswer | null>((resolve) => setPending({ name, kind, typeId, resolve }));
    },
    []
  );

  const finish = (value: NewPartyAnswer | null) => {
    pending?.resolve(value);
    setPending(null);
  };

  const dialog = pending ? (
    <NewPartyDialog kind={pending.kind} initial={pending.name} typeId={pending.typeId} onAdd={(answer) => finish(answer)} onCancel={() => finish(null)} />
  ) : null;
  return { askNewParty, dialog };
}
