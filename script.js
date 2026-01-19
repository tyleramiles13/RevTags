(function () {
  const card = document.querySelector(".card");
  if (!card) return;

  // --- Support BOTH old pages (Will) and new pages (Swave) ---
  // Old Will page uses:
  //   data-business, data-employee, data-google-url
  // New Swave pages use:
  //   data-employee, data-business-type, data-service-notes, data-google-review-url

  const business = card.dataset.business || "the business";
  const employee = card.dataset.employee || "the employee";

  // New fields (for solar / future business types)
  const businessType = (card.dataset.businessType || "").trim(); // data-business-type
  const serviceNotes = (card.dataset.serviceNotes || "").trim(); // data-service-notes

  // Google review link (prefer new "write review" link, fallback to old link)
  const googleUrl =
    card.dataset.googleReviewUrl || // data-google-review-url (new)
    card.dataset.googleUrl ||       // data-google-url (old)
    "#";

  const employeeNameEl = document.getElementById("employeeName");
  const businessNameEl = document.getElementById("businessName");
  const googleBtn = document.getElementById("googleBtn");

  const draftBtn = document.getElementById("draftBtn");
  const copyBtn = document.getElementById("copyBtn");
  const reviewText = document.getElementById("reviewText");

  // Fill visible fields (only if those elements exist on the page)
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

  // --- Draft with REAL AI ---
  async function draftWithAI() {
    setDraftLoading(true);

    try {
      const extra = ""; // optional for later

      const res = await fetch("/api/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Keep old fields for compatibility
          business,
          employee,
          extra,

          // NEW fields (these fix Swave / solar)
          businessType,
          serviceNotes
        })
      });

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || "AI request failed");
      }

      const data = await res.json();
      if (!data || !data.review) {
        throw new Error("No review returned from AI.");
      }

      reviewText.value = data.review;
    } catch (err) {
      console.error(err);
      flashError("Couldn’t generate a review. Try again in a moment.");
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

    // Best modern method (works on HTTPS + user tap)
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        setCopiedState();
        return;
      }
    } catch (e) {
      // fall through to fallback
    }

    // Fallback (older iOS / weird permissions)
    try {
      reviewText.focus();
      reviewText.select();
      reviewText.setSelectionRange(0, reviewText.value.length); // iOS support
      const ok = document.execCommand("copy");
      if (ok) {
        setCopiedState();
      } else {
        throw new Error("execCommand copy returned false");
      }
    } catch (e) {
      console.error(e);
      flashError("Copy didn’t work on this device. Press and hold the text, then tap Copy.");
    }
  }

  // Wire buttons
  if (draftBtn) draftBtn.addEventListener("click", draftWithAI);
  if (copyBtn) copyBtn.addEventListener("click", copyReview);
})();
