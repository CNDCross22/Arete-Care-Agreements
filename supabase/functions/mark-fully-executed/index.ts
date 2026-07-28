// Compliance-only. The Authorised Person signs outside this system entirely
// (their own tools/process) -- there's no file or signature for us to verify
// here. This just lets Compliance record that it came back fully executed
// once they've confirmed it, closing out the document on the dashboard.
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

Deno.serve(async (req: Request) => {
    const preflight = handlePreflight(req);
    if (preflight) return preflight;

    if (req.method !== "POST") {
        return jsonResponse(req, 405, { error: "Use POST." });
    }

    let body: { documentId?: string };
    try {
        body = await req.json();
    } catch {
        return jsonResponse(req, 400, { error: "Expected a JSON body." });
    }

    const { documentId } = body;
    if (!documentId) return jsonResponse(req, 400, { error: "Missing documentId." });

    const supabase = supabaseAdmin();

    const { data: doc, error: fetchError } = await supabase
        .from("documents")
        .select("id, status")
        .eq("id", documentId)
        .maybeSingle();

    if (fetchError) return jsonResponse(req, 500, { error: fetchError.message });
    if (!doc) return jsonResponse(req, 404, { error: "No document with that id." });
    if (doc.status !== "AwaitingAuthorisedSignature") {
        return jsonResponse(req, 400, {
            error: `This document isn't awaiting an authorised person's signature (current status: ${doc.status}).`,
        });
    }

    const { error: updateError } = await supabase
        .from("documents")
        .update({ status: "FullyExecuted", finalised_at: new Date().toISOString() })
        .eq("id", documentId);

    if (updateError) {
        return jsonResponse(req, 500, { error: `Could not update the document record: ${updateError.message}` });
    }

    return jsonResponse(req, 200, { ok: true });
});
