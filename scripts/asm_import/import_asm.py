#!/usr/bin/env python3
"""Moves Hamro G&G's books from Auto Stock Manager (FastAPI + MySQL on the VPS) into one Finance account
(Supabase). Python 3 standard library only.

    python3 scripts/asm_import/import_asm.py fetch   # read everything from the Auto Stock Manager API
    python3 scripts/asm_import/import_asm.py plan    # dry run: what would be written, nothing is
    python3 scripts/asm_import/import_asm.py load    # write it into the Finance account

Settings come from scripts/asm_import/.env (see README.md). Every row written carries the Auto Stock Manager
id it came from, so a second `load` updates what the first one wrote instead of adding it again.

How the dealership's records land in Finance:
  vendors, customers        -> Ledger parties (Vendor / Customer type)
  each vehicle              -> a stock item + a Purchase bill from whoever it was bought from
  accessories, sanakhat     -> Expenses against the vehicle
  vehicle expenses          -> Expenses, under their own category
  job cards (shop's cost)   -> Expenses, Workshop category
  sales                     -> a Sale bill + Received entries (cash, bank, advance)
  returned sales            -> only what the shop kept, as a Sale bill "Return charges"
  bookings                  -> Received (active); cancelled: received, refund paid out, kept as a Sale bill
  vendor payments           -> Paid entries (named for the vehicle, so Stock and Inventory adds them up)
  spare parts               -> stock items + Purchase bills grouped by vendor and bill no.
Finally every stock item's quantity is set to what Auto Stock Manager says is on hand.
"""
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(HERE, "data")
SNAPSHOT = os.path.join(DATA_DIR, "snapshot.json")
NS = uuid.UUID("5b1f3a52-6a55-4f0e-9d39-7c0a1f6d2e10")  # fixed: the same record always gets the same id

# What the Auto Stock Manager list endpoints stop at (server.py `.to_list(n)`). A list this long may be cut off.
CAPS = {"vehicles": 1000, "customers": 1000, "sales": 1000, "vendors": 200, "spare_parts": 1000, "jobs": 1000, "bookings": 1000}
SOLD_STATUSES = {"sold", "scrap"}
BANK_NAME = "Bank (Auto Stock Manager)"


# ── settings ──────────────────────────────────────────────────────────────
def load_env():
    path = os.path.join(HERE, ".env")
    if os.path.exists(path):
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def need(name):
    value = os.environ.get(name, "").strip()
    if not value:
        sys.exit(f"Missing {name} - add it to scripts/asm_import/.env (see README.md).")
    return value


