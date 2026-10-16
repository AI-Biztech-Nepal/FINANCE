# Finance

Inventory, billing and finance for a department store. Split out of Jageer Nepal:
same UI/UX, same money rules (bills are debts, payments are money, Day Book, two
ledgers, statement import), but its **own Supabase project and its own books**.
Nothing here reads or writes Jageer's database.

## Setup
1. Create a new Supabase project. Copy `.env.example` to `.env`, fill in URL / anon key / DB URL.
2. Run `supabase/migrations/0001_finance.sql`, then `0002` .. `0006` in order (SQL editor or psql).
   `0007_title_case_existing_names.sql` is an optional tidy of names already saved (it only touches
   names written in all capitals or all small letters), and `0008_sync_customer_rename.sql` keeps a
   renamed party's bills in step. Then the smoke test at the bottom of 0001 (see `finance-port/00_STEP_BY_STEP.md` 1.4-1.5).
3. `npm install`, then `npm run web` (or `npm run android`).
4. **Set up email** (`supabase/email-templates/README.md`): custom SMTP + the sign-up code template.
   Without it, only your own Supabase team's addresses receive sign-up codes and reset links.
5. Register in the app, fill Store Details (profile), add bank accounts, add products.

## Accounts
Anyone can register with their own email. Each account is a separate set of books (every table is
owner-scoped with row-level security). Sign-up uses a 6-digit code emailed by Supabase. Password
reset ("Forgot password?") emails a link that opens a "Choose a new password" screen: new
password and confirm. **Profile -> Change password** needs no email: current password, new
password and confirm (the current one is checked first). Signing in on a shared phone keeps
fingerprint sign-in tied to one account at a time and asks before switching it.

## What differs from Jageer
- One role (`store`), one portal `app/(store)/`.
- `products` is the store's own shelf (0002); Sale/Purchase bills move stock by a DB trigger
  (matched by item name, case-insensitive).
- Removed: service requests, technicians, marketplace/wholesale, admin, client app, Fonepay, AI chat.
- Kept: bill scan + voice entry hooks (need the `scan-bill` / `voice-command` edge functions deployed and their API keys).

Money rules and formulas: `finance-port/FINANCE-SPEC.md`.
