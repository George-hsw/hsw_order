-- What NAV's Retail Items says about a promotion: the Shelf No. field. An item with a value there is on promotion from the supplier.
-- The text is kept as NAV gives it, and the app only checks that there is one.
alter table public.items add column if not exists promotion text;
create index if not exists items_promotion_idx on public.items (code) where promotion is not null;
