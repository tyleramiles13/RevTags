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

  // Keep existing behavior (Will safe)
  if (type === "auto-detailing") type = "auto_detailing";
  if (type === "detail" || type === "detailing") type = "auto_detailing";

  // Added types (do not impact Will/Swave unless their page sends these values)
  if (
    type === "nail" ||
    type === "nails" ||
    type === "nail_salon" ||
    type === "nail-salon"
  ) {
    type = "nails";
  }
  if (
    type === "massage" ||
    type === "massages" ||
    type === "massage_therapy" ||
    type === "massage-therapy"
  ) {
    type = "massage";
  }

  // Default stays detailing (important for Will pages that don’t send a type)
  if (!type) type = "auto_detailing";

  const notes = String(serviceNotes || "").trim();

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Sentence targets (keep existing behavior)
  // Solar: ALWAYS 1 sentence
  // Nails: ALWAYS 1 sentence
  // Massage: ALWAYS 1 sentence
  // Detailing: mostly 1, sometimes 2
  const sentenceTarget =
    type === "solar"
      ? 1
      : type === "nails"
      ? 1
      : type === "massage"
      ? 1
      : Math.random() < 0.25
      ? 2
      : 1;

  // Remove forbidden punctuation
  function sanitize(text) {
    return String(text || "")
      .replace(/[;:—–-]/g, "")
      .replace(/\s+/g, " ")
      .trim();
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

  function countSentences(text) {
    return String(text || "").split(/[.!?]+/).filter(Boolean).length;
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

  function endsWithName(text) {
    const t = String(text || "").trim().toLowerCase();
    const name = String(employee || "").trim().toLowerCase();
    if (!t || !name) return false;

    // remove trailing punctuation for check
    const cleaned = t.replace(/[.!?]+$/g, "").trim();
    return cleaned.endsWith(" " + name) || cleaned.endsWith(name);
  }

  function startsWithStory(text) {
    const t = String(text || "").trim().toLowerCase();
    const banned = [
      "after ",
      "after a ",
      "after an ",
      "after the ",
      "last week",
      "yesterday",
      "this weekend",
      "when i",
      "when we",
      "on my way",
    ];
    return banned.some((s) => t.startsWith(s));
  }

  function containsAny(text, arr) {
    const low = String(text || "").toLowerCase();
    return arr.some((p) => low.includes(String(p).toLowerCase()));
  }

  // ------------------------
  // SOLAR (KEEP YOUR BEHAVIOR)
  // ------------------------
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
    "consultation",
  ];

  function solarIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;

    if (startsWithName(t)) return false;
    if (startsWithStory(t)) return false;

    const low = t.toLowerCase();

    if (!low.includes("solar")) return false;
    if (!low.includes(String(employee).toLowerCase())) return false;

    if (containsAny(t, solarBannedPhrases)) return false;

    if (countSentences(t) > 1) return false;

    const wc = t.split(/\s+/).filter(Boolean).length;
    if (wc < 8) return false;

    return true;
  }

  function buildPromptSolar() {
    const patterns = [
      `Write ONE short sentence that sounds like a real Google review starter and is easy for a customer to edit.`,
      `Write ONE sentence that feels genuine but stays general so the customer can personalize it.`,
      `Write ONE sentence that sounds normal and not robotic and leaves room for the customer to add details.`,
      `Write ONE sentence that is positive and vague like a template someone could tweak.`,
    ];

    return `
Write a Google review draft.

Hard rules:
- Exactly ONE sentence.
- Do NOT start with "${employee}".
- Do NOT start with a story opener.
- Do NOT mention the business name.
- Include the word "solar" exactly once.
- Mention "${employee}" exactly once.
- Keep it general like a template so the customer can edit.
- Do NOT use any of these phrases: ${solarBannedPhrases.join(", ")}.
- Do NOT use semicolons, colons, or any dashes.

Optional notes (tone only, no specific claims):
${notes || "(none)"}

Instruction:
${pick(patterns)}

Return ONLY the review text.
    `.trim();
  }

  // ------------------------
  // NAILS (NEW, DOES NOT AFFECT WILL/SWAVE)
  // ------------------------
  const nailsBannedPhrases = [
    // stop story vibe
    "after a long day",
    "after a long week",
    "after work",
    "roadtrip",
    "hauling",

    // stop weird “Cambria” interpretations
    "thanks to",
    "thank you",

    // stop “experience” spam
    "experience",
  ];

  function nailsIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;

    if (startsWithName(t)) return false;
    if (endsWithName(t)) return false;
    if (startsWithStory(t)) return false;

    const low = t.toLowerCase();

    // must mention employee
    if (!low.includes(String(employee).toLowerCase())) return false;

    // must include nail/nails
    if (!(low.includes("nail") || low.includes("nails"))) return false;

    // ban weird phrases
    if (containsAny(t, nailsBannedPhrases)) return false;

    // exactly 1 sentence
    if (countSentences(t) > 1) return false;

    // not too short
    const wc = t.split(/\s+/).filter(Boolean).length;
    if (wc < 7) return false;

    return true;
  }

  function buildPromptNails() {
    const patterns = [
      `Write ONE short sentence that sounds like a real review starter and is easy to edit.`,
      `Write ONE simple sentence that feels human and casual, not salesy.`,
      `Write ONE short sentence that someone would actually type and could tweak.`,
      `Write ONE short and normal review template line.`,
    ];

    return `
Write a Google review draft.

Hard rules:
- Exactly ONE sentence.
- Do NOT start with "${employee}".
- Do NOT end with "${employee}".
- Do NOT start with a story opener.
- Do NOT mention the business name.
- Mention "${employee}" exactly once.
- Include "nail" or "nails" at least once.
- Keep it general like a template so the customer can edit.
- Do NOT use the word "experience".
- Do NOT include "thanks to" or "thank you".
- Do NOT use semicolons, colons, or any dashes.

Optional notes (tone only):
${notes || "(none)"}

Instruction:
${pick(patterns)}

Return ONLY the review text.
    `.trim();
  }

  // ------------------------
  // MASSAGE (NEW, DOES NOT AFFECT WILL/SWAVE)
  // ------------------------
  const massageBannedPhrases = [
    "session",
    "experience",

    "after a long day",
    "after a long week",
    "after work",
    "roadtrip",
    "hauling",

    "deep tissue",
    "sports massage",
    "hot stone",
    "prenatal",
    "trigger points",
    "injury",
    "pain is gone",
  ];

  function massageIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;

    if (startsWithName(t)) return false;
    if (endsWithName(t)) return false;
    if (startsWithStory(t)) return false;

    const low = t.toLowerCase();

    if (!low.includes(String(employee).toLowerCase())) return false;
    if (!low.includes("massage")) return false;

    if (containsAny(t, massageBannedPhrases)) return false;

    if (countSentences(t) > 1) return false;

    const wc = t.split(/\s+/).filter(Boolean).length;
    if (wc < 7) return false;

    return true;
  }

  function buildPromptMassage() {
    const patterns = [
      `Write ONE very simple sentence that sounds like a real review starter and is easy to edit.`,
      `Write ONE short, normal sentence someone would actually type after a massage.`,
      `Write ONE short and casual review template line that feels human.`,
      `Write ONE simple positive sentence that is not overly specific.`,
    ];

    return `
Write a review draft.

Hard rules:
- Exactly ONE sentence.
- Do NOT start with "${employee}".
- Do NOT end with "${employee}".
- Do NOT start with a story opener.
- Do NOT mention the business name.
- Mention "${employee}" exactly once.
- Include the word "massage" at least once.
- Keep it very simple and general like a template.
- Avoid the words "session" and "experience".
- Do NOT add made up details or stories.
- Do NOT use semicolons, colons, or any dashes.

Optional notes (tone only):
${notes || "(none)"}

Instruction:
${pick(patterns)}

Return ONLY the review text.
    `.trim();
  }

  // ------------------------
  // DETAILING (KEEP YOUR BEHAVIOR)
  // ------------------------
  function detailingIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;
    if (startsWithName(t)) return false;
    if (startsWithStory(t)) return false;
    return true;
  }

  function buildPromptDetailing() {
    return `
Write a short Google review draft.

Rules:
- ${sentenceTarget} sentence${sentenceTarget === 2 ? "s" : ""} only.
- Do NOT start with "${employee}".
- Do NOT start with a story opener.
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
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "Write short, human sounding Google reviews. Keep them casual and believable. Avoid repeating the same phrasing.",
            },
            { role: "user", content: prompt },
          ],
          temperature: temp,
          max_tokens: maxTokens,
        }),
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
        isSolar ? 1.25 : isNails ? 1.15 : isMassage ? 1.2 : 1.05,
        isSolar ? 80 : isNails ? 80 : isMassage ? 80 : 95
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

    // Solar fallback (KEEP your behavior)
    if (isSolar && !solarIsAcceptable(review)) {
      const solarFallback = [
        `Really appreciate ${employee} being respectful and professional about solar.`,
        `Solid experience overall and ${employee} was great to work with on solar.`,
        `Glad I talked with ${employee} and got pointed in the right direction on solar.`,
        `It was a good experience and ${employee} was helpful with solar.`,
        `Thanks to ${employee} for being professional and helpful with solar.`,
        `I had a positive experience and ${employee} was great during the solar visit.`,
        `Everything felt professional and ${employee} did a great job with solar.`,
        `Happy with the experience and ${employee} was friendly and helpful about solar.`,
      ];
      review = sanitize(pick(solarFallback));
      review = trimToSentences(review, 1);
    }

    // Nails fallback (NEW)
    if (isNails && !nailsIsAcceptable(review)) {
      const nailsFallback = [
        `My nails turned out so cute and ${employee} did a great job.`,
        `I love how my nails look and ${employee} was so helpful.`,
        `My nails came out really nice and I would recommend ${employee}.`,
        `So happy with my nails and ${employee} did awesome.`,
        `My nails look amazing and I am glad I booked with ${employee}.`,
      ];
      review = sanitize(pick(nailsFallback));
      review = trimToSentences(review, 1);
    }

    // Massage fallback (NEW)
    if (isMassage && !massageIsAcceptable(review)) {
      const massageFallback = [
        `I feel so much better after my massage and ${employee} was great.`,
        `My massage was exactly what I needed and ${employee} was amazing.`,
        `Really happy I booked a massage and ${employee} did a great job.`,
        `My massage was really relaxing and ${employee} was great to work with.`,
      ];
      review = sanitize(pick(massageFallback));
      review = trimToSentences(review, 1);
    }

    // Detailing fallback (KEEP your behavior)
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