// lib/utils/journalVoucher.ts
//
// A journal voucher moves an amount from one person's ledger to another's - no cash, bank account or
// bill is touched. It is kept as two ordinary manual ledger entries, one on each person, that carry
// the same code in their remark ("Journal voucher JV-7K3Q9X: Set off against the March order"):
//
//   the person CREDITED (their balance goes down)  - a Received entry on their customer ledger,
//   the person DEBITED  (their balance goes up)    - a Paid entry on their customer ledger, or a
//                                                    payment on their vendor ledger when that is the
//                                                    only ledger they have.
//
// Both are the same amount on the same (cash) account, so what is in hand does not change. The code is
// how the pair is found again: the Day Book lists the two as one line and keeps them out of cash,
// and Total Received / Total Paid leave them out (nothing was actually received or paid).

export const JOURNAL_LABEL = 'Journal voucher';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** A new voucher's code, "JV-" and six letters / digits. */
export function newJournalCode(): string {
  let code = '';
  for (let i = 0; i < 6; i += 1) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return `JV-${code}`;
}

/** The remark both entries of a voucher carry. */
export function journalNote(code: string, narration: string): string {
  const text = narration.trim();
  return `${JOURNAL_LABEL} ${code}${text ? `: ${text}` : ''}`;
}

const NOTE = /^Journal voucher (JV-[A-Z0-9]{6})(?::\s*([\s\S]*))?$/;

/** The code and narration of a voucher's entry, or null for any other entry. */
export function journalOf(note: string | null | undefined): { code: string; narration: string } | null {
  const match = note ? NOTE.exec(note.trim()) : null;
  return match ? { code: match[1], narration: (match[2] ?? '').trim() } : null;
}
