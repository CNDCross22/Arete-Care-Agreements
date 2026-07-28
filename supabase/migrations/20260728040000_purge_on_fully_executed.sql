-- Marking a document fully executed now deletes its PDFs from Storage and
-- invalidates the participant link, keeping only the record that it happened.
-- The file path columns have to become nullable so the row can honestly say
-- "no files here" rather than pointing at objects that no longer exist.
alter table public.documents alter column file_original drop not null;
