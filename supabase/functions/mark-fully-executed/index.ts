// Compliance-only. The Authorised Person signs outside this system entirely
// (their own tools/process) -- there's no file or signature for us to verify
// here. This lets Compliance record that it came back fully executed once
// they've confirmed it, closing out the document on the dashboard.
//
// Closing out also cleans up: the stored PDFs are deleted and the participant's
// link is invalidated, since the signed document now lives with the team leader
// and this portal has no further use for a copy. The row itself is kept, so the
// dashboard still shows the document was completed and when -- only the content
// and the means of reaching it are removed.
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin, DOCUMENTS_BUCKET } from "../_shared/supabaseAdmin.ts";

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
        .select("id, status, file_original, file_participant_signed, file_final")
        .eq("id", documentId)
        .maybeSingle();

    if (fetchError) return jsonResponse(req, 500, { error: fetchError.message });
    if (!doc) return jsonResponse(req, 404, { error: "No document with that id." });
    if (doc.status !== "AwaitingAuthorisedSignature") {
        return jsonResponse(req, 400, {
            error: `This document isn't awaiting the team leader's signature (current status: ${doc.status}).`,
        });
    }

    // Delete the files before clearing the row. Doing it the other way round
    // would lose the only record of where they live if the update succeeded and
    // the delete then failed, orphaning them in the bucket forever.
    const paths = [doc.file_original, doc.file_participant_signed, doc.file_final].filter(Boolean) as string[];
    if (paths.length) {
        const { error: removeError } = await supabase.storage.from(DOCUMENTS_BUCKET).remove(paths);
        if (removeError) {
            return jsonResponse(req, 500, {
                error: `Could not delete the stored files, so nothing was changed: ${removeError.message}`,
            });
        }
    }

    const now = new Date().toISOString();
    const { error: updateError } = await supabase
        .from("documents")
        .update({
            status: "FullyExecuted",
            finalised_at: now,
            purged_at: now,
            // Kills the participant's link: lookups match on this hash, and a
            // null can never be matched by an incoming token.
            participant_token_hash: null,
            file_original: null,
            file_participant_signed: null,
            file_final: null,
        })
        .eq("id", documentId);

    if (updateError) {
        return jsonResponse(req, 500, { error: `Could not update the document record: ${updateError.message}` });
    }

    return jsonResponse(req, 200, { ok: true, filesDeleted: paths.length });
});
