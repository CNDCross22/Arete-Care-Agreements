-- Arete Care Signature Portal: compliance/participant/authorised-person workflow.
-- One row per document instance (one specific participant's copy of one document type).

create table if not exists public.documents (
    id uuid primary key default gen_random_uuid(),

    document_type text not null check (document_type in ('service', 'schedule', 'consent', 'sil')),
    status text not null default 'Uploaded' check (status in (
        'Uploaded',
        'AwaitingParticipantSignature',
        'ParticipantSigned',
        'AwaitingAuthorisedSignature',
        'FullyExecuted',
        'Purged'
    )),

    -- Tokens are never stored raw -- only their SHA-256 hash, looked up on request.
    participant_token_hash text not null unique,
    authorised_token_hash text unique,

    participant_name text not null,
    participant_email text not null,
    authorised_person_email text,

    -- Paths into the "documents" Storage bucket, not the files themselves.
    file_original text not null,
    file_participant_signed text,
    file_final text,

    created_at timestamptz not null default now(),
    expires_at timestamptz not null default (now() + interval '30 days'),
    participant_signed_at timestamptz,
    finalised_at timestamptz,
    purged_at timestamptz
);

-- The purge job scans by expiry; token lookups scan by hash -- both need to be fast.
create index if not exists documents_expires_at_idx on public.documents (expires_at);
create index if not exists documents_participant_token_hash_idx on public.documents (participant_token_hash);
create index if not exists documents_authorised_token_hash_idx on public.documents (authorised_token_hash);

-- RLS on with no policies: only the service_role key (used exclusively by the
-- Edge Functions) can touch this table. No anon/authenticated client ever
-- talks to Postgres directly, so no policies are needed or wanted.
alter table public.documents enable row level security;
