module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.json({ error: "Method not allowed" });
  }

  // ✅ Added noName support (for pages with data-no-name="true")
  const { employee, businessType, serviceNotes, noName } = req.body || {};

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

  function wordCount(text) {
    return String(text || "").trim().split(/\s+/).filter(Boolean).length;
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

  function endsWithBadToken(text) {
    const t = String(text || "")
      .trim()
      .toLowerCase()
      .replace(/[.!?]+$/g, "")
      .trim();
    if (!t) return true;

    const badEnd = [
      "and",
      "or",
      "but",
      "so",
      "because",
      "with",
      "was",
      "were",
      "is",
      "are",
      "to",
      "in",
      "at",
      "for",
      "of",
    ];

    return badEnd.some((w) => t.endsWith(" " + w) || t === w);
  }

  function hasInEmployee(text, employeeName) {
    const t = String(text || "");
    const name = String(employeeName || "").trim();
    if (!t || !name) return false;

    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\bin\\s+${escaped}\\b`, "i"); // blocks "in Cambria"
    return re.test(t);
  }

  function includeEmployeeOnce(text) {
    const t = String(text || "").toLowerCase();
    const name = String(employee || "").trim().toLowerCase();
    if (!t || !name) return 0;
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    const matches = t.match(re);
    return matches ? matches.length : 0;
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

    // Must mention employee once (unless noName is enabled)
    const nn = String(noName || "").toLowerCase() === "true";
    if (nn) {
      if (low.includes(String(employee).toLowerCase())) return false;
    } else {
      if (!low.includes(String(employee).toLowerCase())) return false;
      if (includeEmployeeOnce(t) !== 1) return false;
    }

    if (containsAny(t, solarBannedPhrases)) return false;

    if (countSentences(t) > 1) return false;

    const wc = wordCount(t);
    if (wc < 8) return false;

    // Tiny bit shorter for solar (does not affect Will)
    if (wc > 16) return false;

    if (!/[.!?]$/.test(t)) return false;
    if (endsWithBadToken(t)) return false;

    return true;
  }

  function buildPromptSolar() {
    const nn = String(noName || "").toLowerCase() === "true";

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
- Do NOT start with a story opener.
- Do NOT mention the business name.
- Include the word "solar" exactly once.
- Keep it general like a template so the customer can edit.
- Do NOT use any of these phrases: ${solarBannedPhrases.join(", ")}.
- Do NOT use semicolons, colons, or any dashes.
- Keep it short: 8 to 16 words.
- Must end with a period.

${nn ? `
Name rules:
- Do NOT mention "${employee}" at all.
` : `
Name rules:
- Mention "${employee}" exactly once.
- Do NOT start with "${employee}".
- Do NOT end with "${employee}".
- NEVER write "in ${employee}".
`}

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

    // stop spam words
    "experience",
    "vibe",

    // stop thank-you endings
    "thanks to",
    "thank you",
  ];

  function nailsIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;

    // must be 1 sentence
    if (countSentences(t) > 1) return false;

    // must end cleanly
    if (!/[.!?]$/.test(t)) return false;
    if (endsWithBadToken(t)) return false;

    // keep it short
    const wc = wordCount(t);
    if (wc < 6 || wc > 14) return false;

    // ban weird phrases
    if (containsAny(t, nailsBannedPhrases)) return false;

    // must mention nail/nails
    const low = t.toLowerCase();
    if (!(low.includes("nail") || low.includes("nails"))) return false;

    // user request: remove “and” for nails
    if (/\band\b/i.test(t)) return false;

    // no story openers
    if (startsWithStory(t)) return false;

    const nn = String(noName || "").toLowerCase() === "true";
    const empLow = String(employee || "").trim().toLowerCase();

    if (nn) {
      // no name pages must not include employee
      if (empLow && low.includes(empLow)) return false;
    } else {
      if (!empLow) return false;
      if (!low.includes(empLow)) return false;
      if (includeEmployeeOnce(t) !== 1) return false;
      if (startsWithName(t)) return false;
      if (endsWithName(t)) return false;
      if (hasInEmployee(t, employee)) return false; // blocks "in Cambria"
    }

    return true;
  }

  function buildPromptNails() {
    const nn = String(noName || "").toLowerCase() === "true";

    const patterns = nn
      ? [
          `Write ONE short sentence that sounds like a real nails review starter someone could edit.`,
          `Write ONE simple sentence that feels human and normal for a nails review.`,
          `Write ONE short nails review template line with no extra details.`,
        ]
      : [
          `Write ONE short sentence that sounds like a real nails review starter someone could edit.`,
          `Write ONE simple sentence that feels human and normal.`,
          `Write ONE short nails review template line that mentions the tech in a natural way.`,
        ];

    return `
Write a Google review draft.

Hard rules:
- Exactly ONE sentence.
- Do NOT start with a story opener.
- Do NOT mention the business name.
- Do NOT use the word "experience" or "vibe".
- Do NOT use the word "and".
- Do NOT use semicolons, colons, or any dashes.
- Keep it short: 6 to 14 words.
- Must end with a period.

${nn ? `
Name rules:
- Do NOT mention "${employee}" at all.
` : `
Name rules:
- Mention "${employee}" exactly once.
- Do NOT start with "${employee}".
- Do NOT end with "${employee}".
- NEVER write "in ${employee}".
`}

Content rules:
- Include "nail" or "nails" at least once.
- Keep it general like a template so the customer can edit.

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
    "vibe",

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

    if (countSentences(t) > 1) return false;
    if (!/[.!?]$/.test(t)) return false;
    if (endsWithBadToken(t)) return false;

    const wc = wordCount(t);
    if (wc < 6 || wc > 14) return false;

    if (startsWithStory(t)) return false;

    const low = t.toLowerCase();

    // Must include "massage" (simple)
    if (!low.includes("massage")) return false;

    if (containsAny(t, massageBannedPhrases)) return false;

    const nn = String(noName || "").toLowerCase() === "true";
    const empLow = String(employee || "").trim().toLowerCase();

    if (nn) {
      if (empLow && low.includes(empLow)) return false;
    } else {
      if (!empLow) return false;
      if (!low.includes(empLow)) return false;
      if (includeEmployeeOnce(t) !== 1) return false;
      if (startsWithName(t)) return false;
      if (endsWithName(t)) return false;
      if (hasInEmployee(t, employee)) return false;
    }

    return true;
  }

  function buildPromptMassage() {
    const nn = String(noName || "").toLowerCase() === "true";

    const patterns = nn
      ? [
          `Write ONE very simple sentence someone would type as a review starter.`,
          `Write ONE short and normal sentence that is easy to edit.`,
          `Write ONE simple positive line with no extra details.`,
        ]
      : [
          `Write ONE very simple sentence someone would type as a review starter.`,
          `Write ONE short and normal sentence that mentions the therapist naturally.`,
          `Write ONE simple positive line that is easy to edit.`,
        ];

    return `
Write a review draft.

Hard rules:
- Exactly ONE sentence.
- Do NOT start with a story opener.
- Do NOT mention the business name.
- Include the word "massage" at least once.
- Keep it very simple and general like a template.
- Avoid the words "session", "experience", and "vibe".
- Do NOT add made up details or stories.
- Do NOT use semicolons, colons, or any dashes.
- Keep it short: 6 to 14 words.
- Must end with a period.

${nn ? `
Name rules:
- Do NOT mention "${employee}" at all.
` : `
Name rules:
- Mention "${employee}" exactly once.
- Do NOT start with "${employee}".
- Do NOT end with "${employee}".
- NEVER write "in ${employee}".
`}

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
    return true; // keep it light so Will doesn’t fall back a lot
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
        // shorter outputs for nails/massage/solar, leave detailing alone
        isSolar ? 60 : isNails ? 40 : isMassage ? 40 : 95
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

    // Solar fallback (KEEP your behavior, but slightly shorter and no weird endings)
    if (isSolar && !solarIsAcceptable(review)) {
      const nn = String(noName || "").toLowerCase() === "true";
      const solarFallback = nn
        ? [
            `Really appreciate how professional they were about solar.`,
            `Solid solar visit and everything felt respectful.`,
            `Glad I got some helpful solar info today.`,
            `Good solar visit and it felt professional.`,
          ]
        : [
            `Really appreciate ${employee} being respectful about solar.`,
            `Solid solar visit and ${employee} was great.`,
            `Glad I talked with ${employee} about solar.`,
            `Good solar visit and ${employee} was helpful.`,
          ];

      review = sanitize(pick(solarFallback));
      if (!/[.!?]$/.test(review)) review += ".";
      review = trimToSentences(review, 1);
    }

    // Nails fallback (NEW, bulletproof)
    if (isNails && !nailsIsAcceptable(review)) {
      const nn = String(noName || "").toLowerCase() === "true";
      const nailsFallback = nn
        ? [
            `My nails turned out so cute.`,
            `Love how my nails look.`,
            `So happy with my nails.`,
            `My nails came out really nice.`,
          ]
        : [
            `Love my nails, ${employee} did great.`,
            `My nails look amazing, ${employee} was great.`,
            `So happy with my nails, ${employee} did awesome.`,
            `Really love my nails, ${employee} did a great job.`,
          ];

      review = sanitize(pick(nailsFallback));
      if (!/[.!?]$/.test(review)) review += ".";
      review = trimToSentences(review, 1);
    }

    // Massage fallback (NEW, simple)
    if (isMassage && !massageIsAcceptable(review)) {
      const nn = String(noName || "").toLowerCase() === "true";
      const massageFallback = nn
        ? [
            `That massage was exactly what I needed.`,
            `Really relaxing massage today.`,
            `So glad I booked a massage here.`,
            `Great massage and I feel better.`,
          ]
        : [
            `That massage was exactly what I needed, ${employee} was great.`,
            `Really relaxing massage, ${employee} was great.`,
            `So glad I booked a massage with ${employee}.`,
            `Great massage and ${employee} was awesome.`,
          ];

      review = sanitize(pick(massageFallback));
      if (!/[.!?]$/.test(review)) review += ".";
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
