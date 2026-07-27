/* ---------- Participant signing shell (sign.html only) ----------
   Fetches the document for this link's token, renders it via the shared
   engine with only the participant's own signature field actionable, and
   posts the flattened, signed PDF back instead of downloading it locally. */

const SUPABASE_FUNCTIONS_URL = "https://yanaxjuqqhvnrpqwlusb.supabase.co/functions/v1";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhbmF4anVxcWh2bnJwcXdsdXNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NTcxNTEsImV4cCI6MjA5ODMzMzE1MX0.bXyiBMQIe60_TbGqvGwMizr2VRHMoaxxYB5FRoe8TcM";

const token = new URLSearchParams(window.location.search).get("token");

const loadingState = document.getElementById("loadingState");
const errorState = document.getElementById("errorState");
const errorMessage = document.getElementById("errorMessage");
const successState = document.getElementById("successState");
const docToolbar = document.getElementById("docToolbar");
const toolbarDocName = document.getElementById("toolbarDocName");
const toolbarMeta = document.getElementById("toolbarMeta");

downloadBtn.addEventListener("click", submitSignedDocument);

init();

async function init() {
    if (!token) {
        showError("This link is missing its access token. Ask Compliance to resend it.");
        return;
    }

    try {
        const response = await fetch(
            `${SUPABASE_FUNCTIONS_URL}/get-participant-document?token=${encodeURIComponent(token)}`,
            { headers: { Authorization: `Bearer ${SUPABASE_ANON_KEY}`, apikey: SUPABASE_ANON_KEY } }
        );
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "This link is no longer valid.");

        const fullConfig = DOCUMENTS[body.documentType];
        if (!fullConfig) throw new Error("Unrecognised document type.");

        activeDocumentKey = body.documentType;
        workingConfig = configForParticipantStage(fullConfig);

        const pdfBytes = base64ToBytes(body.pdfBase64);
        const numPages = await loadAndRenderDocument(pdfBytes.buffer, workingConfig);

        loadingState.hidden = true;
        pdfContainer.hidden = false;
        docToolbar.hidden = false;
        toolbarDocName.textContent = fullConfig.label;
        toolbarMeta.textContent = `${numPages} page${numPages > 1 ? "s" : ""}`;

        enterSigningMode(workingConfig, numPages);
    } catch (error) {
        console.error(error);
        showError(error.message || "This link is no longer valid.");
    }
}

function showError(message) {
    loadingState.hidden = true;
    errorMessage.textContent = message;
    errorState.hidden = false;
    panelLocked.textContent = "This link isn't valid.";
}

async function submitSignedDocument() {
    let bytes;
    try {
        bytes = await buildSignedPdfBytes(getActiveConfig());
    } catch (error) {
        alert(error.message);
        if (error.missingId) selectTargetById(error.missingId);
        return;
    }

    downloadBtn.disabled = true;
    downloadBtn.textContent = "Sending…";

    try {
        const response = await fetch(`${SUPABASE_FUNCTIONS_URL}/submit-participant-signature`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                apikey: SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ token, pdfBase64: bytesToBase64(bytes) }),
        });
        const responseBody = await response.json();
        if (!response.ok) throw new Error(responseBody.error || "Could not send the signed document.");

        pdfContainer.hidden = true;
        successState.hidden = false;
        collapseSidePanel();
        setStep("download");
    } catch (error) {
        alert(error.message);
        downloadBtn.disabled = false;
        downloadBtn.textContent = "Send signed document";
    }
}

function base64ToBytes(base64) {
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

// Chunked to avoid blowing the call stack on String.fromCharCode(...bigArray)
// for larger PDFs.
function bytesToBase64(bytes) {
    const CHUNK_SIZE = 0x8000;
    let binary = "";
    for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE));
    }
    return btoa(binary);
}
