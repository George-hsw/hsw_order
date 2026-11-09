-- The real store list: codes, login emails, addresses and phones as supplied by HSW (23 stores).
-- Existing rows are matched by store name and updated; stores not on the list are made inactive, never deleted,
-- so any document that points at them stays intact. Owner email and ABN are still filled in by the admin.
-- Left out on purpose: a second "South Wharf" row (code 3006C) that shares southwharf@hsw.com.au with 13006.

-- Codes are now 2 to 6 letters or digits (for example 12064 or 4217F).
alter table public.stores drop constraint if exists stores_code_check;
alter table public.stores add constraint stores_code_check check (code ~ '^[A-Z0-9]{2,6}$');

create temporary table incoming (name text, code text, email text, address text, suburb text, phone text) on commit drop;
insert into incoming values
    ('Artarmon', '12064', 'artarmon@hsw.com.au', 'Home HQ North Shore, LG01, 1 Frederick St', 'Artarmon NSW 2064', '02 9437 1955'),
    ('Aspley', '14034', 'aspley@hsw.com.au', 'Shop 9, 825 Zillmere Rd', 'Aspley QLD 4034', '07 3862 7633'),
    ('Brookvale', '12100', 'brookvale@hsw.com.au', 'Westfield Warringah Mall, Level 1, Shops 112–117', 'Brookvale NSW 2100', '02 9170 3754'),
    ('Bundall', '4217F', 'bundall@hsw.com.au', 'Showroom D, 29–45 Ashmore Rd', 'Bundall QLD 4217', '07 5527 6049'),
    ('Cambridge', '17170', 'cambridge@hsw.com.au', 'Unit 5, Building A, 66 Kennedy Dr', 'Cambridge TAS 7170', '03 6216 0411'),
    ('Cheltenham', '13192', 'cheltenham@hsw.com.au', 'Westfield Southland, Shop 2061, Level 2, 1239 Nepean Hwy', 'Cheltenham VIC 3192', '03 9583 9155'),
    ('Fortitude Valley', '14006', 'fortitudevalley@hsw.com.au', 'Shop 7, Homemaker The Valley North, Cnr Wickham St & Montpelier Rd', 'Fortitude Valley QLD 4006', '07 3216 0222'),
    ('Fyshwick', '2609F', 'fyshwick@hsw.com.au', 'Shop 23, Canberra Outlet Centre, 337 Canberra Ave', 'Fyshwick ACT 2609', '02 6280 5552'),
    ('Kotara', '12289', 'kotara@hsw.com.au', 'Shop 2, 150 Park Ave', 'Kotara NSW 2289', '02 4952 9333'),
    ('Maroochydore', '14558', 'maroochydore@hsw.com.au', 'Shop 4, 70–98 Dalton Dr', 'Maroochydore QLD 4558', '07 5479 3833'),
    ('Mile End', '15031', 'mileend@hsw.com.au', 'Shop 22, 122–138 Railway Terrace', 'Mile End South SA 5031', '08 8152 0400'),
    ('Moore Park', '12033', 'moorepark@hsw.com.au', 'Supa Centa Moore Park, Shop 07, 2 Todman Ave', 'Kensington NSW 2033', '02 9697 2777'),
    ('Mornington', '13931', 'mornington@hsw.com.au', 'HomeCo Peninsula, Shop D8, 1128–1132 Nepean Hwy', 'Mornington VIC 3931', '03 5973 5399'),
    ('Mt. Gravatt', '14122', 'mtgravatt@hsw.com.au', 'Westfield Mt Gravatt, Shop MM8, Kessels Rd', 'Mount Gravatt QLD 4122', '07 3422 2003'),
    ('Northbridge', '12063', 'northbridge@hsw.com.au', 'Northbridge Plaza, 79–113 Sailors Bay Rd', 'Northbridge NSW 2063', '02 9958 7064'),
    ('Nunawading', '13131', 'nunawading@hsw.com.au', 'Home HQ Nunawading, Shop 5, 372–394 Whitehorse Rd', 'Nunawading VIC 3131', '03 9894 8411'),
    ('Port Macquarie', '12444', 'portmacquarie@hsw.com.au', 'Port Home Zone, Shop A9, 160 Hastings River Dr', 'Port Macquarie NSW 2444', '02 6584 3500'),
    ('Rhodes', '2138F', 'rhodes@hsw.com.au', 'Rhodes Waterside Shopping Centre, Shop 58, 1 Rider Blvd', 'Rhodes NSW 2138', '02 9736 3111'),
    ('Richmond', '13121', 'richmond@hsw.com.au', 'Victoria Gardens Shopping Centre, Shop SP043, Cnr Victoria St & Burnley St', 'Richmond VIC 3121', '03 9428 4060'),
    ('Robina', '14232', 'robina@hsw.com.au', 'Robina Town Centre, Shop 4237, Robina Town Centre Dr', 'Robina QLD 4230', '07 5578 7875'),
    ('Subiaco', '16008', 'subiaco@hsw.com.au', '427 Hay St', 'Subiaco WA 6008', '08 9381 4599'),
    ('South Wharf', '13006', 'southwharf@hsw.com.au', 'DFO South Wharf Homemaker Hub, Level 1, 20 Convention Centre Pl', 'South Wharf VIC 3006', '03 9682 0911'),
    ('Macquarie Park', '12113', 'macquariepark@hsw.com.au', 'Macquarie Centre, Level 4, Shop 420, Cnr Herring Rd & Waterloo Rd', 'Macquarie Park NSW 2113', '02 9888 6655');

-- Free the login emails and codes before reusing them, and stop old stores counting towards the 25 cap.
update public.stores set active = false where lower(name) not in (select lower(name) from incoming);

update public.stores s
   set code = i.code, email = i.email, address = i.address, suburb = i.suburb, phone = i.phone, active = true
  from incoming i
 where lower(s.name) = lower(i.name);

insert into public.stores (name, code, email, address, suburb, phone)
select i.name, i.code, i.email, i.address, i.suburb, i.phone
  from incoming i
 where not exists (select 1 from public.stores s where lower(s.name) = lower(i.name));
