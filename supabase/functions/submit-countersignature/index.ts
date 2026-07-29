// Token-gated, public. Accepts the flattened final PDF (the participant's
// signature and the team leader's, both baked in by the client) and stores it.
//
// This stops at Countersigned rather than FullyExecuted: both parties have
// signed, but closing out deletes the PDFs, so that stays a deliberate action
// by Compliance (see mark-fully-executed) instead of firing automatically here.
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import {
    supabaseAdmin,
    DOCUMENTS_BUCKET,
    DOCUMENT_TYPE_LABELS,
    documentFileName,
} from "../_shared/supabaseAdmin.ts";
import { lookupByAuthorisedToken } from "../_shared/documentLookup.ts";
import { sendGraphEmail, escapeHtml } from "../_shared/graphMail.ts";

const INVALID_LINK_ERROR = "This link is no longer valid. It may have expired or already been used.";

// Where the completed agreement lands. A placeholder for now, so it's an Edge
// Function secret rather than a constant: changing it is `supabase secrets set
// FINAL_COPY_EMAIL=...`, no code change or redeploy. The fallback keeps the
// document from going nowhere if the secret is ever missing.
const FINAL_COPY_FALLBACK = "carlo@aretecare.com.au";

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

    const doc = await lookupByAuthorisedToken(token);
    if (!doc || doc.status !== "AwaitingAuthorisedSignature") {
        return jsonResponse(req, 404, { error: INVALID_LINK_ERROR });
    }

    let pdfBytes: Uint8Array;
    try {
        pdfBytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
    } catch {
        return jsonResponse(req, 400, { error: "pdfBase64 could not be decoded." });
    }

    const storagePath = `${doc.id}/final.pdf`;
    const supabase = supabaseAdmin();

    const upload = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .upload(storagePath, pdfBytes, { contentType: "application/pdf", upsert: true });
    if (upload.error) {
        return jsonResponse(req, 500, { error: `Could not store the final PDF: ${upload.error.message}` });
    }

    const update = await supabase
        .from("documents")
        .update({
            status: "Countersigned",
            file_final: storagePath,
            authorised_signed_at: new Date().toISOString(),
            // Their link has done its job. Nulling the hash means it can never
            // resolve again, the same way a purged document's does not.
            authorised_token_hash: null,
        })
        .eq("id", doc.id);

    if (update.error) {
        return jsonResponse(req, 500, { error: `Could not update the document record: ${update.error.message}` });
    }

    // The signature is already saved by this point, so a mail failure must not
    // read as a failed signing to the team leader. Logged for the function logs
    // instead; Compliance can still reach the file until they close it out.
    try {
        const label = DOCUMENT_TYPE_LABELS[doc.document_type] ?? doc.document_type;
        await sendGraphEmail({
            to: Deno.env.get("FINAL_COPY_EMAIL") ?? FINAL_COPY_FALLBACK,
            subject: `Completed ${label}`,
            html: `
                <p>Please find the completed ${escapeHtml(label)} attached for your records.</p>
                <p>The agreement has been fully executed and includes all required signatures.</p>
                <p>Kindly save this document in the participant's file.</p>
            `,
            attachment: {
                name: documentFileName(doc.document_type, doc.participant_name),
                contentBytes: pdfBase64,
            },
        });
    } catch (error) {
        console.error(`Failed to email the final copy for document ${doc.id}:`, error);
    }

    return jsonResponse(req, 200, { ok: true });
});
