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

// Human-readable names for emails. Mirrors the labels the frontend shows.
export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
    service: "Service Agreement",
    schedule: "Schedule of Supports",
    consent: "Consent Form",
    sil: "SIL Service Agreement",
};

// What the PDF is called when it reaches a person, e.g.
// "SIL Service Agreement - Carlo Dizon.pdf". Storage paths stay UUID-keyed --
// this is only for files leaving the system.
export function documentFileName(documentType: string, participantName: string): string {
    const label = DOCUMENT_TYPE_LABELS[documentType] ?? documentType;
    // Strip characters Windows/macOS reject in filenames, plus control chars,
    // so an unusual participant name can't produce an unsaveable attachment.
    const safeName = participantName
        .replace(/[\\/:*?"<>|]/g, "")
        // deno-lint-ignore no-control-regex
        .replace(/[\x00-\x1f]/g, "")
        .replace(/\s+/g, " ")
        .trim();

    return safeName ? `${label} - ${safeName}.pdf` : `${label}.pdf`;
}
