-- The stores (NAV Location Codes). Safe to run twice: a store that already exists is left alone.
-- To change a store later, use the Stores tab.
insert into public.stores (name, code, address, suburb, phone, email) values
  ('Artarmon', '12064', 'Home HQ North Shore, LG01, 1 Frederick St', 'Artarmon NSW 2064', '02 9437 1955', 'artarmon@hsw.com.au'),
  ('Aspley', '14034', 'Shop 9, 825 Zillmere Rd', 'Aspley QLD 4034', '07 3862 7633', 'aspley@hsw.com.au'),
  ('Brookvale', '12100', 'Westfield Warringah Mall, Level 1, Shops 112–117', 'Brookvale NSW 2100', '02 9170 3754', 'brookvale@hsw.com.au'),
  ('Bundall', '4217F', 'Showroom D, 29–45 Ashmore Rd', 'Bundall QLD 4217', '07 5527 6049', 'bundall@hsw.com.au'),
  ('Cambridge', '17170', 'Unit 5, Building A, 66 Kennedy Dr', 'Cambridge TAS 7170', '03 6216 0411', 'cambridge@hsw.com.au'),
  ('Cheltenham', '13192', 'Westfield Southland, Shop 2061, Level 2, 1239 Nepean Hwy', 'Cheltenham VIC 3192', '03 9583 9155', 'cheltenham@hsw.com.au'),
  ('Fortitude Valley', '14006', 'Shop 7, Homemaker The Valley North, Cnr Wickham St & Montpelier Rd', 'Fortitude Valley QLD 4006', '07 3216 0222', 'fortitudevalley@hsw.com.au'),
  ('Fyshwick', '2609F', 'Shop 23, Canberra Outlet Centre, 337 Canberra Ave', 'Fyshwick ACT 2609', '02 6280 5552', 'fyshwick@hsw.com.au'),
  ('Kotara', '12289', 'Shop 2, 150 Park Ave', 'Kotara NSW 2289', '02 4952 9333', 'kotara@hsw.com.au'),
  ('Maroochydore', '14558', 'Shop 4, 70–98 Dalton Dr', 'Maroochydore QLD 4558', '07 5479 3833', 'maroochydore@hsw.com.au'),
  ('Mile End', '15031', 'Shop 22, 122–138 Railway Terrace', 'Mile End South SA 5031', '08 8152 0400', 'mileend@hsw.com.au'),
  ('Moore Park', '12033', 'Supa Centa Moore Park, Shop 07, 2 Todman Ave', 'Kensington NSW 2033', '02 9697 2777', 'moorepark@hsw.com.au'),
  ('Mornington', '13931', 'HomeCo Peninsula, Shop D8, 1128–1132 Nepean Hwy', 'Mornington VIC 3931', '03 5973 5399', 'mornington@hsw.com.au'),
  ('Mt. Gravatt', '14122', 'Westfield Mt Gravatt, Shop MM8, Kessels Rd', 'Mount Gravatt QLD 4122', '07 3422 2003', 'mtgravatt@hsw.com.au'),
  ('Northbridge', '12063', 'Northbridge Plaza, 79–113 Sailors Bay Rd', 'Northbridge NSW 2063', '02 9958 7064', 'northbridge@hsw.com.au'),
  ('Nunawading', '13131', 'Home HQ Nunawading, Shop 5, 372–394 Whitehorse Rd', 'Nunawading VIC 3131', '03 9894 8411', 'nunawading@hsw.com.au'),
  ('Port Macquarie', '12444', 'Port Home Zone, Shop A9, 160 Hastings River Dr', 'Port Macquarie NSW 2444', '02 6584 3500', 'portmacquarie@hsw.com.au'),
  ('Rhodes', '2138F', 'Rhodes Waterside Shopping Centre, Shop 58, 1 Rider Blvd', 'Rhodes NSW 2138', '02 9736 3111', 'rhodes@hsw.com.au'),
  ('Richmond', '13121', 'Victoria Gardens Shopping Centre, Shop SP043, Cnr Victoria St & Burnley St', 'Richmond VIC 3121', '03 9428 4060', 'richmond@hsw.com.au'),
  ('Robina', '14232', 'Robina Town Centre, Shop 4237, Robina Town Centre Dr', 'Robina QLD 4230', '07 5578 7875', 'robina@hsw.com.au'),
  ('Subiaco', '16008', '427 Hay St', 'Subiaco WA 6008', '08 9381 4599', 'subiaco@hsw.com.au'),
  ('South Wharf', '13006', 'DFO South Wharf Homemaker Hub, Level 1, 20 Convention Centre Pl', 'South Wharf VIC 3006', '03 9682 0911', 'southwharf@hsw.com.au'),
  ('Macquarie Park', '12113', 'Macquarie Centre, Level 4, Shop 420, Cnr Herring Rd & Waterloo Rd', 'Macquarie Park NSW 2113', '02 9888 6655', 'macquariepark@hsw.com.au')
on conflict do nothing;
