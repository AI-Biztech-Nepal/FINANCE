# Auto Stock Manager → Finance

Moves Hamro G&G's books from Auto Stock Manager (the dealership app on the VPS) into one Finance account.
Vehicles, spare parts, vendors, customers, sales and returns, bookings, vendor payments, vehicle expenses and
job card costs. What goes where is listed at the top of `import_asm.py`.

## Steps

1. `cp scripts/asm_import/env.example scripts/asm_import/.env` and fill it in: the VPS backend address and an
   Auto Stock Manager **admin** login, and Finance's Supabase **service_role** key (Project Settings → API). Keep
   that key private - it can read and write every account.
2. `python3 scripts/asm_import/import_asm.py fetch` - reads everything into `scripts/asm_import/data/snapshot.json`
   (customer details: not committed, delete it when done).
3. `python3 scripts/asm_import/import_asm.py plan` - a dry run: how many bills and payments of each kind, the
   totals, and anything left out. Nothing is written.
4. `python3 scripts/asm_import/import_asm.py load` - writes it, after you type `yes`.

Running `load` again updates what it wrote before (every row keeps the Auto Stock Manager id it came from)
rather than adding it twice. Parties keep that id in `customers.phone_contact_id` (`asm:v:…`, `asm:c:…`), stock
items in `products.sku` (`asm:vehicle:…`, `asm:part:…`), bills and payments in `source_type` / `source_id`
(`asm_…`).

## Left out

- Photos and legal documents (they stay in Auto Stock Manager).
- Job cards after a sale that were charged to the customer: Auto Stock Manager records no payment for them.
- A payment's own date when a due was collected later: Auto Stock Manager keeps only the totals on the sale,
  so every receipt is dated on the sale day.
