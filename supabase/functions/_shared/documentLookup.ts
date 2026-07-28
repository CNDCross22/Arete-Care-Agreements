// Shared token validation used by every token-gated endpoint. Centralising the
// hash lookup + expiry check here keeps that anti-replay logic in one place
// instead of copy-pasted per function -- see the "Link/token model" section of
// the architecture plan. (Only the participant gets a portal link/token -- the
// Authorised Person signs outside this system with their own tools, see the
// "Send to authorised person" hand-off in compliance.html.)
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
    if (new Date(data.expires_at) < new Date()) return null;
    return data;
}
