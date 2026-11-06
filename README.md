# HSW Orders

Ordering app for Howards Storage World stores. It replaces the weekly Excel ordering sheet (`Ordering feed.xlsx`). Same look and feel as the HSW Quote & Invoice Builder (`../HSW_QUOTE`); different logic.

## How it works
1. Each night NAV's items and each store's stock are copied into Supabase.
2. A store **chooses a vendor** (a NAV purchase order is made for one vendor). The screen lists the vendor's whole range for that store: in stock, on order, sold last week, MOQ. Staff type a quantity beside each item, or scan to jump to one. It saves as they go.
3. **Save and start another order** leaves that vendor's order on hold; it shows under *Orders in progress* and can be resumed. Each store has at most one unfinished order per vendor.
4. The same order shows on the desktop and the phone, live.
5. **Copy for NAV** puts the order on the clipboard as purchase lines (Type, No. and Quantity of a NAV purchase line; `NAV_COLUMNS` in `src/lib/order.ts`). Staff paste them into NAV, then record the NAV order number. Status goes Open, Copied, Ordered in NAV.

Sales history, forecasting and Power BI are not part of this app. Last week's sales is the `Sales (Qty.)` column already in the ordering feed, shown for information only.

## Run it
```
npm install
npm run demo     # sample data, no sign-in, nothing saved
npm test
npm run build
```

## Status
Built: sign-in, tour, Order (scan, search, Vendor filter, item popup, quantity, Copy for NAV), Orders, Sales, Stores. Runs on demo data with `npm run demo`.

Written but **not yet run against a real Supabase project or real NAV** (so expect a first-run fix or two):
- `supabase/migrations`: 001 stores and people, 002 items and store stock, 003 orders (with the `open_order`, `save_line`, `set_order_status` functions), 004 grants, 005 the stores, 006 one order per vendor. They pass a Postgres syntax check; the functions have not been executed.
- `supabase/functions/manage-user`: adds people, sets passwords (admin only). Copied from the Quote app.
- `src/lib/supabaseApi.ts`: the screens' data layer for Supabase, including Realtime.
- `scripts/sync-dynamics.mjs` and `.github/workflows/sync-dynamics.yml`: the nightly NAV sync.

## Setting it up
1. **Supabase** (a new project for Orders): in GitHub, Settings, Secrets and variables, Actions, add `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD` and `SUPABASE_PROJECT_REF`. Run the **Deploy Supabase** workflow: it applies the migrations and deploys `manage-user`.
2. **The admin login:** in the Supabase dashboard, Authentication, Users, add `george.mridun@hsw.com.au` with a password and tick Auto Confirm. Everyone else is added from the Stores tab.
3. **Vercel:** import the repo and set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and, for Myriad Pro, `VITE_ADOBE_FONTS_KIT`.
4. **NAV sync:** add the secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DYN_ITEMS_URL`, `DYN_STOCK_URL` and either `DYN_USER` + `DYN_ACCESS_KEY` or the three Entra ones. Run **Sync Dynamics** with *discover* ticked to print the real field names, set `DYN_ITEMS_FIELD_MAP` / `DYN_STOCK_FIELD_MAP` (Actions variables) to match, then run it for real. If NAV is only reachable on HSW's network, use a self-hosted runner (see the workflow).
5. **People:** sign in as the admin, open Stores, add a manager to each store.

The sync keeps each store's previous data when its feed is empty, much smaller than yesterday, or has duplicate rows, and the Stores tab shows it as Failed. Variant rows are skipped for now (an order line is per item).

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
