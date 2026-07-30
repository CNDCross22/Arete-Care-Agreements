// Token-gated, public. Accepts the flattened final PDF (the participant's
// signature and the team leader's, both baked in by the client), stores it,
// emails the completed agreement to the reports mailbox and to the
// representative who signed it, and then closes the document out itself.
//
// Closing out deletes the stored PDFs, so it only happens once both of those
// emails have been accepted -- at that point the copies that matter are out of
// here, and keeping another one would just be an unnecessary place for
// participant data to sit. If either send fails the document is left at
// Countersigned with its files intact, because then someone is missing their
// copy and a person needs to deal with it (see mark-fully-executed).
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import {
    supabaseAdmin,
    DOCUMENTS_BUCKET,
    DOCUMENT_TYPE_LABELS,
    documentFileName,
} from "../_shared/supabaseAdmin.ts";
import { closeOutDocument } from "../_shared/closeOut.ts";
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

    // Two emails rather than one addressed to both: the reports mailbox is being
    // told to file the agreement, the representative is being given their own
    // copy of what they signed. Same attachment, different things to say.
    //
    // The signature is already saved by this point, so a mail failure must not
    // read as a failed signing to the team leader. Logged for the function logs
    // instead, and the document keeps its files so Compliance can pick it up.
    const label = DOCUMENT_TYPE_LABELS[doc.document_type] ?? doc.document_type;
    const attachment = {
        name: documentFileName(doc.document_type, doc.participant_name),
        contentBytes: pdfBase64,
    };

    try {
        await sendGraphEmail({
            to: Deno.env.get("FINAL_COPY_EMAIL") ?? FINAL_COPY_FALLBACK,
            subject: `Completed ${label}`,
            html: `
                <p>Please find the completed ${escapeHtml(label)} attached for your records.</p>
                <p>The agreement has been fully executed and includes all required signatures.</p>
                <p>Kindly save this document in the participant's file.</p>
            `,
            attachment,
        });

        await sendGraphEmail({
            to: doc.participant_email,
            subject: `Completed ${label}`,
            html: `
                <p>Dear Participant Representative,</p>
                <p>Please find the completed ${escapeHtml(label)} attached for your records.</p>
                <p>The agreement has now been signed by both parties.</p>
                <p>If you have any questions or require any clarification, please don't hesitate to contact us.</p>
            `,
            attachment,
        });
    } catch (error) {
        console.error(`Failed to email a final copy for document ${doc.id}:`, error);
        // Deliberately still a success for the team leader: their signature is
        // stored. The document just stays at Countersigned for a person to
        // close out once both copies have gone out.
        return jsonResponse(req, 200, { ok: true, closedOut: false });
    }

    // Both emails were accepted, so the copies exist outside this system and the
    // stored PDFs and links have no further purpose. Closing out is withheld if
    // either send failed, since deleting the files is what makes those emails
    // the only copies. The row stays as the record of what happened.
    const closed = await closeOutDocument(supabase, {
        id: doc.id,
        file_original: doc.file_original,
        file_participant_signed: doc.file_participant_signed,
        file_final: storagePath,
    });

    if (!closed.ok) {
        // Same reasoning: nothing here is the team leader's problem. The
        // document is left at Countersigned and Compliance sees the action.
        console.error(`Emailed the final copies but could not close out document ${doc.id}: ${closed.error}`);
        return jsonResponse(req, 200, { ok: true, closedOut: false });
    }

    return jsonResponse(req, 200, { ok: true, closedOut: true });
});
