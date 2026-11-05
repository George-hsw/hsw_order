# HSW Orders

Ordering app for Howards Storage World stores. It replaces the weekly Excel ordering sheet (`Ordering feed.xlsx`). Same look and feel as the HSW Quote & Invoice Builder (`../HSW_QUOTE`); different logic.

## How it works
1. Each night NAV's items and each store's stock are copied into Supabase.
2. On a phone, staff scan an item, see stock, qty on order, last week's sales and the MOQ, enter a quantity and press Done.
3. The same order shows on the desktop, grouped by vendor with the cost.
4. **Copy for NAV** puts one vendor's lines on the clipboard (Type, No. and Quantity of a NAV purchase line; `NAV_COLUMNS` in `src/lib/order.ts`). Staff paste them into NAV, then record the NAV order number. Status goes Open, Copied, Ordered in NAV.

Sales history, forecasting and Power BI are not part of this app. Last week's sales is the `Sales (Qty.)` column already in the ordering feed, shown for information only.

## Run it
```
npm install
npm run demo     # sample data, no sign-in, nothing saved
npm test
npm run build
```

## Status
Built and working in demo mode: sign-in screen, tour, Order (scan, search, item sheet, quantity, lines, Copy for NAV), Orders, Reports, Stores (people and sync status).

Not built yet (done when the project goes to git):
- Supabase migrations (tables, Row Level Security, Realtime) and the `OrdersApi` Supabase implementation in `src/lib/api.ts` (the screens only call that interface; `src/lib/demoApi.ts` is the in-memory version).
- Edge function `manage-user` (people and passwords on the Stores tab).
- The nightly NAV sync script and its GitHub Actions workflow.
- Vercel settings and `.env` values (`.env.example`).

## To confirm with HSW
- Paste test: copy one vendor into a real NAV purchase order and check the Type, No. and Quantity land in the right cells (`NAV_COLUMNS` in `src/lib/order.ts`).
- How per-store stock reaches us (OData web service or report export).

## Design
`DESIGN.md` and `CLAUDE.md` rule. New CSS lives at the end of `src/styles.css` and uses tokens only: `.facts`, `.stepper`, and the Orders, Reports and Stores phone card rules.

## NAV fields used
**Replen. Qty. (per store and item, from the field list HSW supplied)**
- Location Code (3) is the store. It matches the store code in `src/data/stores.json` (for example 14122 for Mt Gravatt).
- Item No. (1) and Variant Code (2) identify the item.
- Inventory (4) is "In stock". Quantity on Purchase Order (5) is "On order".
- Vendor No. (33) is the vendor, which drives the Vendor filter on the Order tab and the grouping for Copy for NAV (a purchase order is per vendor).
- PO Blocked (41) and Blocked (40) give a warning. Unavailable Qty (59) is not used yet.

**Retail Items** supplies description, barcode, vendor item no., division, category, status, price and units. The ordering feed also has MOQ, Store Cost and Sales (Qty.), which are not in the Replen. Qty. field list: confirm which table they come from before the sync is built.
