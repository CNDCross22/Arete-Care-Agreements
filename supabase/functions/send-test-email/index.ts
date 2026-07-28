// Sample/manual test for the Microsoft Graph email integration -- confirms the
// Entra ID app registration + Mail.Send permission + client-credentials flow
// actually work end-to-end before wiring real automation into
// submit-participant-signature. Not part of the real signing flow; safe to
// remove once the integration is confirmed working, or keep as a diagnostic.
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { sendGraphEmail } from "../_shared/graphMail.ts";

Deno.serve(async (req: Request) => {
    const preflight = handlePreflight(req);
    if (preflight) return preflight;

    if (req.method !== "POST") {
        return jsonResponse(req, 405, { error: "Use POST." });
    }

    let body: { to?: string };
    try {
        body = await req.json();
    } catch {
        return jsonResponse(req, 400, { error: "Expected a JSON body." });
    }

    if (!body.to?.trim()) {
        return jsonResponse(req, 400, { error: "Missing 'to' email address." });
    }

    try {
        await sendGraphEmail({
            to: body.to.trim(),
            subject: "Arete Care Signature Portal - test email",
            html: "<p>This is a sample test email from the Arete Care Signature Portal's Microsoft Graph integration.</p><p>If you're reading this, sending works.</p>",
        });
    } catch (error) {
        return jsonResponse(req, 500, { error: error instanceof Error ? error.message : String(error) });
    }

    return jsonResponse(req, 200, { ok: true });
});
