-- Team Leader / Authorised Person email is now collected up front at document
-- creation time (not later at hand-off) -- so it's required, like the
-- participant's own name/email.
alter table public.documents alter column authorised_person_email set not null;

-- The 30-day link-expiry threshold is removed for now: Phase 5 (retention
-- automation / purge job) was never built, so nothing actually enforces or
-- acts on this column -- new documents no longer get an automatic expiry date.
alter table public.documents alter column expires_at drop default;
alter table public.documents alter column expires_at drop not null;
