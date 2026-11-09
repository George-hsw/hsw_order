# HSW

One app for Howards Storage World stores: **Quote** (quotes, tax invoices, deposits and payments, PDFs and email), **Order** and **Orders** (the weekly stock order, replacing `Ordering feed.xlsx`), **Sales** (the weekly Power BI reports), **Analytics** (admin) and **Stores** (admin: stores, people and what each can do). It was two apps, HSW Quote and HSW Orders; it is now one site, one sign-in and one Supabase project (the one HSW Quote always used). Same look and feel throughout: `DESIGN.md` rules.

## How it works
1. Each night NAV's items and each store's stock are copied into Supabase.
2. A store **chooses a vendor** (a NAV purchase order is made for one vendor). The screen lists the vendor's whole range for that store: in stock, on order, sold last week, MOQ. Staff type a quantity beside each item, or scan to jump to one. It saves as they go.
3. **Save and start another order** leaves that vendor's order on hold; it shows under *Orders in progress* and can be resumed. Each store has at most one unfinished order per vendor.
4. The same order shows on the desktop and the phone, live.
5. **Copy for NAV** puts the order on the clipboard as purchase lines (Type, No. and Quantity of a NAV purchase line; `NAV_COLUMNS` in `src/lib/order.ts`). Staff paste them into NAV, then record the NAV order number. Status goes Open, Copied, Ordered in NAV.

Sales history, forecasting and Power BI are not part of this app. Last week's sales is the `Sales (Qty.)` column already in the ordering feed, shown for information only.

## Quotes and invoices
The **Quote** tab: New (scan or search items, build a Quote or Tax Invoice, PDF, email), Documents, and Reports. Money rules match the old workbook: prices include GST, GST = total / 11, line = qty x price x (1 - disc%), numbers `Q-<STORE>-<n>` and `INV-<STORE>-<n>`, quotes valid 30 days, invoices due in 7 days. Managers and the admin record deposits and payments (`record-payment`), which email the store's managers; `send-document` emails the PDF. Prices come from `public/items.json`, a copy that ships with the site. The quote being built is one live draft per person (`src/lib/draftSync.ts`).

Who can do what is the same everywhere: the admin sees every store and manages people; a manager or Store person has full access inside their own store; a shared store login (`stores.email`) acts as that store's manager. One person can be in several stores. Row Level Security enforces it, not the screens (`012_store_members.sql`, `017_store_full_access.sql`).

## Run it
```
npm install
npm run demo     # sample data, no sign-in, nothing saved
npm test
npm run build
```

## Status
Built and tested on demo data and a local copy of the database (`npm run demo`): sign-in, tour, Quote (New, Documents, Reports), Order, Orders, Sales, Analytics, Stores.

Written but **not yet run against the real Supabase project or real NAV** (so expect a first-run fix or two):
- `supabase/migrations`: **001 to 017 are the Quote schema, unchanged**. 018 adds what ordering needs to the shared tables (item columns, `in_any_store`, stock and sync tables). 019 to 024 are orders, 025 Sales, 026 Analytics, 027 permissions. All additive: nothing in the Quote tables changes, except the South Wharf store code (13006 to 13006C).
- `supabase/functions`: `manage-user`, `set-store-password`, `record-payment`, `send-document`.
- `scripts/sync-dynamics.mjs` and `.github/workflows/sync-dynamics.yml`: the one nightly NAV sync, for both apps.

## Setting it up
1. **Supabase**: the project HSW Quote already uses. In GitHub, Settings, Secrets and variables, Actions: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF`, `RESEND_API_KEY` and `MAIL_FROM` (a Resend-verified sender, for payment notices and emailed quotes). Authentication, Email stays on and "Allow new users to sign up" stays off. Take a backup first, then run **Deploy Supabase**: it applies only 018 to 027 (001 to 017 are already there) and deploys the functions.
2. **The admin login** already exists (`george.mridun@hsw.com.au`). Everyone else is added in Stores.
3. **Vercel**: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (the same project) and, for Myriad Pro, `VITE_ADOBE_FONTS_KIT`.
4. **NAV sync**: `DYN_ITEMS_URL`, `DYN_STOCK_URL` and either `DYN_USER` + `DYN_ACCESS_KEY` or the tenant sign-in. This one sync fills items and store stock for both Quote and Order. **Update prices** (`publish-prices.yml`) then writes `public/items.json`, the price list the quote builder reads, so quoting still works if NAV or Supabase is down.
5. **People**: sign in as the admin, open Stores, add a manager to each store. Existing Quote people and store logins keep working.

The sync keeps each store's previous data when its feed is empty, much smaller than yesterday, or has duplicate rows, and the Stores tab shows it as Failed.

## To confirm with HSW
- Paste test: copy one vendor into a real NAV purchase order and check the Type, No. and Quantity land in the right cells (`NAV_COLUMNS` in `src/lib/order.ts`).
- How per-store stock reaches us (OData web service or report export).

## Design
`DESIGN.md` and `CLAUDE.md` rule. New CSS lives at the end of `src/styles.css` and uses tokens only: `.facts`, `.stepper`, and the Orders and Stores phone card rules.

## NAV fields used
**Replen. Qty. (per store and item, from the field list HSW supplied)**
- Location Code (3) is the store. It matches the store code in `src/data/stores.json` (for example 14122 for Mt Gravatt).
- Item No. (1) and Variant Code (2) identify the item.
- Inventory (4) is "In stock". Quantity on Purchase Order (5) is "On order".
- Vendor No. (33) is the vendor, which drives the Vendor filter on the Order tab and the grouping for Copy for NAV (a purchase order is per vendor).
- PO Blocked (41) and Blocked (40) give a warning. Unavailable Qty (59) is not used yet.

**Retail Items** supplies description, barcode, vendor item no., division, category, status, price and units. The ordering feed also has MOQ, Store Cost and Sales (Qty.), which are not in the Replen. Qty. field list: confirm which table they come from before the sync is built.

## Sales tab

Finance publishes three Power BI exports each week: Detailed Sales Report, Australian Weekly Sales and Daily Sales. The admin opens Sales, Upload, and drops the three .xlsx files in. They are read in the browser, previewed (stores matched, warnings shown) and only the figures are saved, never the files. Migration `012_sales.sql` holds the tables. A store reads only its own rows (Row Level Security); it learns its rank ("6th of 24") and chain averages through security-definer functions, never another store's figures. Item rows keep the last 26 weeks. Detailed Sales is ex GST and leaves out Elfa (non-APL items), so item totals are lower than the weekly store total by design; the screens say so. Detailed Sales sheets are matched to stores by tab name (see `TAB_STORE` in `src/lib/sales/parse.ts`).
