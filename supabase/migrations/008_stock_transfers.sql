-- Two more figures from Replen. Qty. that help an ordering decision, shown on the item details:
--   transfer_in  Quantity in Transfer In: stock already on its way to the store from another location
--   unavailable  Unavailable Qty: stock the store holds but cannot sell or send
alter table public.store_stock add column if not exists transfer_in numeric(12,2) not null default 0;
alter table public.store_stock add column if not exists unavailable numeric(12,2) not null default 0;
