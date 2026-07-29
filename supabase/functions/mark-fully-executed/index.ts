// Compliance-only fallback for closing out a signed document.
//
// Normally nothing calls this: submit-countersignature closes the document out
// itself once the completed copy has been emailed to the reports mailbox. A
// document only sits at Countersigned when that email failed, which is exactly
// when a person has to look at it -- take a copy from the dashboard, then close
// it out here.
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { closeOutDocument, CLOSE_OUT_COLUMNS } from "../_shared/closeOut.ts";

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
        .select(`status, ${CLOSE_OUT_COLUMNS}`)
        .eq("id", documentId)
        .maybeSingle();

    if (fetchError) return jsonResponse(req, 500, { error: fetchError.message });
    if (!doc) return jsonResponse(req, 404, { error: "No document with that id." });
    if (doc.status !== "Countersigned") {
        return jsonResponse(req, 400, {
            error: `This document isn't ready to close out yet. Both the participant and the team leader have to sign first (current status: ${doc.status}).`,
        });
    }

    const result = await closeOutDocument(supabase, doc);
    if (!result.ok) {
        return jsonResponse(req, 500, { error: result.error });
    }

    return jsonResponse(req, 200, { ok: true, filesDeleted: result.filesDeleted });
});
