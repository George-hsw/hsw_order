-- South Wharf's NAV location code in Replen. Qty. is 13006C (the "Location Code2" column). 13006 is a closed location.
-- The seed in 005 used 13006, so correct the row that already exists. Does nothing if it was already fixed or renamed.
update public.stores set code = '13006C' where name = 'South Wharf' and code = '13006';
