module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.json({ error: "Method not allowed" });
  }

  const { employee, businessType, serviceNotes } = req.body || {};

  if (!employee) {
    res.statusCode = 400;
    return res.json({ error: "Missing employee" });
  }

  const apiKey = process.env.OPENAI_API_KEY_REAL;
  if (!apiKey) {
    res.statusCode = 500;
    return res.json({ error: "Missing OPENAI_API_KEY_REAL" });
  }

  // --- Determine business type ---
  let type = (businessType || "").toLowerCase().trim();

  // Normalize common variants (KEEP existing behavior)
  if (type === "auto-detailing") type = "auto_detailing";
  if (type === "detail" || type === "detailing") type = "auto_detailing";

  // Nails normalization (KEEP existing behavior)
  if (type === "nail" || type === "nails" || type === "nail_salon" || type === "nail-salon") {
    type = "nails";
  }

  // ✅ Massage normalization (NEW, does not affect existing)
  if (
    type === "massage" ||
    type === "massages" ||
    type === "massage_therapy" ||
    type === "massage-therapy" ||
    type === "massage_therapist" ||
    type === "massage-therapist"
  ) {
    type = "massage";
  }

  // Default: keep Will safe by defaulting to detailing (KEEP existing behavior)
  if (!type) type = "auto_detailing";

  const notes = String(serviceNotes || "").trim();

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Solar: ALWAYS 1 sentence template
  // Nails: ALWAYS 1 sentence template
  // Massage: ALWAYS 1 sentence template (NEW)
  // Detailing: mostly 1, sometimes 2
  const sentenceTarget =
    type === "solar" ? 1 :
    type === "nails" ? 1 :
    type === "massage" ? 1 :
    (Math.random() < 0.25 ? 2 : 1);

  // Remove forbidden punctuation
  function sanitize(text) {
    return String(text || "").replace(/[;:—–-]/g, "").trim();
  }

  function trimToSentences(text, max) {
    const raw = String(text || "").trim();
    if (!raw) return raw;

    const parts = raw.split(/([.!?])/).filter(Boolean);
    let out = "";
    let count = 0;

    for (let i = 0; i < parts.length; i += 2) {
      const chunk = (parts[i] || "").trim();
      const punct = (parts[i + 1] || "").trim();
      if (!chunk) continue;

      out += (out ? " " : "") + chunk + (punct || ".");
      count += 1;
      if (count >= max) break;
    }

    return out.trim();
  }

  function startsWithName(text) {
    const t = String(text || "").trim().toLowerCase();
    const name = String(employee || "").trim().toLowerCase();
    if (!t || !name) return false;

    return (
      t.startsWith(name + " ") ||
      t.startsWith(name + ",") ||
      t.startsWith(name + "'") ||
      t.startsWith(name + "’")
    );
  }

  function startsWithStory(text) {
    const t = String(text || "").trim().toLowerCase();
    const banned = [
      "after ", "after a ", "after an ", "after the ",
      "last week", "yesterday", "this weekend",
      "when i", "when we", "on my way"
    ];
    return banned.some((s) => t.startsWith(s));
  }

  // --- SOLAR: template rules + phrase bans (KEEP existing behavior) ---
  const solarBannedPhrases = [
    "easy to understand",
    "made it easy to understand",
    "made it easy",
    "made everything easy",
    "super easy",
    "very easy",
    "straightforward",
    "simple and easy",
    "smooth",
    "the process",
    "process",
    "walked me through",
    "broke it down",
    "answered all my questions",
    "solar conversation",
    "conversation",
    "consultation"
  ];

  // Nails banned phrases (KEEP existing behavior)
  const nailsBannedPhrases = [
    "after a long day",
    "after a long week",
    "after work",
    "roadtrip",
    "hauling"
  ];

  // ✅ Massage banned phrases (NEW, light)
  const massageBannedPhrases = [
    "roadtrip",
    "hauling",
    "after a long roadtrip",
    "after hauling",
    "favorite spots",
    "in cambria",       // prevents the “Cambria” confusion style thing
    "the vibe here"     // stops the weird vibe sentence pattern
  ];

  function containsBannedPhrase(text, bannedList) {
    const low = String(text || "").toLowerCase();
    return bannedList.some((p) => low.includes(p));
  }

  function solarIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;

    if (startsWithName(t)) return false;
    if (startsWithStory(t)) return false;

    const low = t.toLowerCase();

    if (!low.includes("solar")) return false;
    if (!low.includes(String(employee).toLowerCase())) return false;
    if (containsBannedPhrase(t, solarBannedPhrases)) return false;

    const sentenceCount = t.split(/[.!?]+/).filter(Boolean).length;
    if (sentenceCount > 1) return false;

    const wc = t.split(/\s+/).filter(Boolean).length;
    if (wc < 8) return false;

    return true;
  }

  function nailsIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;

    if (startsWithName(t)) return false;
    if (startsWithStory(t)) return false;

    const low = t.toLowerCase();

    if (!low.includes(String(employee).toLowerCase())) return false;
    if (!(low.includes("nails") || low.includes("nail"))) return false;

    const sentenceCount = t.split(/[.!?]+/).filter(Boolean).length;
    if (sentenceCount > 1) return false;

    if (containsBannedPhrase(t, nailsBannedPhrases)) return false;

    const wc = t.split(/\s+/).filter(Boolean).length;
    if (wc < 8) return false;

    return true;
  }

  // ✅ Massage acceptability (NEW)
  function massageIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;

    if (startsWithName(t)) return false;
    if (startsWithStory(t)) return false;

    const low = t.toLowerCase();

    // Must mention employee once somewhere
    if (!low.includes(String(employee).toLowerCase())) return false;

    // Must hint massage but stay general
    if (!(low.includes("massage") || low.includes("session"))) return false;

    // 1 sentence only
    const sentenceCount = t.split(/[.!?]+/).filter(Boolean).length;
    if (sentenceCount > 1) return false;

    // Avoid weird phrases
    if (containsBannedPhrase(t, massageBannedPhrases)) return false;

    // Not too short
    const wc = t.split(/\s+/).filter(Boolean).length;
    if (wc < 8) return false;

    return true;
  }

  // Detailing: keep checks light so Will doesn’t suddenly fall back (KEEP existing behavior)
  function detailingIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;
    if (startsWithName(t)) return false;
    if (startsWithStory(t)) return false;
    return true;
  }

  function buildPromptSolar() {
    const patterns = [
      `Write ONE short sentence that sounds like a real Google review starter and is easy for a customer to edit. Mention "${employee}" once, not at the start, and include the word "solar" once.`,
      `Write ONE sentence that feels like a genuine review but stays general. Mention "${employee}" once (not first) and include "solar" once.`,
      `Write ONE sentence that is positive and vague so the customer can personalize it. Mention "${employee}" once (not first) and include "solar" once.`,
      `Write ONE sentence that sounds normal and not robotic. Mention "${employee}" once, not at the start, and include "solar" once.`
    ];

    return `
Write a Google review draft.

Hard rules:
- Exactly ONE sentence.
- Do NOT start with "${employee}".
- Do NOT start with a story opener (After, Last week, Yesterday, etc.).
- Do NOT mention the business name.
- Include the word "solar" exactly once.
- Mention "${employee}" exactly once.
- Keep it general like a template so the customer can edit.
- Do NOT use any of these phrases: ${solarBannedPhrases.join(", ")}.
- Do NOT use semicolons, colons, or any dashes.

Optional notes (do NOT add details, just tone):
${notes || "(none)"}

Instruction:
${pick(patterns)}

Return ONLY the review text.
    `.trim();
  }

  function buildPromptNails() {
    const patterns = [
      `Write ONE short sentence that sounds like a real review template. Mention "${employee}" once (not first) and include the word "nails" or "nail" once.`,
      `Write ONE sentence that is positive and general so a customer can edit it. Mention "${employee}" once (not first) and include "nails" or "nail" once.`,
      `Write ONE sentence that feels human and casual, not salesy. Mention "${employee}" once (not first) and include "nails" or "nail" once.`
    ];

    return `
Write a Google review draft.

Hard rules:
- Exactly ONE sentence.
- Do NOT start with "${employee}".
- Do NOT start with a story, location, or conversation.
- Do NOT mention any city names or places.
- Do NOT mention the business name.
- Mention "${employee}" exactly once.
- Include the word "nails" or "nail" at least once.
- Keep it short, simple, and generic like a template the customer can edit.
- No storytelling, no chatting, no describing events.
- Do NOT use semicolons, colons, or any dashes.

Return ONLY the review text.

Optional notes (use lightly for vibe only, do not add specific claims):
${notes || "(none)"}

Instruction:
${pick(patterns)}
    `.trim();
  }

  // ✅ NEW: Massage prompt builder
  function buildPromptMassage() {
    const patterns = [
      `Write ONE short sentence that sounds like a normal review template. Mention "${employee}" once (not first) and include the word "massage" or "session".`,
      `Write ONE sentence that is positive and general so the customer can edit it. Mention "${employee}" once (not first) and include "massage" or "session".`,
      `Write ONE sentence that sounds human and simple, not salesy. Mention "${employee}" once (not first) and include "massage" or "session".`
    ];

    return `
Write a review draft.

Hard rules:
- Exactly ONE sentence.
- Do NOT start with "${employee}".
- Do NOT start with a story opener (After, Last week, Yesterday, etc.).
- Do NOT mention the business name.
- Mention "${employee}" exactly once.
- Include the word "massage" or "session" at least once.
- Keep it generic like a template the customer can edit.
- Avoid location or random chatting details.
- Do NOT use semicolons, colons, or any dashes.

Return ONLY the review text.

Optional notes (use lightly for vibe only, do not add specific claims):
${notes || "(none)"}

Instruction:
${pick(patterns)}
    `.trim();
  }

  function buildPromptDetailing() {
    return `
Write a short Google review draft.

Rules:
- ${sentenceTarget} sentence${sentenceTarget === 2 ? "s" : ""} only.
- Do NOT start with "${employee}".
- Do NOT start with a story opener (After, Last week, Yesterday, etc.).
- Do NOT mention the business name.
- Do NOT use semicolons, colons, or any dashes.

Context:
- Employee name: "${employee}"
- This is an auto detailing service.

Optional notes (use lightly):
${notes || "(none)"}

Return ONLY the review text.
    `.trim();
  }

  async function generate(prompt, temp, maxTokens) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "Write short, human sounding reviews. Keep them casual and believable. Avoid repeating the same phrasing."
            },
            { role: "user", content: prompt }
          ],
          temperature: temp,
          max_tokens: maxTokens
        })
      });

      const textBody = await resp.text();
      if (!resp.ok) throw new Error(textBody);

      const data = JSON.parse(textBody);
      return (data?.choices?.[0]?.message?.content || "").trim();
    } finally {
      clearTimeout(timeout);
    }
  }

  try {
    let review = "";
    const isSolar = type === "solar";
    const isNails = type === "nails";
    const isMassage = type === "massage";

    for (let attempt = 0; attempt < 4; attempt++) {
      const prompt = isSolar
        ? buildPromptSolar()
        : isNails
        ? buildPromptNails()
        : isMassage
        ? buildPromptMassage()
        : buildPromptDetailing();

      review = await generate(
        prompt,
        isSolar ? 1.25 : isNails ? 1.15 : isMassage ? 1.15 : 1.05,
        isSolar ? 80 : isNails ? 80 : isMassage ? 85 : 95
      );

      review = sanitize(review);
      review = trimToSentences(review, sentenceTarget);

      if (isSolar) {
        if (solarIsAcceptable(review)) break;
      } else if (isNails) {
        if (nailsIsAcceptable(review)) break;
      } else if (isMassage) {
        if (massageIsAcceptable(review)) break;
      } else {
        if (detailingIsAcceptable(review)) break;
      }
    }

    review = sanitize(review);
    review = trimToSentences(review, sentenceTarget);

    // Solar fallback (KEEP existing behavior)
    if (isSolar && !solarIsAcceptable(review)) {
      const solarFallback = [
        `Really appreciate ${employee} being respectful and professional about solar.`,
        `Solid experience overall and ${employee} was great to work with on solar.`,
        `Glad I talked with ${employee} and got pointed in the right direction on solar.`,
        `It was a good experience and ${employee} was helpful with solar.`,
        `Thanks to ${employee} for being professional and helpful with solar.`,
        `I had a positive experience and ${employee} was great during the solar visit.`,
        `Everything felt professional and ${employee} did a great job with solar.`,
        `Happy with the experience and ${employee} was friendly and helpful about solar.`
      ];
      review = sanitize(pick(solarFallback));
      review = trimToSentences(review, 1);
    }

    // Nails fallback (KEEP existing behavior)
    if (isNails && !nailsIsAcceptable(review)) {
      const nailsFallback = [
        `My nails came out so cute and I really appreciate ${employee}.`,
        `I love how my nails turned out and ${employee} was great.`,
        `So happy with my nails and ${employee} did an awesome job.`,
        `My nails look amazing and I am really glad I booked with ${employee}.`,
        `Really happy with my nails and ${employee} made it a great experience.`
      ];
      review = sanitize(pick(nailsFallback));
      review = trimToSentences(review, 1);
    }

    // ✅ Massage fallback (NEW)
    if (isMassage && !massageIsAcceptable(review)) {
      const massageFallback = [
        `Really happy with my massage and I appreciate ${employee}.`,
        `My massage was great and ${employee} was professional and kind.`,
        `So glad I booked a massage and ${employee} did a great job.`,
        `My session felt relaxing and ${employee} was awesome.`,
        `I feel so much better after my massage and ${employee} was great.`
      ];
      review = sanitize(pick(massageFallback));
      review = trimToSentences(review, 1);
    }

    // Detailing fallback (KEEP existing behavior)
    if (!isSolar && !isNails && !isMassage && !detailingIsAcceptable(review)) {
      review =
        sentenceTarget === 2
          ? `My car looks great after the detail. ${employee} did a solid job and it came out really clean.`
          : `My car looks great after the detail, ${employee} did a solid job and it came out really clean.`;
      review = sanitize(review);
      review = trimToSentences(review, sentenceTarget);
    }

    return res.status(200).json({ review });
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    return res.json({ error: "AI generation failed" });
  }
};