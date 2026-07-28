// Compliance-only. Emails the participant their signing link -- the explicit
// "Send" step that create-document deliberately leaves undone.
//
// Every send mints a FRESH token and overwrites the stored hash, which
// invalidates any link sent previously. That's not a workaround, it's the only
// coherent behaviour available: raw tokens are never stored (only their hash),
// so an already-sent link is unrecoverable by design. Re-sending therefore
// means "issue a new link", and the old one must stop working or there'd be
// two live links to the same document.
//
// Only allowed before the participant has signed -- once they have, re-issuing
// a link would let the document be signed twice.
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { generateToken, hashToken } from "../_shared/tokens.ts";
import { supabaseAdmin, DOCUMENT_TYPE_LABELS } from "../_shared/supabaseAdmin.ts";
import { sendGraphEmail, escapeHtml } from "../_shared/graphMail.ts";

const FRONTEND_BASE_URL = "https://cndcross22.github.io/Arete-Care-Agreements";
const SENDABLE_STATUSES = ["Uploaded", "AwaitingParticipantSignature"];

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

    if (!body.documentId?.trim()) {
        return jsonResponse(req, 400, { error: "documentId is required." });
    }

    const supabase = supabaseAdmin();

    const { data: doc, error: lookupError } = await supabase
        .from("documents")
        .select("id, document_type, status, participant_name, participant_email")
        .eq("id", body.documentId.trim())
        .maybeSingle();

    if (lookupError) {
        return jsonResponse(req, 500, { error: `Could not look up the document: ${lookupError.message}` });
    }
    if (!doc) {
        return jsonResponse(req, 404, { error: "No such document." });
    }
    if (!SENDABLE_STATUSES.includes(doc.status)) {
        return jsonResponse(req, 409, {
            error: "This document has already been signed by the participant, so its link can't be sent again.",
        });
    }

    const participantToken = generateToken();
    const participantTokenHash = await hashToken(participantToken);
    const participantLink = `${FRONTEND_BASE_URL}/sign.html?token=${participantToken}`;

    // Send first, then record. If the email fails we leave the stored hash
    // untouched, so a previously-working link keeps working rather than being
    // silently killed by a send that never landed.
    const label = DOCUMENT_TYPE_LABELS[doc.document_type] ?? doc.document_type;
    try {
        await sendGraphEmail({
            to: doc.participant_email,
            subject: `Your ${label} is ready to sign`,
            html: `
                <p>Hi ${escapeHtml(doc.participant_name)},</p>
                <p>Your ${escapeHtml(label)} is ready for you to review and sign online.</p>
                <p><a href="${participantLink}">Open your document to sign</a></p>
                <p>This link is personal to you, so please don't forward it.</p>
            `,
        });
    } catch (error) {
        console.error(`Failed to email participant for document ${doc.id}:`, error);
        return jsonResponse(req, 502, {
            error: `Could not send the email: ${error instanceof Error ? error.message : String(error)}`,
        });
    }

    const update = await supabase
        .from("documents")
        .update({
            status: "AwaitingParticipantSignature",
            participant_token_hash: participantTokenHash,
            link_sent_at: new Date().toISOString(),
        })
        .eq("id", doc.id);

    if (update.error) {
        return jsonResponse(req, 500, {
            error: `The email was sent, but the document record could not be updated: ${update.error.message}`,
        });
    }

    return jsonResponse(req, 200, { ok: true, sentTo: doc.participant_email });
});
