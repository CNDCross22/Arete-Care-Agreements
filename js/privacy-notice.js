/* ---------- Privacy notice gate (sign.html, countersign.html) ----------
   The markup ships with the overlay already open so it covers the page from
   the first paint, with no flash of the document underneath. This file only
   handles dismissing it.

   There is deliberately no Escape or click-outside dismissal: it's a consent
   gate, and the only way past it is the button. The document keeps loading
   behind the overlay so it's ready the moment the signer accepts. */

(function () {
    const modal = document.getElementById("privacyModal");
    const acceptBtn = document.getElementById("privacyAccept");
    if (!modal || !acceptBtn) return;

    document.body.style.overflow = "hidden";
    acceptBtn.focus();

    // Keep tabbing inside the card while it's up, so the signer can't reach
    // the document behind it with the keyboard.
    modal.addEventListener("keydown", (event) => {
        if (event.key === "Tab") {
            event.preventDefault();
            acceptBtn.focus();
        }
    });

    acceptBtn.addEventListener("click", () => {
        modal.classList.remove("open");
        modal.setAttribute("aria-hidden", "true");
        document.body.style.overflow = "";
    });
})();
