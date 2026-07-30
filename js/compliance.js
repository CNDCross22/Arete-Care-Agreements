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

// Wording matches what Compliance actually calls these people ("team leader"),
// not the internal status names.
const STATUS_LABELS = {
    Uploaded: "Not sent yet",
    AwaitingParticipantSignature: "Awaiting participant",
    ParticipantSigned: "Participant signed",
    AwaitingAuthorisedSignature: "Awaiting team leader",
    Countersigned: "Both signed",
    FullyExecuted: "Fully executed",
    Purged: "Expired / purged",
};

const createForm = document.getElementById("createForm");
const createBtn = document.getElementById("createBtn");
const createError = document.getElementById("createError");
const linkResult = document.getElementById("linkResult");
const refreshBtn = document.getElementById("refreshBtn");
const docTableBody = document.getElementById("docTableBody");
const docCount = document.getElementById("docCount");
const pdfFile = document.getElementById("pdfFile");
const fileDrop = document.getElementById("fileDrop");
const fileChosen = document.getElementById("fileChosen");
const fileName = document.getElementById("fileName");
const fileSize = document.getElementById("fileSize");
const fileClear = document.getElementById("fileClear");
const liveDot = document.getElementById("liveDot");
const liveLabel = document.getElementById("liveLabel");
const actionHead = document.getElementById("actionHead");

// Guards against a slow response from an earlier load landing after a newer one
// and overwriting the fresher list, easy to hit now that every action refreshes
// the table. Declared up here, not next to loadDocuments(): `let` stays in the
// temporal dead zone until its declaration is evaluated, so a startup call to
// loadDocuments() below would throw if this sat further down the file.
let loadSequence = 0;

// Last rendered table contents, used to skip no-op redraws (see renderDocuments).
let lastSnapshot = null;

// The status column updates itself. Realtime over Supabase's WebSocket was the
// obvious choice but it enforces RLS, and `documents` deliberately has RLS on
// with no policies so only the Edge Functions can read it. Subscribing from the
// browser would mean granting the public anon key SELECT on the whole table,
// exposing participant emails and token hashes. Polling the same Edge Function
// the page already uses keeps that boundary intact, and at this scale (a
// compliance team watching a handful of documents) the difference is invisible.
const POLL_INTERVAL_MS = 15000;
let pollTimer = null;

// Number of user-initiated actions in flight (creating a document, sending a
// link, marking one executed). Background polls stand down while this is above
// zero: the poll can't touch the upload form, but it does redraw the table, and
// redrawing it mid-click would swap the button out from under the user. Actions
// refresh the table themselves when they finish, so nothing is missed.
let busyActions = 0;

// Kick the table off before wiring anything else. If a later listener throws
// (a stale cached script against newer HTML, say), the list still loads
// instead of sitting on "Loading..." forever with no clue why.
loadDocuments();
startPolling();

// A hidden tab doesn't need updating, and a laptop that's been asleep would
// otherwise wake to a queue of pointless requests. Stop when hidden, and
// refresh immediately on return so the table is current the moment it's seen.
document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        stopPolling();
    } else {
        loadDocuments({ background: true });
        startPolling();
    }
});

function startPolling() {
    stopPolling();
    pollTimer = setInterval(() => loadDocuments({ background: true }), POLL_INTERVAL_MS);
}

function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
}

createForm.addEventListener("submit", handleCreate);
refreshBtn.addEventListener("click", loadDocuments);

/* ---------- Custom file picker ---------- */
fileDrop.addEventListener("click", () => pdfFile.click());
fileDrop.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        pdfFile.click();
    }
});
pdfFile.addEventListener("change", () => showChosenFile(pdfFile.files[0]));
fileClear.addEventListener("click", clearChosenFile);

// Both are needed for a drop target: without preventDefault on dragover the
// browser just navigates to the dropped file instead.
fileDrop.addEventListener("dragover", (event) => {
    event.preventDefault();
    fileDrop.classList.add("dragover");
});
fileDrop.addEventListener("dragleave", () => fileDrop.classList.remove("dragover"));
fileDrop.addEventListener("drop", (event) => {
    event.preventDefault();
    fileDrop.classList.remove("dragover");

    const file = event.dataTransfer.files[0];
    if (!file) return;
    if (!isPdf(file)) {
        showCreateError("That doesn't look like a PDF. Please choose a .pdf file.");
        return;
    }

    // Mirror the drop into the real input so the form reads from one source.
    const transfer = new DataTransfer();
    transfer.items.add(file);
    pdfFile.files = transfer.files;
    showChosenFile(file);
});

