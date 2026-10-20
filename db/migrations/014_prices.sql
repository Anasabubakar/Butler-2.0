-- Price watch: the price of a saved product page, when Butler first saw it and now.
alter table items add column price numeric(14, 2);
alter table items add column price_first numeric(14, 2);
alter table items add column price_currency text;
alter table items add column price_checked_at timestamptz;
