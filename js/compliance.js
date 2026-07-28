// Compliance portal: create a document + participant link, and see the status
// of everything created so far. No login (see the architecture plan's "Auth
// (compliance)" decision) -- these Edge Function URLs + anon key are public by
// design; the anon key is a project-level API key, not a user credential.
const SUPABASE_FUNCTIONS_URL = "https://yanaxjuqqhvnrpqwlusb.supabase.co/functions/v1";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlhbmF4anVxcWh2bnJwcXdsdXNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NTcxNTEsImV4cCI6MjA5ODMzMzE1MX0.bXyiBMQIe60_TbGqvGwMizr2VRHMoaxxYB5FRoe8TcM";

const DOCUMENT_TYPE_LABELS = {
    service: "Service Agreement",
    schedule: "Schedule of Supports",
    consent: "Consent Form",
    sil: "SIL Service Agreement",
};

const STATUS_LABELS = {
    Uploaded: "Not sent yet",
    AwaitingParticipantSignature: "Awaiting participant",
    ParticipantSigned: "Participant signed",
    AwaitingAuthorisedSignature: "Awaiting authorised person",
    FullyExecuted: "Fully executed",
    Purged: "Expired / purged",
};

const createForm = document.getElementById("createForm");
const createBtn = document.getElementById("createBtn");
const createError = document.getElementById("createError");
const linkResult = document.getElementById("linkResult");
const refreshBtn = document.getElementById("refreshBtn");
const docTableBody = document.getElementById("docTableBody");

createForm.addEventListener("submit", handleCreate);
refreshBtn.addEventListener("click", loadDocuments);
docTableBody.addEventListener("click", (event) => {
    const sendBtn = event.target.closest("[data-send-link]");
    if (sendBtn) {
        handleSendLink(sendBtn);
        return;
    }
    const markBtn = event.target.closest("[data-mark-executed]");
    if (markBtn) handleMarkFullyExecuted(markBtn.dataset.markExecuted);
});

loadDocuments();

async function handleCreate(event) {
    event.preventDefault();
    hideCreateError();
    linkResult.hidden = true;

    const documentType = document.getElementById("documentType").value;
    const participantName = document.getElementById("participantName").value.trim();
    const participantEmail = document.getElementById("participantEmail").value.trim();
    const file = document.getElementById("pdfFile").files[0];
    const authorisedPersonEmail = document.getElementById("teamLeaderEmail").value.trim();

    if (!file) {
        showCreateError("Choose a PDF file.");
        return;
    }
    if (!authorisedPersonEmail) {
        showCreateError("Enter the team leader's email.");
        return;
    }

    createBtn.disabled = true;
    createBtn.textContent = "Creating…";

    try {
        const pdfBase64 = await fileToBase64(file);
        const response = await fetch(`${SUPABASE_FUNCTIONS_URL}/create-document`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                apikey: SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ documentType, participantName, participantEmail, pdfBase64, authorisedPersonEmail }),
        });

        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not create the document.");

        linkResult.hidden = false;
        createForm.reset();
        loadDocuments();
    } catch (error) {
        showCreateError(error.message || "Something went wrong.");
    } finally {
        createBtn.disabled = false;
        createBtn.textContent = "Create document";
    }
}

// Emails the participant their signing link. Each send issues a brand-new
// link and kills the previous one -- the old token can't be recovered (only
// its hash is stored), so re-sending necessarily means re-issuing.
async function handleSendLink(button) {
    const { sendLink: documentId, sentBefore } = button.dataset;

    if (sentBefore === "true" && !confirm("Send a new link to this participant?\n\nThe link they were sent before will stop working.")) {
        return;
    }

    const originalText = button.textContent;
    button.disabled = true;
    button.textContent = "Sending…";

    try {
        const response = await fetch(`${SUPABASE_FUNCTIONS_URL}/send-participant-link`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                apikey: SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ documentId }),
        });

        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not send the link.");

        loadDocuments();
    } catch (error) {
        alert(error.message || "Something went wrong.");
        button.disabled = false;
        button.textContent = originalText;
    }
}

// Compliance confirms the Authorised Person's own signing is done and closes
// the document out. No file to verify -- this is a manual record, not a check.
async function handleMarkFullyExecuted(documentId) {
    if (!confirm("Mark this document as fully executed? Only do this once the authorised person has signed it themselves.")) {
        return;
    }

    try {
        const response = await fetch(`${SUPABASE_FUNCTIONS_URL}/mark-fully-executed`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                apikey: SUPABASE_ANON_KEY,
            },
            body: JSON.stringify({ documentId }),
        });

        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not mark this document as fully executed.");

        loadDocuments();
    } catch (error) {
        alert(error.message || "Something went wrong.");
    }
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(",")[1]);
        reader.onerror = () => reject(new Error("Could not read that file."));
        reader.readAsDataURL(file);
    });
}

async function loadDocuments() {
    try {
        const response = await fetch(`${SUPABASE_FUNCTIONS_URL}/list-documents`, {
            headers: {
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                apikey: SUPABASE_ANON_KEY,
            },
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not load documents.");
        renderDocuments(body.documents);
    } catch (error) {
        docTableBody.innerHTML = `<tr><td colspan="6" class="doc-table-empty">${escapeHtml(error.message)}</td></tr>`;
    }
}

function renderDocuments(documents) {
    if (!documents.length) {
        docTableBody.innerHTML = '<tr><td colspan="6" class="doc-table-empty">No documents yet.</td></tr>';
        return;
    }

    docTableBody.innerHTML = documents
        .map((doc) => {
            const participant = `${escapeHtml(doc.participant_name)}<br><span class="doc-table-sub">${escapeHtml(doc.participant_email)}</span>`;
            const label = DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type;
            const status = STATUS_LABELS[doc.status] || doc.status;
            return `
                <tr>
                    <td>${participant}</td>
                    <td>${escapeHtml(label)}</td>
                    <td><span class="status-pill status-${doc.status}">${escapeHtml(status)}</span></td>
                    <td>${formatDate(doc.created_at)}</td>
                    <td>${formatDate(doc.link_sent_at)}</td>
                    <td>${renderAction(doc)}</td>
                </tr>
            `;
        })
        .join("");
}

// Whichever single step is this document's turn -- send the link to the
// participant, or close it out once the team leader has signed elsewhere.
function renderAction(doc) {
    if (doc.status === "Uploaded" || doc.status === "AwaitingParticipantSignature") {
        const sentBefore = Boolean(doc.link_sent_at);
        return `<button type="button" class="ghost-btn" data-send-link="${doc.id}" data-sent-before="${sentBefore}">${
            sentBefore ? "Resend link" : "Send link"
        }</button>`;
    }
    if (doc.status === "AwaitingAuthorisedSignature") {
        return `<button type="button" class="ghost-btn" data-mark-executed="${doc.id}">Mark fully executed</button>`;
    }
    return "—";
}

function formatDate(value) {
    if (!value) return "—";
    return new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function escapeHtml(value) {
    const div = document.createElement("div");
    div.textContent = value ?? "";
    return div.innerHTML;
}

function showCreateError(message) {
    createError.textContent = message;
    createError.hidden = false;
}

function hideCreateError() {
    createError.hidden = true;
    createError.textContent = "";
}
