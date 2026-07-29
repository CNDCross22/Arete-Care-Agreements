-- The team leader signs in the portal again, so they need their own link and a
-- resting state once they've signed.
--
-- Reinstates authorised_token_hash (dropped in 20260728010000 when the
-- countersigning stage was removed) and adds Countersigned: both parties have
-- signed, and the document is waiting for Compliance to close it out. That step
-- stays manual because closing out deletes the PDFs, so it needs a human
-- checkpoint rather than firing the moment the team leader signs.
alter table public.documents add column if not exists authorised_token_hash text unique;
alter table public.documents add column if not exists authorised_signed_at timestamptz;

create index if not exists documents_authorised_token_hash_idx
    on public.documents (authorised_token_hash);

alter table public.documents drop constraint if exists documents_status_check;
alter table public.documents add constraint documents_status_check check (status in (
    'Uploaded',
    'AwaitingParticipantSignature',
    'ParticipantSigned',
    'AwaitingAuthorisedSignature',
    'Countersigned',
    'FullyExecuted',
    'Purged'
));
