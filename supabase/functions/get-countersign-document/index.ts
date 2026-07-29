// Token-gated, public. Returns the document type + participant-signed PDF
// bytes for the Authorised Person's countersign link. The participant's
// signature is already flattened into these bytes (from Phase 2), so it just
// shows up as part of the document -- no special read-only handling needed.
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin, DOCUMENTS_BUCKET } from "../_shared/supabaseAdmin.ts";
import { lookupByAuthorisedToken } from "../_shared/documentLookup.ts";

const INVALID_LINK_ERROR = "This link is no longer valid. It may have expired or already been used.";

Deno.serve(async (req: Request) => {
    const preflight = handlePreflight(req);
    if (preflight) return preflight;

    if (req.method !== "GET") {
        return jsonResponse(req, 405, { error: "Use GET." });
    }

    const token = new URL(req.url).searchParams.get("token");
    if (!token) {
        return jsonResponse(req, 400, { error: "Missing ?token=" });
    }

    const doc = await lookupByAuthorisedToken(token);
    if (!doc || doc.status !== "AwaitingAuthorisedSignature" || !doc.file_participant_signed) {
        return jsonResponse(req, 404, { error: INVALID_LINK_ERROR });
    }

    const download = await supabaseAdmin().storage.from(DOCUMENTS_BUCKET).download(doc.file_participant_signed);
    if (download.error) {
        return jsonResponse(req, 500, { error: `Could not load the document: ${download.error.message}` });
    }

    const bytes = new Uint8Array(await download.data.arrayBuffer());
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);

    return jsonResponse(req, 200, {
        documentType: doc.document_type,
        pdfBase64: btoa(binary),
    });
});
