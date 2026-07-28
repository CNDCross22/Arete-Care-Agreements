-- Sending the participant's link is now a separate, explicit step (a button on
-- the compliance dashboard) rather than something create-document does
-- automatically. Two consequences for the schema:
--
-- 1. A document exists before any token does, so participant_token_hash can no
--    longer be NOT NULL -- it stays null while the row sits at 'Uploaded' and
--    is filled in the first time the link is sent.
-- 2. Track when the link was last sent, so the dashboard can distinguish
--    "never sent" from "sent, still waiting" and label its button accordingly.
--
-- Note the raw token is still never stored -- resending mints a fresh token
-- (invalidating the previous link) precisely because the old one is
-- unrecoverable by design.
alter table public.documents alter column participant_token_hash drop not null;
alter table public.documents add column if not exists link_sent_at timestamptz;
