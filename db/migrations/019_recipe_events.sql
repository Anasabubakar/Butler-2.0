-- Recipes that start when something happens: a new email matching a Gmail search, or a
-- POST to the recipe's own secret link (from Zapier, IFTTT, Tasker, a script...).
alter table recipes add column email_query text check (length(email_query) between 1 and 300);
alter table recipes add column email_after timestamptz;   -- emails after this one count as new
alter table recipes add column email_error text;          -- why the last email check failed
alter table recipes add column hook_hash text unique;     -- sha-256 of the secret link's token
alter table recipes add column hook_secret text;          -- the token itself, locked in the vault
