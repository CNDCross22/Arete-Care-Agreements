// Closing a document out: delete every stored PDF, kill both links, and mark
// the row FullyExecuted. The row itself is kept, so the dashboard still shows
// the document was completed and when -- only the content and the means of
// reaching it are removed.
//
// Shared because two callers need identical behaviour: submit-countersignature
// does this automatically once the completed copy has been emailed out, and
// mark-fully-executed does it on Compliance's say-so when that email didn't
// land. One implementation means the two can't drift into deleting different
// things.
import { supabaseAdmin, DOCUMENTS_BUCKET } from "./supabaseAdmin.ts";

type Admin = ReturnType<typeof supabaseAdmin>;

export interface CloseOutTarget {
    id: string;
    file_original: string | null;
    file_participant_signed: string | null;
    file_final: string | null;
}

export const CLOSE_OUT_COLUMNS = "id, file_original, file_participant_signed, file_final";

export async function closeOutDocument(
    supabase: Admin,
    doc: CloseOutTarget,
): Promise<{ ok: true; filesDeleted: number } | { ok: false; error: string }> {
    // Delete the files before clearing the row. Doing it the other way round
    // would lose the only record of where they live if the update succeeded and
    // the delete then failed, orphaning them in the bucket forever.
    const paths = [doc.file_original, doc.file_participant_signed, doc.file_final].filter(Boolean) as string[];
    if (paths.length) {
        const { error } = await supabase.storage.from(DOCUMENTS_BUCKET).remove(paths);
        if (error) {
            return { ok: false, error: `Could not delete the stored files, so nothing was changed: ${error.message}` };
        }
    }

    const now = new Date().toISOString();
    const { error } = await supabase
        .from("documents")
        .update({
            status: "FullyExecuted",
            finalised_at: now,
            purged_at: now,
            // Kills both links: lookups match on these hashes, and a null can
            // never be matched by an incoming token.
            participant_token_hash: null,
            authorised_token_hash: null,
            file_original: null,
            file_participant_signed: null,
            file_final: null,
        })
        .eq("id", doc.id);

    if (error) {
        return { ok: false, error: `Could not update the document record: ${error.message}` };
    }

    return { ok: true, filesDeleted: paths.length };
}