function isPdf(file) {
    return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function showChosenFile(file) {
    if (!file) return clearChosenFile();
    hideCreateError();
    fileName.textContent = file.name;
    fileSize.textContent = formatFileSize(file.size);
    fileChosen.hidden = false;
    fileDrop.hidden = true;
}

function clearChosenFile() {
    pdfFile.value = "";
    fileChosen.hidden = true;
    fileDrop.hidden = false;
}

// Shows the list is updating itself, and says so plainly when it isn't, so a
// stalled table is never mistaken for a quiet one.
function markLive() {
    liveDot.classList.remove("is-stale");
    liveDot.title = "Updating automatically";
    liveLabel.textContent = "Live";
}

function markStale() {
    liveDot.classList.add("is-stale");
    liveDot.title = "Couldn't reach the server on the last check. Still trying.";
    liveLabel.textContent = "Reconnecting";
}

function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
docTableBody.addEventListener("click", (event) => {
    const sendBtn = event.target.closest("[data-send-link]");
    if (sendBtn) {
        handleSendLink(sendBtn);
        return;
    }
    const downloadLink = event.target.closest("[data-download]");
    if (downloadLink) {
        handleDownload(downloadLink);
        return;
    }
    const markBtn = event.target.closest("[data-mark-executed]");
    if (markBtn) handleMarkFullyExecuted(markBtn.dataset.markExecuted);
});

async function handleCreate(event) {
    event.preventDefault();
    hideCreateError();
    linkResult.hidden = true;

    const documentType = document.getElementById("documentType").value;
    const participantName = document.getElementById("participantName").value.trim();
    const participantEmail = document.getElementById("participantEmail").value.trim();
    const file = pdfFile.files[0];
    const authorisedPersonEmail = document.getElementById("teamLeaderEmail").value.trim();

    if (!file) {
        showCreateError("Choose a PDF file.");
        return;
    }
    if (!isPdf(file)) {
        showCreateError("That doesn't look like a PDF. Please choose a .pdf file.");
        return;
    }
    if (!authorisedPersonEmail) {
        showCreateError("Enter the team leader's email.");
        return;
    }

    createBtn.disabled = true;
    createBtn.textContent = "Creating…";
    busyActions++;

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
        // form.reset() clears the input's value but not the custom UI built
        // around it, which would otherwise still show the old filename.
        clearChosenFile();
    } catch (error) {
        showCreateError(error.message || "Something went wrong.");
    } finally {
        createBtn.disabled = false;
        createBtn.textContent = "Create document";
        // Drop the guard before refreshing, or the refresh would be skipped.
        busyActions--;
        loadDocuments();
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
    busyActions++;

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
    } catch (error) {
        alert(error.message || "Something went wrong.");
        button.disabled = false;
        button.textContent = originalText;
    } finally {
        busyActions--;
        loadDocuments();
    }
}

// Saves a copy of the signed PDF while it still exists. The Edge Function
// returns a signed URL that expires in a minute rather than the file itself,
// so the download streams straight from storage.
async function handleDownload(button) {
    button.disabled = true;
    busyActions++;

    try {
        const response = await fetch(
            `${SUPABASE_FUNCTIONS_URL}/download-document?id=${encodeURIComponent(button.dataset.download)}`,
            {
                headers: {
                    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                    apikey: SUPABASE_ANON_KEY,
                },
            },
        );

        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Could not download this document.");

        // The signed URL carries its own attachment header, so clicking a link
        // to it saves the file instead of navigating the page away.
        const link = document.createElement("a");
        link.href = body.url;
        link.download = body.fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
    } catch (error) {
        alert(error.message || "Something went wrong.");
    } finally {
        button.disabled = false;
        busyActions--;
    }
}

