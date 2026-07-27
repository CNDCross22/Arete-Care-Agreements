// Compliance-only. Manual hand-off: Compliance has reviewed the
// participant-signed document and picks the Authorised Person's email at this
// moment (not a fixed mailbox -- see the architecture plan). Issues their
// countersign link and moves the document into the second signing stage.
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { generateToken, hashToken } from "../_shared/tokens.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";

const FRONTEND_BASE_URL = "https://cndcross22.github.io/Arete-Care-Agreements";

Deno.serve(async (req: Request) => {
    const preflight = handlePreflight(req);
    if (preflight) return preflight;

    if (req.method !== "POST") {
        return jsonResponse(req, 405, { error: "Use POST." });
    }

    let body: { documentId?: string; authorisedPersonEmail?: string };
    try {
        body = await req.json();
    } catch {
        return jsonResponse(req, 400, { error: "Expected a JSON body." });
    }

    const { documentId, authorisedPersonEmail } = body;
    if (!documentId) return jsonResponse(req, 400, { error: "Missing documentId." });
    if (!authorisedPersonEmail?.trim()) return jsonResponse(req, 400, { error: "authorisedPersonEmail is required." });

    const supabase = supabaseAdmin();

    const { data: doc, error: fetchError } = await supabase
        .from("documents")
        .select("id, status")
        .eq("id", documentId)
        .maybeSingle();

    if (fetchError) return jsonResponse(req, 500, { error: fetchError.message });
    if (!doc) return jsonResponse(req, 404, { error: "No document with that id." });
    if (doc.status !== "ParticipantSigned") {
        return jsonResponse(req, 400, {
            error: `This document isn't ready to send to an authorised person (current status: ${doc.status}).`,
        });
    }

    const authorisedToken = generateToken();
    const authorisedTokenHash = await hashToken(authorisedToken);

    const { error: updateError } = await supabase
        .from("documents")
        .update({
            status: "AwaitingAuthorisedSignature",
            authorised_token_hash: authorisedTokenHash,
            authorised_person_email: authorisedPersonEmail.trim(),
        })
        .eq("id", documentId);

    if (updateError) {
        return jsonResponse(req, 500, { error: `Could not update the document record: ${updateError.message}` });
    }

    return jsonResponse(req, 200, {
        // Not retrievable later -- only the hash is stored, same as the
        // participant link. Compliance must show/copy this now.
        authorisedLink: `${FRONTEND_BASE_URL}/countersign.html?token=${authorisedToken}`,
    });
});
