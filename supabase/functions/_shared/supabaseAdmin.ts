// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected into every Edge
// Function by Supabase -- no manual `supabase secrets set` needed for these two.
// The service role key bypasses Row Level Security, which is fine here: RLS on
// `documents` has no policies at all specifically because only this trusted,
// server-side client is ever meant to touch the table (see the migration).
import { createClient } from "npm:@supabase/supabase-js@2";

export function supabaseAdmin() {
    return createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
}

export const DOCUMENTS_BUCKET = "documents";

export const VALID_DOCUMENT_TYPES = ["service", "schedule", "consent", "sil"] as const;
export type DocumentType = (typeof VALID_DOCUMENT_TYPES)[number];
