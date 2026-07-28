// Compliance-only. Accepts a pre-filled PDF for one specific participant and
// stores it. No auth check here -- deliberate, see the "Auth (compliance)"
// decision in the architecture plan.
//
// Note this deliberately does NOT issue a signing link: the document lands at
// 'Uploaded' with no token at all, and stays there until Compliance presses
// Send on the dashboard (see send-participant-link). That keeps "created" and
// "the participant can now reach it" as two separate, reviewable steps.
//
// The authorised person's (team leader's) email is collected here, up front --
// not later at hand-off time -- because once the participant signs, the
// hand-off to them happens automatically (see submit-participant-signature).
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin, DOCUMENTS_BUCKET, VALID_DOCUMENT_TYPES } from "../_shared/supabaseAdmin.ts";

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
        authorisedPersonEmail?: string;
    };
    try {
        body = await req.json();
    } catch {
        return jsonResponse(req, 400, { error: "Expected a JSON body." });
    }

    const { documentType, participantName, participantEmail, pdfBase64, authorisedPersonEmail } = body;

    if (!documentType || !VALID_DOCUMENT_TYPES.includes(documentType as never)) {
        return jsonResponse(req, 400, { error: `documentType must be one of: ${VALID_DOCUMENT_TYPES.join(", ")}` });
    }
    if (!participantName?.trim() || !participantEmail?.trim()) {
        return jsonResponse(req, 400, { error: "participantName and participantEmail are required." });
    }
    if (!authorisedPersonEmail?.trim()) {
        return jsonResponse(req, 400, { error: "authorisedPersonEmail (team leader's email) is required." });
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
            status: "Uploaded",
            participant_name: participantName.trim(),
            participant_email: participantEmail.trim(),
            authorised_person_email: authorisedPersonEmail.trim(),
            file_original: storagePath,
        })
        .select("id")
        .single();

    if (insert.error) {
        // Roll back the upload so a failed row doesn't leave an orphaned file.
        await supabase.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
        return jsonResponse(req, 500, { error: `Could not create the document record: ${insert.error.message}` });
    }

    return jsonResponse(req, 201, { documentId });
});
