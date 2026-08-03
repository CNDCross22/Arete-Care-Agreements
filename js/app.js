/* ---------- Compliance/local-upload shell (tool.html only) ----------
   Everything reusable (document config, anchor engine, rendering, signature
   capture, PDF flattening) lives in js/signing-engine.js, loaded before this
   file. This file only owns what's specific to "pick a document type, upload
   a local file, download the result" -- the mode modal, the upload zone, and
   the doc toolbar. */

const modeModal = document.getElementById("modeModal");
const docToolbar = document.getElementById("docToolbar");
const toolbarDocName = document.getElementById("toolbarDocName");
const toolbarMeta = document.getElementById("toolbarMeta");
const resetBtn = document.getElementById("resetBtn");
const uploadView = document.getElementById("uploadView");
const uploadZone = document.getElementById("uploadZone");
const uploadTitle = document.getElementById("uploadTitle");
const uploadError = document.getElementById("uploadError");
const fileInput = document.getElementById("fileInput");
const emptyState = document.getElementById("emptyState");

/* ---------- Wiring ---------- */
modeModal.querySelectorAll(".mode-option").forEach((option) =>
    option.addEventListener("click", () => selectMode(option.dataset.mode))
);

document.getElementById("openModalBtn").addEventListener("click", openModeModal);
document.getElementById("changeDocBtn").addEventListener("click", openModeModal);
resetBtn.addEventListener("click", resetUpload);

uploadZone.addEventListener("click", () => fileInput.click());
uploadZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        fileInput.click();
    }
});
uploadZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    uploadZone.classList.add("dragover");
});
uploadZone.addEventListener("dragleave", () => uploadZone.classList.remove("dragover"));
uploadZone.addEventListener("drop", (event) => {
    event.preventDefault();
    uploadZone.classList.remove("dragover");
    const file = event.dataTransfer.files && event.dataTransfer.files[0];
    if (file) handleFile(file);
});
fileInput.addEventListener("change", () => {
    if (fileInput.files && fileInput.files[0]) handleFile(fileInput.files[0]);
});

downloadBtn.addEventListener("click", downloadSignedPdf);

init();

function init() {
    const documentKey = new URLSearchParams(window.location.search).get("document");
    if (DOCUMENTS[documentKey]) {
        selectMode(documentKey);
    } else {
        openModeModal();
    }
}

/* ---------- Mode selection ---------- */
function openModeModal() {
    modeModal.classList.add("open");
    modeModal.setAttribute("aria-hidden", "false");
}

function closeModeModal() {
    modeModal.classList.remove("open");
    modeModal.setAttribute("aria-hidden", "true");
}

function selectMode(key) {
    if (!DOCUMENTS[key]) return;

    activeDocumentKey = key;
    resetDocumentState();
    workingConfig = DOCUMENTS[key];
    closeModeModal();

    const config = workingConfig;

    // Show upload view, hide preview + empty state
    emptyState.hidden = true;
    pdfContainer.innerHTML = "";
    pdfContainer.hidden = true;
    uploadView.hidden = false;
    docToolbar.hidden = false;

    toolbarDocName.textContent = config.label;
    toolbarMeta.textContent = "Awaiting upload";
    resetBtn.hidden = true; // nothing to reset until a file is loaded
    uploadTitle.textContent = `Upload your ${config.label}`;
    hideUploadError();

    // Side panel locked until a file is loaded
    panelLocked.hidden = false;
    panelBody.hidden = true;
    panelMode.textContent = "Awaiting file";
    collapseSidePanel();

    setStep("upload");
}

// Clear the current file (e.g. wrong document uploaded) and return to the upload
// screen for the SAME document type — no page reload needed.
function resetUpload() {
    if (!activeDocumentKey) return;

    const hasWork =
        Object.keys(appliedSignatures).length > 0 ||
        Object.values(checkedBoxes).some(Boolean) ||
        Object.values(textValues).some((value) => value && value.trim());

    if (hasWork && !confirm("Clear this file and start over? Your signatures and entries on this document will be discarded.")) {
        return;
    }

    selectMode(activeDocumentKey);
}

/* ---------- File handling ---------- */
async function handleFile(file) {
    hideUploadError();
    // Clear the input so the SAME file can be re-selected later (e.g. to retry
    // after an error, or after Reset). Without this the change event won't fire.
    fileInput.value = "";

    const isPdf =
        file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
        showUploadError("That doesn't look like a PDF. Please upload a .pdf file.");
        return;
    }

    const config = getActiveConfig();
    uploadTitle.textContent = `Loading ${file.name}...`;

    try {
        const buffer = await file.arrayBuffer();
        const numPages = await loadAndRenderDocument(buffer, config);

        uploadView.hidden = true;
        pdfContainer.hidden = false;
        emptyState.hidden = true;

        toolbarMeta.textContent = `${numPages} pages • ${config.signatures.length} signature${config.signatures.length > 1 ? "s" : ""} required`;
        resetBtn.hidden = false; // a file is loaded; allow re-upload

        enterSigningMode(config, numPages);
    } catch (error) {
        console.error(error);
        loadedPdfBytes = null;
        uploadTitle.textContent = `Upload your ${config.label}`;
        showUploadError(error.message || "Could not read that PDF.");
    }
}

function showUploadError(message) {
    uploadError.textContent = message;
    uploadError.hidden = false;
}

function hideUploadError() {
    uploadError.hidden = true;
    uploadError.textContent = "";
}

/* ---------- Download ---------- */
async function downloadSignedPdf() {
    const config = getActiveConfig();

    let bytes;
    try {
        bytes = await buildSignedPdfBytes(config);
    } catch (error) {
        alert(error.message);
        if (error.missingId) selectTargetById(error.missingId);
        return;
    }

    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = config.outputName;
    link.click();
    URL.revokeObjectURL(url);
}
