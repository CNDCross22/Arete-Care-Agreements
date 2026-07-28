// Compliance-only. Accepts a pre-filled PDF for one specific participant,
// stores it, and issues their signing link. No auth check here -- deliberate,
// see the "Auth (compliance)" decision in the architecture plan.
//
// The authorised person's (team leader's) email is collected here, up front --
// not later at hand-off time -- because once the participant signs, the
// hand-off to them happens automatically (see submit-participant-signature).
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { generateToken, hashToken } from "../_shared/tokens.ts";
import {
    supabaseAdmin,
    DOCUMENTS_BUCKET,
    VALID_DOCUMENT_TYPES,
    DOCUMENT_TYPE_LABELS,
} from "../_shared/supabaseAdmin.ts";
import { sendGraphEmail, escapeHtml } from "../_shared/graphMail.ts";

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

    const participantLink = `${FRONTEND_BASE_URL}/sign.html?token=${participantToken}`;

    // Email the participant their link. The document already exists at this
    // point, so a mail failure shouldn't fail the request -- instead report it
    // back so Compliance knows to send the link (still returned below) by hand.
    let emailSent = false;
    let emailError: string | null = null;
    try {
        const label = DOCUMENT_TYPE_LABELS[documentType] ?? documentType;
        await sendGraphEmail({
            to: participantEmail.trim(),
            subject: `Your ${label} is ready to sign`,
            html: `
                <p>Hi ${escapeHtml(participantName.trim())},</p>
                <p>Your ${escapeHtml(label)} is ready for you to review and sign online.</p>
                <p><a href="${participantLink}">Open your document to sign</a></p>
                <p>This link is personal to you — please don't forward it.</p>
            `,
        });
        emailSent = true;
    } catch (error) {
        emailError = error instanceof Error ? error.message : String(error);
        console.error(`Failed to email participant for document ${documentId}:`, error);
    }

    return jsonResponse(req, 201, {
        documentId,
        // Not retrievable later -- only the hash is stored. The compliance UI
        // must show/copy this now, since regenerating it invalidates any
        // link already sent out.
        participantLink,
        emailSent,
        emailError,
    });
});