// Compliance confirms the Authorised Person's own signing is done and closes
// the document out. No file to verify -- this is a manual record, not a check.
async function handleMarkFullyExecuted(documentId) {
    if (!confirm(
        "Mark this document as fully executed?\n\n" +
        "Both signatures are already in. This closes the document out and deletes " +
        "the stored PDFs. If anyone still needs a copy, cancel and use the download " +
        "button next to this one first.\n\n" +
        "The document stays in this list as a record, but the files can't be recovered."
    )) {
        return;
    }

    busyActions++;
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
    } catch (error) {
        alert(error.message || "Something went wrong.");
    } finally {
        busyActions--;
        loadDocuments();
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

// `background` marks an automatic poll rather than something the user asked
// for: it leaves the Refresh button alone and stays quiet on failure, so a
// blip in connectivity doesn't replace a good table with an error message.
async function loadDocuments({ background = false } = {}) {
    if (background && busyActions > 0) return;

    const thisLoad = ++loadSequence;
    if (!background) refreshBtn.disabled = true;

    try {
        const response = await fetch(`${SUPABASE_FUNCTIONS_URL}/list-documents`, {
            headers: {
                Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
                apikey: SUPABASE_ANON_KEY,
            },
        });
        const body = await response.json();
        if (thisLoad !== loadSequence) return;
        if (!response.ok) throw new Error(body.error || "Could not load documents.");
        renderDocuments(body.documents);
        markLive();
    } catch (error) {
        if (thisLoad !== loadSequence) return;
        if (background) {
            // Leave the last good table on screen and try again next tick.
            markStale();
            return;
        }
        docCount.textContent = "";
        lastSnapshot = null;
        actionHead.hidden = true;
        docTableBody.innerHTML = `<tr><td colspan="5" class="doc-table-empty">${escapeHtml(error.message)}</td></tr>`;
    } finally {
        if (thisLoad === loadSequence && !background) refreshBtn.disabled = false;
    }
}

function renderDocuments(documents) {
    // Polling means most loads find nothing new. Rewriting innerHTML anyway
    // would cancel a hover, drop focus, and interrupt a click already in
    // flight, so only touch the DOM when something actually differs.
    const snapshot = JSON.stringify(
        documents.map((d) => [d.id, d.status, d.link_sent_at, d.participant_name, d.participant_email, d.document_type]),
    );
    if (snapshot === lastSnapshot) return;
    lastSnapshot = snapshot;

    docCount.textContent = documents.length
        ? `${documents.length} document${documents.length === 1 ? "" : "s"}`
        : "";

    // Most documents need nothing from Compliance: they are waiting on someone
    // else, or they finished and closed themselves out. Drop the column
    // entirely rather than leaving a header over a run of blank cells.
    const actions = documents.map(renderAction);
    const anyAction = actions.some((markup) => markup.trim() !== "");
    actionHead.hidden = !anyAction;
    const columnCount = anyAction ? 6 : 5;

    if (!documents.length) {
        docTableBody.innerHTML = `<tr><td colspan="${columnCount}" class="doc-table-empty">No documents yet.</td></tr>`;
        return;
    }

    // One innerHTML write for the whole table rather than one per row: the
    // browser parses and lays out once instead of on every iteration.
    docTableBody.innerHTML = documents
        .map((doc, index) => {
            const label = DOCUMENT_TYPE_LABELS[doc.document_type] || doc.document_type;
            const status = STATUS_LABELS[doc.status] || doc.status;
            return `
                <tr>
                    <td>
                        ${escapeHtml(doc.participant_name)}
                        <span class="doc-table-sub" title="${escapeHtml(doc.participant_email)}">${escapeHtml(doc.participant_email)}</span>
                    </td>
                    <td>${escapeHtml(label)}</td>
                    <td><span class="status-pill status-${doc.status}">${escapeHtml(status)}</span></td>
                    <td>${formatDate(doc.created_at)}</td>
                    <td>${formatDate(doc.link_sent_at, "Not sent")}</td>
                    ${anyAction ? `<td>${actions[index]}</td>` : ""}
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
    // Only once both signatures are in. While it sits at "Awaiting team
    // leader" there is nothing for Compliance to do: that person has their own
    // link and the portal is waiting on them.
    // Countersigned is normally a state nobody sees: once the team leader
    // signs, the completed copy is emailed to the reports mailbox and the
    // document closes itself out in the same request. A row sitting here means
    // that email did not go out, so this is the one case where no copy of the
    // agreement exists anywhere and a person has to take one and close it out
    // by hand. Hence both buttons, which is also why they're never visible in
    // the normal flow.
    if (doc.status === "Countersigned") {
        return `
            <div class="doc-actions">
                <button type="button" class="ghost-btn icon-btn" data-download="${doc.id}" title="Download the signed PDF" aria-label="Download the signed PDF">&#11015;</button>
                <button type="button" class="ghost-btn ghost-btn--reset icon-btn" data-mark-executed="${doc.id}" title="Mark executed: close this out and delete the stored files" aria-label="Mark executed">&#10003;</button>
            </div>
        `;
    }
    return "";
}

// Built once, not per cell -- constructing an Intl formatter is the expensive
// part of toLocaleDateString, and the table calls this twice per row.
const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });

function formatDate(value, fallback = "") {
    if (!value) return fallback;
    return DATE_FORMAT.format(new Date(value));
}

const HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

// String replace rather than the innerHTML-of-a-detached-div trick: that
// allocated a DOM element for every field of every row just to escape text.
function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

function showCreateError(message) {
    createError.textContent = message;
    createError.hidden = false;
}

function hideCreateError() {
    createError.hidden = true;
    createError.textContent = "";
}
