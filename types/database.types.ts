// types/database.types.ts
// Hand-written types matching the Supabase schema. Once your project is
// running, regenerate these with:
//   npx supabase gen types typescript --project-id <your-project-id> > types/database.types.ts

export type UserRole = 'store';

export interface Profile {
  id: string;
  role: UserRole;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  city: string | null;
  is_active: boolean;
  // The store's own letterhead, printed on bills and the Day Book.
  business_name: string | null;
  business_reg_no: string | null;
  business_vat_no: string | null;
  business_address: string | null;
  business_phone: string | null;
  business_logo_path: string | null;
  created_at: string;
  updated_at: string;
}

/** One sellable item on the shelf. Stock moves with Sale/Purchase bills
 * (see supabase/migrations/0002_inventory.sql). */
export interface Product {
  id: string;
  owner_id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  category: string | null;
  unit: string;
  price: number;
  purchase_price: number | null;
  stock_level: number;
  reorder_level: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// A name (and its last-used rate) typed into Sale/Purchase's item picker
// that isn't a real product in the reseller's marketplace catalog - kept so
// the picker can offer it again next time, without needing (or being
// allowed - see 0063_finance_items.sql) to create a real `products` row.
export interface FinanceItem {
  id: string;
  owner_id: string;
  name: string;
  rate: number | null;
  created_at: string;
  updated_at: string;
}

// Moving money between the business's own accounts (Cash and/or a
// bank_accounts row) - null on either side means Cash, same convention as
// bank_account_id everywhere else. Doesn't represent income or expense, so
// it's kept out of Sales/Purchase/Expense/Total Received/Total Paid.
export interface AccountTransfer {
  id: string;
  owner_id: string;
  from_account_id: string | null;
  to_account_id: string | null;
  amount: number;
  note: string | null;
  transfer_date: string;
  created_at: string;
}

export interface Customer {
  id: string;
  owner_id: string;
  name: string;
  phone: string | null;
  address: string | null;
  contact_person_name: string | null;
  contact_person_phone: string | null;
  latitude: number | null;
  longitude: number | null;
  phone_contact_id: string | null;
  /** What kind of party this is (see party_types); null = not set. */
  party_type_id: string | null;
  created_at: string;
  updated_at: string;
}

/** A label the store sorts its parties by - Customer, Vendor, Employee or
 * any they add themselves (0003_party_types.sql). */
export interface PartyType {
  id: string;
  owner_id: string;
  name: string;
  created_at: string;
}

export type LedgerEntryType = 'debit' | 'credit';

export interface CustomerLedgerEntry {
  id: string;
  customer_id: string;
  owner_id: string;
  entry_type: LedgerEntryType;
  amount: number;
  note: string | null;
  source: 'manual' | 'booking';
  source_type: string | null;
  source_id: string | null;
  bank_account_id: string | null;
  entry_date: string | null;
  receipt_no: string | null;
  created_at: string;
}

export type BusinessTransactionType = 'sale' | 'purchase' | 'expense';
export type PaymentMode = 'cash' | 'bank' | 'credit';

// Same shape as CustomerLedgerEntry, but opposite polarity: 'debit' = the
// business owes this vendor more (bought on credit), 'credit' = a payment
// the business made to the vendor. vendor_id points at the same `customers`
// directory Purchase's "Vendor" field picks from - vendors and customers
// share one contacts list.
export interface VendorLedgerEntry {
  id: string;
  vendor_id: string;
  owner_id: string;
  entry_type: LedgerEntryType;
  amount: number;
  note: string | null;
  source: 'manual' | 'booking';
  source_type: string | null;
  source_id: string | null;
  entry_date: string | null;
  receipt_no: string | null;
  bank_account_id: string | null;
  created_at: string;
}

export interface BillItem {
  description: string;
  /** Harmonized System code for the line - optional, absent on older bills. */
  hs_code?: string | null;
  /** The item's model number - optional, only entered on a vehicle account's Purchase bill. */
  model?: string | null;
  qty: number;
  rate: number;
  amount: number;
}

export interface ExpenseCategory {
  id: string;
  owner_id: string;
  name: string;
  /** 'direct' costs sit above gross profit in the Profit & Loss; 'indirect' (the default) below it. */
  expense_group?: 'direct' | 'indirect' | null;
  created_at: string;
  updated_at: string;
}

export interface BankAccount {
  id: string;
  owner_id: string;
  name: string;
  bank_name: string | null;
  account_number: string | null;
  account_holder_name: string | null;
  address: string | null;
  created_at: string;
  updated_at: string;
}

export interface BusinessTransaction {
  id: string;
  owner_id: string;
  type: BusinessTransactionType;
  amount: number;
  note: string | null;
  party_name: string | null;
  customer_id: string | null;
  source_type: string | null;
  source_id: string | null;
  bill_no: string | null;
  bill_date: string | null;
  party_address: string | null;
  vat_pan_no: string | null;
  items: BillItem[];
  discount_amount: number;
  vat_amount: number;
  expense_category_id: string | null;
  payment_mode: PaymentMode;
  bank_account_id: string | null;
  created_at: string;
  updated_at: string;
}

// One row per statement line (by its Reference Code) that's already been
// turned into a real Finance entry - lets re-importing the same statement,
// or one with an overlapping date range, skip rows already recorded here.
export interface StatementImport {
  id: string;
  owner_id: string;
  reference_code: string;
  created_at: string;
}

/** Money received on a rental (see supabase/migrations/0009_rentals.sql). */
export interface RentalPayment {
  /** 'YYYY-MM-DD' */
  date: string;
  amount: number;
  note?: string | null;
}

/** A car given out on rent. What it comes to (days x rate) and what is due are worked out from these. */
export interface Rental {
  id: string;
  owner_id: string;
  car: string;
  model: string | null;
  customer_id: string | null;
  customer_name: string | null;
  /** 'YYYY-MM-DD' */
  start_date: string;
  /** The day it is due back, when one was agreed. */
  end_date: string | null;
  /** The day it actually came back; null while it is still out. */
  returned_on: string | null;
  rate_per_day: number;
  /** The employee who went out with it (a driver), and their wage for each day it is out (see 0015_rental_employee_wages.sql). */
  employee_id: string | null;
  employee_name: string | null;
  wage_per_day: number;
  payments: RentalPayment[];
  note: string | null;
  created_at: string;
  updated_at: string;
}

/** A vehicle on instalments (see supabase/migrations/0019_emi_plans.sql and 0021_emi_direction_interest.sql). Sold to a
 * customer ('sale', the default): what has been paid is the customer's Received entries that name the vehicle. Bought
 * from a vendor ('purchase'): the Paid entries on the vendor's ledger that name it. What is due is worked out from the
 * plan (see lib/utils/emi.ts). */
export interface EmiPlan {
  id: string;
  owner_id: string;
  car: string;
  model: string | null;
  customer_id: string | null;
  customer_name: string | null;
  sale_price: number;
  down_payment: number;
  installment: number;
  months: number;
  /** 'YYYY-MM-DD': the first instalment's day; the rest fall on the same day each month after it. */
  first_due: string;
  note: string | null;
  /** Settled or ended early; null while it runs. */
  closed_on: string | null;
  /** 'sale': the customer pays us; 'purchase': we pay the vendor (held in customer_id / customer_name). Absent on a
   * plan made before 0021 - that is a sale. */
  direction?: 'sale' | 'purchase';
  /** Percent per month, flat on the financed amount. Absent / 0: no interest. */
  interest_rate?: number;
  /** The stock item a purchase plan was made from. */
  product_id?: string | null;
  created_at: string;
  updated_at: string;
}

// Minimal shape expected by Supabase's generated Database type.
// Expand this if/when you swap in the CLI-generated version.
export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile; Insert: Partial<Profile>; Update: Partial<Profile>; Relationships: [] };
      products: { Row: Product; Insert: Partial<Product>; Update: Partial<Product>; Relationships: [] };
      customers: { Row: Customer; Insert: Partial<Customer>; Update: Partial<Customer>; Relationships: [] };
      party_types: { Row: PartyType; Insert: Partial<PartyType>; Update: Partial<PartyType>; Relationships: [] };
      finance_items: { Row: FinanceItem; Insert: Partial<FinanceItem>; Update: Partial<FinanceItem>; Relationships: [] };
      account_transfers: {
        Row: AccountTransfer;
        Insert: Partial<AccountTransfer>;
        Update: Partial<AccountTransfer>;
        Relationships: [];
      };
      customer_ledger_entries: {
        Row: CustomerLedgerEntry;
        Insert: Partial<CustomerLedgerEntry>;
        Update: Partial<CustomerLedgerEntry>;
        Relationships: [];
      };
      vendor_ledger_entries: {
        Row: VendorLedgerEntry;
        Insert: Partial<VendorLedgerEntry>;
        Update: Partial<VendorLedgerEntry>;
        Relationships: [];
      };
      business_transactions: {
        Row: BusinessTransaction;
        Insert: Partial<BusinessTransaction>;
        Update: Partial<BusinessTransaction>;
        Relationships: [];
      };
      expense_categories: {
        Row: ExpenseCategory;
        Insert: Partial<ExpenseCategory>;
        Update: Partial<ExpenseCategory>;
        Relationships: [];
      };
      bank_accounts: {
        Row: BankAccount;
        Insert: Partial<BankAccount>;
        Update: Partial<BankAccount>;
        Relationships: [];
      };
      statement_imports: {
        Row: StatementImport;
        Insert: Partial<StatementImport>;
        Update: Partial<StatementImport>;
        Relationships: [];
      };
      rentals: { Row: Rental; Insert: Partial<Rental>; Update: Partial<Rental>; Relationships: [] };
      emi_plans: { Row: EmiPlan; Insert: Partial<EmiPlan>; Update: Partial<EmiPlan>; Relationships: [] };
    };
  };
}
