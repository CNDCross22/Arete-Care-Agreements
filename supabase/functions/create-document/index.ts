// Compliance-only. Accepts a pre-filled PDF for one specific participant,
// stores it, and issues their signing link. No auth check here -- deliberate,
// see the "Auth (compliance)" decision in the architecture plan.
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { generateToken, hashToken } from "../_shared/tokens.ts";
import { supabaseAdmin, DOCUMENTS_BUCKET, VALID_DOCUMENT_TYPES } from "../_shared/supabaseAdmin.ts";

// Where the frontend's participant-signing page lives; kept as one constant
// since it's not a secret (the link is protected by the token, not by hiding
// this base URL) but does need updating if the GitHub Pages site ever moves.
const FRONTEND_BASE_URL = "https://cndcross22.github.io/Arete-Care-Agreements";

Deno.serve(async (req: Request) => {
    const preflight = handlePreflight(req);
    if (preflight) return preflight;

    if (req.method !== "POST") {
        return jsonResponse(req, 405, { error: "Use POST." });
    }

    let body: {
        documentType?: string;
        participantName?: string;
        participantEmail?: string;
        pdfBase64?: string;
    };
    try {
        body = await req.json();
    } catch {
        return jsonResponse(req, 400, { error: "Expected a JSON body." });
    }

    const { documentType, participantName, participantEmail, pdfBase64 } = body;

    if (!documentType || !VALID_DOCUMENT_TYPES.includes(documentType as never)) {
        return jsonResponse(req, 400, { error: `documentType must be one of: ${VALID_DOCUMENT_TYPES.join(", ")}` });
    }
    if (!participantName?.trim() || !participantEmail?.trim()) {
        return jsonResponse(req, 400, { error: "participantName and participantEmail are required." });
    }
    if (!pdfBase64) {
        return jsonResponse(req, 400, { error: "pdfBase64 is required." });
    }

    let pdfBytes: Uint8Array;
    try {
        pdfBytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
    } catch {
        return jsonResponse(req, 400, { error: "pdfBase64 could not be decoded." });
    }

    const documentId = crypto.randomUUID();
    const participantToken = generateToken();
    const participantTokenHash = await hashToken(participantToken);
    const storagePath = `${documentId}/original.pdf`;

    const supabase = supabaseAdmin();

    const upload = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .upload(storagePath, pdfBytes, { contentType: "application/pdf" });
    if (upload.error) {
        return jsonResponse(req, 500, { error: `Could not store the PDF: ${upload.error.message}` });
    }

    const insert = await supabase
        .from("documents")
        .insert({
            id: documentId,
            document_type: documentType,
            status: "AwaitingParticipantSignature",
            participant_token_hash: participantTokenHash,
            participant_name: participantName.trim(),
            participant_email: participantEmail.trim(),
            file_original: storagePath,
        })
        .select("id")
        .single();

    if (insert.error) {
        // Roll back the upload so a failed row doesn't leave an orphaned file.
        await supabase.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
        return jsonResponse(req, 500, { error: `Could not create the document record: ${insert.error.message}` });
    }

    return jsonResponse(req, 201, {
        documentId,
        // Not retrievable later -- only the hash is stored. The compliance UI
        // must show/copy this now, since regenerating it invalidates any
        // link already sent out.
        participantLink: `${FRONTEND_BASE_URL}/sign.html?token=${participantToken}`,
    });
});
