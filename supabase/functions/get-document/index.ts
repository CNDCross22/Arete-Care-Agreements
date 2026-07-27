// Compliance-only detail view for one document. Same field scope as
// list-documents -- no token hashes or storage paths leave this function.
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const DETAIL_COLUMNS =
    "id, document_type, status, participant_name, participant_email, authorised_person_email, created_at, expires_at, participant_signed_at, finalised_at, purged_at";

Deno.serve(async (req: Request) => {
    const preflight = handlePreflight(req);
    if (preflight) return preflight;

    if (req.method !== "GET") {
        return jsonResponse(req, 405, { error: "Use GET." });
    }

    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
        return jsonResponse(req, 400, { error: "Missing ?id=" });
    }

    const { data, error } = await supabaseAdmin()
        .from("documents")
        .select(DETAIL_COLUMNS)
        .eq("id", id)
        .maybeSingle();

    if (error) {
        return jsonResponse(req, 500, { error: error.message });
    }
    if (!data) {
        return jsonResponse(req, 404, { error: "No document with that id." });
    }

    return jsonResponse(req, 200, { document: data });
});
