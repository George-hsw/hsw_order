-- Qty. Sold not Posted: units already sold at the till but not yet posted in NAV. Actual stock = inventory - this.
-- Apply this BEFORE the nightly sync that sends the field, or the stock upsert fails.
alter table public.store_stock add column if not exists qty_sold_not_posted numeric(12,2) not null default 0;
