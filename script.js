(function () {
  const card = document.querySelector(".card");
  if (!card) return;

  // --- Read data from the card ---
  const business = card.dataset.business || "the business";
  const employee = card.dataset.employee || "the employee";

  // Google review link (supports old + new pages)
  const googleUrl =
    card.dataset.googleReviewUrl ||
    card.dataset.googleUrl ||
    "#";

  // Elements (only used if present)
  const employeeNameEl = document.getElementById("employeeName");
  const businessNameEl = document.getElementById("businessName");
  const googleBtn = document.getElementById("googleBtn");

  const draftBtn = document.getElementById("draftBtn");
  const copyBtn = document.getElementById("copyBtn");
  const reviewText = document.getElementById("reviewText");

  // Optional: customer detail input (recommended)
  const detailInput = document.getElementById("detailInput");

  // Fill visible fields
  if (employeeNameEl) employeeNameEl.textContent = employee;
  if (businessNameEl) businessNameEl.textContent = business;
  if (googleBtn) googleBtn.href = googleUrl;

  // --- UI helpers ---
  function setDraftLoading(isLoading) {
    if (!draftBtn) return;
    draftBtn.disabled = isLoading;
    draftBtn.textContent = isLoading ? "Generating…" : "Draft review with AI";
  }

  function setCopiedState() {
    if (!copyBtn) return;
    const original = copyBtn.textContent;
    copyBtn.textContent = "Copied ✓";
    copyBtn.disabled = true;
    setTimeout(() => {
      copyBtn.textContent = original;
      copyBtn.disabled = false;
    }, 1400);
  }

  function flashError(msg) {
    alert(msg);
  }

  // --- Draft with AI ---
  async function draftWithAI() {
    setDraftLoading(true);

    try {
      const detail = (detailInput?.value || "").trim();

      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          business,
          employee,
          detail
        })
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.error || "AI request failed");
      }

      if (!data.review) {
        throw new Error("No review returned from AI.");
      }

      reviewText.value = data.review;
    } catch (err) {
      console.error(err);
      flashError(err.message || "Couldn’t generate a review. Try again.");
    } finally {
      setDraftLoading(false);
    }
  }

  // --- Copy (works on iPhone + desktop) ---
  async function copyReview() {
    const text = (reviewText.value || "").trim();
    if (!text) {
      flashError("Generate a review first.");
      return;
    }

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setCopiedState();
        return;
      }
    } catch {}

    // Fallback
    try {
      reviewText.focus();
      reviewText.select();
      reviewText.setSelectionRange(0, reviewText.value.length);
      const ok = document.execCommand("copy");
      if (ok) setCopiedState();
      else throw new Error();
    } catch {
      flashError("Press and hold the text, then tap Copy.");
    }
  }

  // Wire buttons
  if (draftBtn) draftBtn.addEventListener("click", draftWithAI);
  if (copyBtn) copyBtn.addEventListener("click", copyReview);
})();

