// Token-gated, public. Accepts the flattened, participant-signed PDF (built
// client-side by the same pdf-lib logic as the local tool -- this function
// stays dumb about PDF internals), stores it, and moves straight to
// AwaitingAuthorisedSignature. The hand-off to the authorised person (team
// leader) is automatic -- their email was already collected at document
// creation, so there's no separate manual "send" step anymore: this function
// emails them the signed PDF directly. They sign using their own tools
// outside this system; Compliance marks it done via mark-fully-executed once
// that's back.
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { generateToken, hashToken } from "../_shared/tokens.ts";
import { supabaseAdmin, DOCUMENTS_BUCKET, DOCUMENT_TYPE_LABELS } from "../_shared/supabaseAdmin.ts";
import { lookupByParticipantToken } from "../_shared/documentLookup.ts";
import { sendGraphEmail, escapeHtml } from "../_shared/graphMail.ts";

const INVALID_LINK_ERROR = "This link is no longer valid. It may have expired or already been used.";
const FRONTEND_BASE_URL = "https://portal.aretecare.com.au";

Deno.serve(async (req: Request) => {
    const preflight = handlePreflight(req);
    if (preflight) return preflight;

    if (req.method !== "POST") {
        return jsonResponse(req, 405, { error: "Use POST." });
    }

    let body: { token?: string; pdfBase64?: string };
    try {
        body = await req.json();
    } catch {
        return jsonResponse(req, 400, { error: "Expected a JSON body." });
    }

    const { token, pdfBase64 } = body;
    if (!token) return jsonResponse(req, 400, { error: "Missing token." });
    if (!pdfBase64) return jsonResponse(req, 400, { error: "Missing pdfBase64." });

    const doc = await lookupByParticipantToken(token);
    if (!doc || doc.status !== "AwaitingParticipantSignature") {
        return jsonResponse(req, 404, { error: INVALID_LINK_ERROR });
    }

    let pdfBytes: Uint8Array;
    try {
        pdfBytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
    } catch {
        return jsonResponse(req, 400, { error: "pdfBase64 could not be decoded." });
    }

    const storagePath = `${doc.id}/participant-signed.pdf`;
    const supabase = supabaseAdmin();

    const upload = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (upload.error) {
        return jsonResponse(req, 500, { error: `Could not store the signed PDF: ${upload.error.message}` });
    }

    // The team leader signs in the portal too, so issue their own link now.
    // A separate token from the participant's means the participant's link can
    // never be replayed into the countersigning stage.
    const authorisedToken = generateToken();
    const authorisedTokenHash = await hashToken(authorisedToken);

    const update = await supabase
        .from("documents")
        .update({
            status: "AwaitingAuthorisedSignature",
            file_participant_signed: storagePath,
            participant_signed_at: new Date().toISOString(),
            authorised_token_hash: authorisedTokenHash,
        })
        .eq("id", doc.id);

    if (update.error) {
        return jsonResponse(req, 500, { error: `Could not update the document record: ${update.error.message}` });
    }

    // The participant's signature is already saved at this point -- an email
    // hiccup shouldn't turn into an error for them. Log it for Compliance to
    // notice in the function logs and follow up manually if it happens.
    try {
        const label = DOCUMENT_TYPE_LABELS[doc.document_type] ?? doc.document_type;
        const countersignLink = `${FRONTEND_BASE_URL}/countersign.html?token=${authorisedToken}`;
        await sendGraphEmail({
            to: doc.authorised_person_email,
            subject: `${label} for Review and Signature`,
            html: `
                <p>Dear Team Leader,</p>
                <p>Please find the link to the ${escapeHtml(label)} of ${escapeHtml(doc.participant_name)} below for your review and signature.</p>
                <p><a href="${countersignLink}">Open the document to review and sign</a></p>
            `,
        });
    } catch (error) {
        console.error(`Failed to email authorised person for document ${doc.id}:`, error);
    }

    return jsonResponse(req, 200, { ok: true });
});