# ── HTTP ──────────────────────────────────────────────────────────────────
def http(method, url, headers=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json", **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=120) as res:
            raw = res.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        sys.exit(f"{method} {url} failed: {e.code} {e.read().decode(errors='replace')[:500]}")


# ── 1. fetch ──────────────────────────────────────────────────────────────
def fetch():
    base = need("ASM_URL").rstrip("/")
    api = base if base.endswith("/api") else base + "/api"
    login = http("POST", api + "/auth/login", body={"username": need("ASM_USERNAME"), "password": need("ASM_PASSWORD")})
    auth = {"Authorization": f"Bearer {login['token']}"}
    get = lambda path: http("GET", api + path, auth)
    print(f"Signed in to Auto Stock Manager as {login.get('username')} ({login.get('company_name') or 'no company'})")

    snap = {
        "company_name": login.get("company_name"),
        "vehicles": get("/vehicles?status=all"),
        "customers": get("/customers"),
        "vendors": get("/vendors"),
        "sales": get("/sales"),
        "bookings": get("/bookings"),
        "jobs": get("/jobs"),
        "spare_parts": get("/spare-parts"),
    }
    print(f"  {len(snap['vehicles'])} vehicles, {len(snap['customers'])} customers, {len(snap['vendors'])} vendors, "
          f"{len(snap['sales'])} sales, {len(snap['bookings'])} bookings, {len(snap['jobs'])} job cards, {len(snap['spare_parts'])} parts")

    # What only comes one record at a time.
    snap["vendor_payments"], snap["vendor_parts"] = [], []
    for v in snap["vendors"]:
        detail = get(f"/vendors/{v['id']}/payments")
        snap["vendor_payments"] += detail.get("payments") or []
        for bill in detail.get("parts_bills") or []:
            for p in bill.get("items") or []:
                snap["vendor_parts"].append({"id": p["id"], "bought_qty": p.get("bought_qty")})
    snap["expenses"] = []
    for v in snap["vehicles"]:
        snap["expenses"] += get(f"/vehicles/{v['id']}/expenses") or []
    snap["part_transactions"] = []
    for p in snap["spare_parts"]:
        snap["part_transactions"] += get(f"/spare-parts/{p['id']}/transactions") or []
    print(f"  {len(snap['vendor_payments'])} vendor payments, {len(snap['expenses'])} vehicle expenses, "
          f"{len(snap['part_transactions'])} part movements")

    os.makedirs(DATA_DIR, exist_ok=True)
    with open(SNAPSHOT, "w") as f:
        json.dump(snap, f, ensure_ascii=False, indent=1)
    print(f"Saved {SNAPSHOT}")
    for key, cap in CAPS.items():
        if len(snap.get(key) or []) >= cap:
            print(f"WARNING: {key} came back with {cap} rows - Auto Stock Manager stops there, so some may be missing.")


# ── 2. turn the snapshot into Finance rows ───────────────────────────────
def money(v):
    try:
        return round(float(v or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def day(v):
    """'YYYY-MM-DD' from a date or timestamp; None when there is none."""
    m = re.match(r"(\d{4}-\d{2}-\d{2})", str(v or ""))
    return m.group(1) if m else None


def sid(kind, asm_id):
    return str(uuid.uuid5(NS, f"{kind}:{asm_id}"))


def phone_key(p):
    digits = re.sub(r"\D", "", str(p or ""))
    return digits[-10:] if len(digits) >= 7 else None


def tidy(s):
    return re.sub(r"\s+", " ", str(s or "")).strip()


def vehicle_name(v):
    """The stock item's name: what the car is, and which one - two bikes of one model never share a line."""
    what = tidy(" ".join(str(x) for x in [v.get("brand"), v.get("model"), v.get("variant")] if x))
    which = tidy(v.get("registration_number")) or (tidy(v.get("chassis_number"))[-6:] and f"Chassis {tidy(v.get('chassis_number'))[-6:]}") or v["id"][:6]
    return f"{what or 'Vehicle'} ({which})"


def vehicle_details(v):
    """The vehicle's particulars, as one line on its purchase bill."""
    parts = [
        v.get("year") and f"Year {v['year']}",
        v.get("engine_cc") and f"{v['engine_cc']} cc",
        v.get("fuel_type"),
        v.get("vehicle_type"),
        v.get("color"),
        v.get("kilometer_run") and f"{int(v['kilometer_run']):,} km",
        v.get("ownership_number") and f"Ownership {v['ownership_number']}",
        v.get("condition") and f"Condition {v['condition']}",
        v.get("chassis_number") and f"Chassis {v['chassis_number']}",
        v.get("engine_number") and f"Engine {v['engine_number']}",
        v.get("bluebook_status") and f"Bluebook {v['bluebook_status']}",
        v.get("insurance_status") and f"Insurance {v['insurance_status']}",
        v.get("tax_clearance_status") and f"Tax {v['tax_clearance_status']}",
        v.get("transfer_status") and f"Transfer {v['transfer_status']}",
        v.get("notes") and tidy(v["notes"]),
    ]
    return " · ".join(str(p) for p in parts if p)


def build(snap):
    """Everything to write, keyed so a re-run finds what it wrote before. No network here."""
    out = {"parties": {}, "products": {}, "categories": set(), "bills": [], "customer_entries": [], "vendor_entries": [], "warnings": []}
    warn = out["warnings"].append
    parties, products = out["parties"], out["products"]

    def party(key, name, phone=None, address=None, ptype="Customer"):
        name = tidy(name)
        if not name:
            return None
        if key not in parties:
            parties[key] = {"key": key, "name": name, "phone": tidy(phone) or None, "address": tidy(address) or None, "type": ptype}
        return key

    vendors = {v["id"]: v for v in snap["vendors"]}
    customers = {c["id"]: c for c in snap["customers"]}
    for v in snap["vendors"]:
        party(f"asm:v:{v['id']}", v.get("name"), v.get("phone"), v.get("address"), "Vendor")
    for c in snap["customers"]:
        party(f"asm:c:{c['id']}", c.get("name"), c.get("contact_number"), c.get("address"), "Customer")

    def party_of_contact(kind, cid):
        if kind == "vendor" and cid in vendors:
            return f"asm:v:{cid}"
        if kind == "customer" and cid in customers:
            return f"asm:c:{cid}"
        return None

    # ── vehicles ──
    vehicles = {v["id"]: v for v in snap["vehicles"]}
    names_taken, chassis_taken = set(), set()
    for v in snap["vehicles"]:
        name = vehicle_name(v)
        if name.lower() in names_taken:
            name = f"{name[:-1]} #{v['id'][:4]})"
        names_taken.add(name.lower())
        v["_name"] = name
        chassis = tidy(v.get("chassis_number")) or None
        if chassis and chassis.lower() in chassis_taken:
            warn(f"Vehicle {name}: chassis {chassis} is on another vehicle too - kept on the first only")
            chassis = None
        if chassis:
            chassis_taken.add(chassis.lower())
        products[f"asm:vehicle:{v['id']}"] = {
            "sku": f"asm:vehicle:{v['id']}", "name": name, "category": tidy(v.get("vehicle_type")).title() or "Vehicle",
            "price": money(v.get("selling_price")), "purchase_price": money(v.get("purchase_price")) or None,
            "barcode": chassis,
            "stock": 0 if (v.get("status") or "").lower() in SOLD_STATUSES else 1,
        }
        seller = v.get("vendor_id") and v["vendor_id"] in vendors and f"asm:v:{v['vendor_id']}"
        seller = seller or party_of_contact(v.get("linked_contact_type"), v.get("linked_contact_id"))
        seller = seller or party(f"asm:n:{tidy(v.get('purchase_from') or v.get('linked_contact_name')).lower()}",
                                 v.get("purchase_from") or v.get("linked_contact_name"), ptype="Vendor")
        cost = money(v.get("purchase_price"))
        when = day(v.get("purchase_date")) or day(v.get("created_at"))
        if cost > 0:
            out["bills"].append({
                "source_type": "asm_vehicle_purchase", "source_id": sid("vehicle_purchase", v["id"]), "type": "purchase",
                "party": seller, "bill_date": when, "amount": cost,
                "items": [{"description": name, "model": tidy(f"{v.get('model') or ''} {v.get('variant') or ''} {v.get('year') or ''}") or None,
                           "qty": 1, "rate": cost, "amount": cost}],
                "note": vehicle_details(v) or None,
            })
        else:
            warn(f"Vehicle {name}: no purchase price, so no purchase bill")
        for kind, field, category in (("accessories", "accessories_cost", "Vehicle accessories"), ("sanakhat", "sanakhat_cost", "Sanakhat")):
            amount = money(v.get(field))
            if amount > 0:
                out["categories"].add(category)
                out["bills"].append({
                    "source_type": f"asm_vehicle_{kind}", "source_id": sid(f"vehicle_{kind}", v["id"]), "type": "expense",
                    "category": category, "party_name": name, "amount": amount,
                    "bill_date": day(v.get("sanakhat_date")) if kind == "sanakhat" and day(v.get("sanakhat_date")) else when,
                    "note": f"{category} · {name}",
                })

    # ── expenses on vehicles ──
    for e in snap["expenses"]:
        amount = money(e.get("amount"))
        if amount <= 0:
            continue
        v = vehicles.get(e.get("vehicle_id"))
        category = tidy(e.get("category")).title() or "Vehicle expenses"
        out["categories"].add(category)
        out["bills"].append({
            "source_type": "asm_expense", "source_id": sid("expense", e["id"]), "type": "expense", "category": category,
            "party_name": v["_name"] if v else None, "amount": amount, "bill_date": day(e.get("date")) or day(e.get("created_at")),
            "note": " · ".join(x for x in [v and v["_name"], tidy(e.get("description"))] if x) or None,
        })

    # ── job cards: what they cost the shop (the same reading as Auto Stock Manager's own figures) ──
    for j in snap["jobs"]:
        if j.get("after_sale") and not j.get("is_warranty"):
            if money(j.get("labour_charge")) or money(j.get("actual_cost")):
                warn(f"Job {j.get('job_number') or j['id'][:6]} (after sale): charged to the customer - not moved, as Auto Stock Manager has no payment for it")
            continue
        parts_total = sum(money(p.get("quantity")) * money(p.get("unit_cost")) for p in (j.get("parts") or []))
        base = parts_total if parts_total > 0 else money(j.get("actual_cost") if j.get("actual_cost") is not None else j.get("estimated_cost"))
        cost = round(base + money(j.get("sanakhat_cost")) + money(j.get("resanakhat_cost")), 2)
        if cost <= 0:
            continue
        v = vehicles.get(j.get("vehicle_id"))
        label = v["_name"] if v else tidy(f"{j.get('vehicle_brand') or ''} {j.get('vehicle_model') or ''} {j.get('registration_number') or ''}")
        out["categories"].add("Workshop (job cards)")
        out["bills"].append({
            "source_type": "asm_job_card", "source_id": sid("job", j["id"]), "type": "expense", "category": "Workshop (job cards)",
            "party_name": label or None, "amount": cost, "bill_date": day(j.get("job_date")) or day(j.get("created_at")),
            "note": " · ".join(x for x in [f"Job {j['job_number']}" if j.get("job_number") else "Job card", label,
                                           tidy(j.get("mechanic_name")), tidy(j.get("work_description")),
                                           "Warranty" if j.get("is_warranty") else None] if x),
        })

    # ── sales ──
    def receipts(prefix, asm_id, cust, when, label, cash, bank, advance):
        for kind, amount, bank_side in (("cash", cash, False), ("bank", bank, True), ("advance", advance, False)):
            amount = money(amount)
            if amount > 0 and cust:
                out["customer_entries"].append({
                    "source_type": f"asm_{prefix}_{kind}", "source_id": sid(f"{prefix}_{kind}", asm_id), "party": cust,
                    "entry_type": "credit", "amount": amount, "entry_date": when, "bank": bank_side,
                    "note": f"{label} · {'Advance' if kind == 'advance' else 'Bank' if bank_side else 'Cash'}",
                })

    for s in snap["sales"]:
        v = vehicles.get(s.get("vehicle_id"))
        name = v["_name"] if v else tidy(s.get("vehicle_info")) or "Vehicle"
        cust = f"asm:c:{s['customer_id']}" if s.get("customer_id") in customers else None
        when = day(s.get("sale_date")) or day(s.get("created_at"))
        if s.get("returned"):
            kept = money(s.get("retained_amount"))
            if kept > 0:
                out["bills"].append({
                    "source_type": "asm_sale_return", "source_id": sid("sale_return", s["id"]), "type": "sale", "party": cust,
                    "bill_date": day(s.get("returned_at")) or when, "amount": kept,
                    "items": [{"description": f"Return charges - {name}", "qty": 1, "rate": kept, "amount": kept}],
                    "note": " · ".join(x for x in ["Sale returned", tidy(s.get("return_notes"))] if x),
                })
                if cust:
                    out["customer_entries"].append({
                        "source_type": "asm_sale_return_kept", "source_id": sid("sale_return_kept", s["id"]), "party": cust,
                        "entry_type": "credit", "amount": kept, "entry_date": day(s.get("returned_at")) or when, "bank": False,
                        "note": f"{name} · Kept on return",
                    })
            continue
        price = money(s.get("sale_price"))
        if price <= 0:
            warn(f"Sale of {name}: no sale price, left out")
            continue
        out["bills"].append({
            "source_type": "asm_sale", "source_id": sid("sale", s["id"]), "type": "sale", "party": cust, "bill_date": when,
            "amount": price, "items": [{"description": name, "qty": 1, "rate": price, "amount": price}],
            "note": " · ".join(x for x in [s.get("payment_method") and f"Paid by {s['payment_method']}",
                                           money(s.get("due_amount")) and f"Due NPR {money(s['due_amount']):,.0f}" + (f" by {s['due_date']}" if s.get("due_date") else ""),
                                           tidy(s.get("notes"))] if x) or None,
        })
        if not cust:
            continue  # a walk-in sale is settled on the spot
        receipts("sale", s["id"], cust, when, name, s.get("paid_cash"), s.get("paid_bank"), s.get("advance_payment"))

    # ── bookings: one that became a sale is in the sale's advance already ──
    for b in snap["bookings"]:
        if b.get("sale_id") or (b.get("status") or "") == "converted":
            continue
        cust = f"asm:c:{b['customer_id']}" if b.get("customer_id") in customers else None
        v = vehicles.get(b.get("vehicle_id"))
        name = v["_name"] if v else "Vehicle"
        amount = money(b.get("booking_amount"))
        if not cust or amount <= 0:
            continue
        when = day(b.get("booking_date")) or day(b.get("created_at"))
        label = f"Booking{' #' + str(b['receipt_no']) if b.get('receipt_no') else ''} · {name}"
        bank = (b.get("payment_method") or "").lower() not in ("", "cash")
        out["customer_entries"].append({"source_type": "asm_booking", "source_id": sid("booking", b["id"]), "party": cust,
                                        "entry_type": "credit", "amount": amount, "entry_date": when, "bank": bank, "note": label})
        if (b.get("status") or "") == "cancelled":
            cancelled = day(b.get("cancelled_at")) or when
            refund, kept = money(b.get("refund_amount")), money(b.get("retained_amount"))
            if refund > 0:
                out["customer_entries"].append({"source_type": "asm_booking_refund", "source_id": sid("booking_refund", b["id"]), "party": cust,
                                                "entry_type": "debit", "amount": refund, "entry_date": cancelled, "bank": False,
                                                "note": f"{label} · Refund"})
            if kept > 0:
                out["bills"].append({
                    "source_type": "asm_booking_kept", "source_id": sid("booking_kept", b["id"]), "type": "sale", "party": cust,
                    "bill_date": cancelled, "amount": kept,
                    "items": [{"description": f"Booking cancellation - {name}", "qty": 1, "rate": kept, "amount": kept}],
                    "note": tidy(b.get("cancel_notes")) or "Booking cancelled",
                })

    # ── vendor payments: named for the vehicle, as the Paid page writes them ──
    for p in snap["vendor_payments"]:
        amount = money(p.get("amount"))
        if amount <= 0 or p.get("vendor_id") not in vendors:
            continue
        v = vehicles.get(p.get("vehicle_id"))
        out["vendor_entries"].append({
            "source_type": "asm_vendor_payment", "source_id": sid("vendor_payment", p["id"]), "party": f"asm:v:{p['vendor_id']}",
            "entry_type": "credit", "amount": amount, "entry_date": day(p.get("payment_date")) or day(p.get("created_at")), "bank": False,
            "note": " · ".join(x for x in [v and v["_name"], tidy(p.get("notes"))] if x) or None,
        })

    # ── spare parts ──
    bought = {p["id"]: p.get("bought_qty") for p in snap.get("vendor_parts") or [] if p.get("bought_qty") is not None}
    txns = defaultdict(list)
    for t in snap["part_transactions"]:
        txns[t.get("part_id")].append(t)
    part_bills = defaultdict(list)
    for p in snap["spare_parts"]:
        name = tidy(p.get("name")) or "Part"
        if tidy(p.get("part_number")):
            name = f"{name} ({tidy(p['part_number'])})"
        if name.lower() in names_taken:
            name = f"{name} #{p['id'][:4]}"
        names_taken.add(name.lower())
        p["_name"] = name
        qty_now = int(money(p.get("quantity")))
        products[f"asm:part:{p['id']}"] = {
            "sku": f"asm:part:{p['id']}", "name": name, "category": tidy(p.get("category")) or "Spare parts",
            "price": money(p.get("selling_price")), "purchase_price": money(p.get("unit_cost")) or None, "barcode": None, "stock": qty_now,
        }
        qty = bought.get(p["id"])
        if qty is None:  # the same reading as Auto Stock Manager's _part_bought_qty
            issued = 0
            for t in txns[p["id"]]:
                if " — " in (t.get("part_name") or "") or t.get("reason") in ("Return to Supplier", "Return"):
                    continue
                issued += (t.get("quantity") or 0) if t.get("type") == "out" else -(t.get("quantity") or 0)
            qty = max(0, qty_now + issued)
        rate = money(p.get("unit_cost"))
        if qty > 0 and rate > 0:
            key = (p.get("vendor_id") if p.get("vendor_id") in vendors else None, tidy(p.get("bill_no")) or None,
                   None if tidy(p.get("bill_no")) else day(p.get("entry_date")) or day(p.get("created_at")))
            part_bills[key].append({"part": p, "qty": qty, "rate": rate})
    for (vendor_id, bill_no, when_key), lines in part_bills.items():
        first = lines[0]["part"]
        items = [{"description": l["part"]["_name"], "qty": l["qty"], "rate": l["rate"], "amount": round(l["qty"] * l["rate"], 2)} for l in lines]
        out["bills"].append({
            "source_type": "asm_parts_bill", "source_id": sid("parts_bill", f"{vendor_id}|{bill_no}|{when_key}"), "type": "purchase",
            "party": f"asm:v:{vendor_id}" if vendor_id else None, "party_name": None if vendor_id else tidy(first.get("supplier")) or None,
            "bill_no": bill_no, "bill_date": when_key or day(first.get("entry_date")) or day(first.get("created_at")),
            "amount": round(sum(i["amount"] for i in items), 2), "items": items, "note": "Spare parts",
        })

    used = {p for b in out["bills"] for p in [b.get("party")] if p}
    used |= {e["party"] for e in out["customer_entries"] + out["vendor_entries"]}
    out["unused_parties"] = len([k for k in parties if k not in used])
    return out


# ── 3. Supabase ──────────────────────────────────────────────────────────
class Supabase:
    def __init__(self):
        self.url = need("SUPABASE_URL").rstrip("/")
        key = need("SUPABASE_SERVICE_ROLE_KEY")
        self.h = {"apikey": key, "Authorization": f"Bearer {key}"}

    def rest(self, method, path, body=None, prefer="return=representation"):
        return http(method, f"{self.url}/rest/v1/{path}", {**self.h, "Prefer": prefer}, body)

    def all(self, table, query):
        rows, start = [], 0
        while True:
            page = self.rest("GET", f"{table}?{query}&limit=1000&offset={start}")
            rows += page
            if len(page) < 1000:
                return rows
            start += 1000

    def owner_id(self, email):
        page = 1
        while True:
            res = http("GET", f"{self.url}/auth/v1/admin/users?page={page}&per_page=200", self.h)
            users = res.get("users") if isinstance(res, dict) else res
            for u in users or []:
                if (u.get("email") or "").lower() == email.lower():
                    return u["id"]
            if not users or len(users) < 200:
                sys.exit(f"No Finance account with the email {email}.")
            page += 1


def existing(sb, owner):
    q = f"owner_id=eq.{owner}"
    return {
        "parties": sb.all("customers", q + "&select=id,name,phone,phone_contact_id,party_type_id"),
        "products": sb.all("products", q + "&select=id,name,sku"),
        "bills": sb.all("business_transactions", q + "&select=id,source_type,source_id"),
        "customer_entries": sb.all("customer_ledger_entries", q + "&select=id,source_type,source_id"),
        "vendor_entries": sb.all("vendor_ledger_entries", q + "&select=id,source_type,source_id"),
        "categories": sb.all("expense_categories", q + "&select=id,name"),
        "types": sb.all("party_types", q + "&select=id,name"),
        "banks": sb.all("bank_accounts", q + "&select=id,name"),
    }


def plan():
    snap = json.load(open(SNAPSHOT))
    out = build(snap)
    sb = Supabase()
    email = need("FINANCE_OWNER_EMAIL")
    owner = sb.owner_id(email)
    have = existing(sb, owner)
    mine = lambda rows: len([r for r in rows if (r.get("source_type") or "").startswith("asm_")])
    print(f"Finance account: {email}")
    print(f"  already has {len(have['parties'])} parties, {len(have['products'])} stock items, "
          f"{len(have['bills']) - mine(have['bills'])} bills and "
          f"{len(have['customer_entries']) + len(have['vendor_entries']) - mine(have['customer_entries']) - mine(have['vendor_entries'])} "
          f"payments of its own (left as they are)")
    print(f"  and {mine(have['bills'])} bills / {mine(have['customer_entries']) + mine(have['vendor_entries'])} payments from an earlier load (updated in place)")
    by_type = defaultdict(lambda: [0, 0.0])
    for b in out["bills"]:
        by_type[b["source_type"]][0] += 1
        by_type[b["source_type"]][1] += b["amount"]
    print("Would write:")
    print(f"  {len(out['parties'])} parties ({out['unused_parties']} with nothing on them yet), {len(out['products'])} stock items, "
          f"{len(out['categories'])} expense categories")
    for t, (n, total) in sorted(by_type.items()):
        print(f"  {n:5d} x {t:24s} NPR {total:,.2f}")
    for name, rows in (("received", out["customer_entries"]), ("paid", out["vendor_entries"])):
        groups = defaultdict(lambda: [0, 0.0])
        for e in rows:
            groups[e["source_type"]][0] += 1
            groups[e["source_type"]][1] += e["amount"] * (1 if e["entry_type"] == "credit" else -1)
        for t, (n, total) in sorted(groups.items()):
            print(f"  {n:5d} x {t:24s} NPR {total:,.2f}  ({name})")
    if out["warnings"]:
        print(f"{len(out['warnings'])} notes:")
        for w in out["warnings"][:40]:
            print("  - " + w)
        if len(out["warnings"]) > 40:
            print(f"  ... and {len(out['warnings']) - 40} more")


def load():
    snap = json.load(open(SNAPSHOT))
    out = build(snap)
    sb = Supabase()
    owner = sb.owner_id(need("FINANCE_OWNER_EMAIL"))
    have = existing(sb, owner)

    # party types and categories
    types = {t["name"]: t["id"] for t in have["types"]}
    for name in ("Customer", "Vendor"):
        if name not in types:
            types[name] = sb.rest("POST", "party_types", {"owner_id": owner, "name": name})[0]["id"]
    cats = {c["name"].lower(): c["id"] for c in have["categories"]}
    for name in sorted(out["categories"]):
        if name.lower() not in cats:
            cats[name.lower()] = sb.rest("POST", "expense_categories", {"owner_id": owner, "name": name, "expense_group": "direct"})[0]["id"]
    bank_id = next((b["id"] for b in have["banks"] if b["name"].lower() == BANK_NAME.lower()), None)
    if any(e.get("bank") for e in out["customer_entries"]) and not bank_id:
        bank_id = sb.rest("POST", "bank_accounts", {"owner_id": owner, "name": BANK_NAME})[0]["id"]

    # parties: by the Auto Stock Manager id kept on them, else the same phone number
    by_key = {p["phone_contact_id"]: p for p in have["parties"] if p.get("phone_contact_id")}
    by_phone = {phone_key(p["phone"]): p for p in have["parties"] if phone_key(p.get("phone"))}
    by_name = {p["name"].strip().lower(): p for p in have["parties"]}
    party_id = {}
    for key, p in out["parties"].items():
        row = by_key.get(key) or (by_phone.get(phone_key(p["phone"])) if phone_key(p["phone"]) else None)
        if row is None and key.startswith("asm:n:"):
            row = by_name.get(p["name"].lower())
        if row is None:
            values = {"owner_id": owner, "name": p["name"], "address": p["address"], "phone_contact_id": key,
                      "party_type_id": types[p["type"]], "phone": p["phone"]}
            row = sb.rest("POST", "customers", values)[0]
            if phone_key(p["phone"]):
                by_phone[phone_key(p["phone"])] = row
        elif not row.get("phone_contact_id"):
            sb.rest("PATCH", f"customers?id=eq.{row['id']}", {"phone_contact_id": key}, prefer="return=minimal")
            row["phone_contact_id"] = key
        by_key[key] = row
        party_id[key] = row["id"]
    print(f"Parties: {len(party_id)}")

    # stock items (quantity is set at the end)
    prod_by_sku = {p["sku"]: p for p in have["products"] if p.get("sku")}
    prod_by_name = {p["name"].strip().lower(): p for p in have["products"]}
    prod_id = {}
    for key, p in out["products"].items():
        values = {"name": p["name"], "sku": p["sku"], "category": p["category"], "price": p["price"],
                  "purchase_price": p["purchase_price"], "barcode": p["barcode"]}
        row = prod_by_sku.get(p["sku"]) or prod_by_name.get(p["name"].lower())
        if row:
            sb.rest("PATCH", f"products?id=eq.{row['id']}", values, prefer="return=minimal")
        else:
            row = sb.rest("POST", "products", {"owner_id": owner, "stock_level": 0, **values})[0]
        prod_id[key] = row["id"]
    print(f"Stock items: {len(prod_id)}")

    # bills
    bill_by_source = {(b["source_type"], b["source_id"]): b["id"] for b in have["bills"] if b.get("source_type")}
    names = {k: p["name"] for k, p in out["parties"].items()}
    for i, b in enumerate(out["bills"], 1):
        values = {
            "type": b["type"], "amount": b["amount"], "note": b.get("note"), "bill_no": b.get("bill_no"), "bill_date": b.get("bill_date"),
            "customer_id": party_id.get(b.get("party")), "party_name": names.get(b.get("party")) or b.get("party_name"),
            "items": b.get("items") or [], "payment_mode": "cash",
            "expense_category_id": cats.get((b.get("category") or "").lower()),
            "source_type": b["source_type"], "source_id": b["source_id"],
        }
        current = bill_by_source.get((b["source_type"], b["source_id"]))
        if current:
            sb.rest("PATCH", f"business_transactions?id=eq.{current}", values, prefer="return=minimal")
        else:
            sb.rest("POST", "business_transactions", {"owner_id": owner, **values}, prefer="return=minimal")
        if i % 100 == 0:
            print(f"  bills {i}/{len(out['bills'])}")
    print(f"Bills: {len(out['bills'])}")

    # money in and out
    for table, side, rows in (("customer_ledger_entries", "customer_id", out["customer_entries"]),
                              ("vendor_ledger_entries", "vendor_id", out["vendor_entries"])):
        have_rows = {(e["source_type"], e["source_id"]): e["id"] for e in have["customer_entries" if side == "customer_id" else "vendor_entries"] if e.get("source_type")}
        for e in rows:
            values = {side: party_id[e["party"]], "entry_type": e["entry_type"], "amount": e["amount"], "note": e.get("note"),
                      "entry_date": e.get("entry_date"), "bank_account_id": bank_id if e.get("bank") else None,
                      "source": "manual", "source_type": e["source_type"], "source_id": e["source_id"]}
            current = have_rows.get((e["source_type"], e["source_id"]))
            if current:
                sb.rest("PATCH", f"{table}?id=eq.{current}", values, prefer="return=minimal")
            else:
                sb.rest("POST", table, {"owner_id": owner, **values}, prefer="return=minimal")
        print(f"{'Received' if side == 'customer_id' else 'Paid'}: {len(rows)}")

    # what is on hand now, as Auto Stock Manager has it (the bills above moved stock by their own count)
    for key, p in out["products"].items():
        sb.rest("PATCH", f"products?id=eq.{prod_id[key]}", {"stock_level": p["stock"]}, prefer="return=minimal")
    print("Stock quantities set. Done.")


if __name__ == "__main__":
    load_env()
    step = sys.argv[1] if len(sys.argv) > 1 else ""
    if step == "fetch":
        fetch()
    elif step == "plan":
        plan()
    elif step == "load":
        if "--yes" not in sys.argv:
            answer = input(f"Write into the Finance account {need('FINANCE_OWNER_EMAIL')}? Type yes: ")
            if answer.strip().lower() != "yes":
                sys.exit("Nothing written.")
        load()
    else:
        sys.exit(__doc__)
