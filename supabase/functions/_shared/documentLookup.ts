// Shared token validation used by every token-gated endpoint. Centralising the
// hash lookup here keeps that lookup logic in one place instead of
// copy-pasted per function -- see the "Link/token model" section of the
// architecture plan. (Only the participant gets a portal link/token -- the
// Authorised Person signs outside this system with their own tools.)
//
// NOTE: there is no expiry check here for now. The 30-day link-expiry/purge
// idea from the original plan (Phase 5) was never built, so links don't stop
// working after any particular time -- only status (e.g. already signed)
// invalidates a link. Revisit if/when retention automation is actually built.
import { hashToken } from "./tokens.ts";
import { supabaseAdmin } from "./supabaseAdmin.ts";

const COLUMNS =
    "id, document_type, status, file_original, file_participant_signed, file_final, expires_at";

export async function lookupByParticipantToken(token: string) {
    const hash = await hashToken(token);
    const { data, error } = await supabaseAdmin()
        .from("documents")
        .select(COLUMNS)
        .eq("participant_token_hash", hash)
        .maybeSingle();

    if (error || !data) return null;
    return data;
}
