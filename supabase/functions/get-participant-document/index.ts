// Token-gated, public. Returns the document type + original PDF bytes for a
// participant link -- but only while it's still awaiting their signature, so
// a link can't be reloaded to peek at a later stage or reused after signing.
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin, DOCUMENTS_BUCKET } from "../_shared/supabaseAdmin.ts";
import { lookupByParticipantToken } from "../_shared/documentLookup.ts";

// Same generic message for "not found," "expired," and "already signed" so a
// stale/guessed link can't be used to distinguish which of those is true.
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

    const doc = await lookupByParticipantToken(token);
    if (!doc || doc.status !== "AwaitingParticipantSignature") {
        return jsonResponse(req, 404, { error: INVALID_LINK_ERROR });
    }

    const download = await supabaseAdmin().storage.from(DOCUMENTS_BUCKET).download(doc.file_original);
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
