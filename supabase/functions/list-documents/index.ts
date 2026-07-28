// Compliance-only dashboard list. Never returns token hashes or storage paths.
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const DASHBOARD_COLUMNS =
    "id, document_type, status, participant_name, participant_email, authorised_person_email, created_at, expires_at, link_sent_at, participant_signed_at, finalised_at";

Deno.serve(async (req: Request) => {
    const preflight = handlePreflight(req);
    if (preflight) return preflight;

    if (req.method !== "GET") {
        return jsonResponse(req, 405, { error: "Use GET." });
    }

    const { data, error } = await supabaseAdmin()
        .from("documents")
        .select(DASHBOARD_COLUMNS)
        .order("created_at", { ascending: false });

    if (error) {
        return jsonResponse(req, 500, { error: error.message });
    }

    return jsonResponse(req, 200, { documents: data });
});
