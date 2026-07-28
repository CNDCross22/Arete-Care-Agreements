-- The Authorised Person no longer signs digitally through this portal -- they
-- sign using their own tools/process outside the system, so there's no link
-- for them to open and no token to gate it. Compliance still records their
-- email (authorised_person_email) and tracks the hand-off via status.
drop index if exists public.documents_authorised_token_hash_idx;
alter table public.documents drop column if exists authorised_token_hash;
