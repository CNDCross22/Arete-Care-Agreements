// Compliance-only. Hands back a short-lived signed URL for this document's
// stored PDF so the dashboard can offer a copy before the files are deleted.
//
// A signed URL rather than the bytes: the download then streams straight from
// Storage instead of being base64'd through a function, and Storage's own
// `download` option sets the attachment filename, so the browser saves it as
// "SIL Service Agreement - Name.pdf" rather than a UUID path.
//
// Storage paths themselves never leave this function -- only the signed URL,
// which expires in a minute.
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { supabaseAdmin, DOCUMENTS_BUCKET, documentFileName } from "../_shared/supabaseAdmin.ts";

const SIGNED_URL_TTL_SECONDS = 60;

Deno.serve(async (req: Request) => {
    const preflight = handlePreflight(req);
    if (preflight) return preflight;

    if (req.method !== "GET") {
        return jsonResponse(req, 405, { error: "Use GET." });
    }

    const id = new URL(req.url).searchParams.get("id");
    if (!id) {
        return jsonResponse(req, 400, { error: "Missing ?id=" });
    }

    const supabase = supabaseAdmin();

    const { data: doc, error } = await supabase
        .from("documents")
        .select("id, document_type, participant_name, file_final, file_participant_signed, file_original")
        .eq("id", id)
        .maybeSingle();

    if (error) {
        return jsonResponse(req, 500, { error: `Could not look up the document: ${error.message}` });
    }
    if (!doc) {
        return jsonResponse(req, 404, { error: "No document with that id." });
    }

    // Most complete version available. Once mark-fully-executed has run, all
    // three are null and there is nothing to hand back.
    const path = doc.file_final ?? doc.file_participant_signed ?? doc.file_original;
    if (!path) {
        return jsonResponse(req, 410, {
            error: "The stored files for this document have been deleted.",
        });
    }

    const fileName = documentFileName(doc.document_type, doc.participant_name);

    const signed = await supabase.storage
        .from(DOCUMENTS_BUCKET)
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS, { download: fileName });

    if (signed.error || !signed.data?.signedUrl) {
        return jsonResponse(req, 500, {
            error: `Could not prepare the download: ${signed.error?.message ?? "no URL returned"}`,
        });
    }

    return jsonResponse(req, 200, { url: signed.data.signedUrl, fileName });
});
