module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.json({ error: "Method not allowed" });
  }

  const { employee, businessType, serviceNotes } = req.body || {};

  // ✅ NEW: no-name mode (only impacts types that use it)
  const noName =
    req.body?.noName === true ||
    req.body?.noName === "true" ||
    req.body?.noName === 1 ||
    req.body?.noName === "1";

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

  // ✅ NEW: gentle shortening (keeps it readable)
  function trimToMaxWords(text, maxWords) {
    const t = String(text || "").trim();
    if (!t) return t;

    const words = t.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return t;

    let out = words.slice(0, maxWords).join(" ");

    // keep ending punctuation
    if (!/[.!?]$/.test(out)) out += ".";
    return out;
  }

  function maxWordsForType() {
    if (type === "solar") return 16;
    if (type === "nails") return 14;
    if (type === "massage") return noName ? 15 : 14;

    // detailing
    return sentenceTarget === 2 ? 30 : 22;
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

  // ✅ NEW: stop employee name being used like a location/channel
  // Examples blocked: "through Cambria", "via Cambria", "in Cambria", "at Cambria", "from Cambria"
  function hasBadNameContext(text) {
    const t = String(text || "");
    const name = String(employee || "").trim();
    if (!t || !name) return false;

    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(
      `\\b(through|thru|via|in|at|from|out of)\\s+${escaped}\\b`,
      "i"
    );
    return re.test(t);
  }

  // ✅ NEW: auto-fix the worst offenders if they appear
  function fixBadNameContext(text) {
    let t = String(text || "");
    const name = String(employee || "").trim();
    if (!t || !name) return t;

    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Replace "through NAME"/"via NAME"/"thru NAME" with "with NAME"
    t = t.replace(new RegExp(`\\b(through|thru|via)\\s+${escaped}\\b`, "gi"), `with ${name}`);

    // Also replace "in NAME" / "at NAME" / "from NAME" if they show up
    // (still sounds more like a person than a place)
    t = t.replace(new RegExp(`\\b(in|at|from|out of)\\s+${escaped}\\b`, "gi"), `with ${name}`);

    return t;
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

    // ✅ NEW
    if (hasBadNameContext(t)) return false;

    const low = t.toLowerCase();

    if (!low.includes("solar")) return false;
    if (!low.includes(String(employee).toLowerCase())) return false;

    if (containsAny(t, solarBannedPhrases)) return false;

    if (countSentences(t) > 1) return false;

    const wc = wordCount(t);
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
- IMPORTANT: Treat "${employee}" as a PERSON. Do NOT say "through ${employee}" or "in ${employee}" or "at ${employee}".
- Keep it general like a template so the customer can edit.
- Keep it short.
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
    "after a long day",
    "after a long week",
    "after work",
    "roadtrip",
    "hauling",
    "thanks to",
    "thank you",
    "experience",
  ];

  function nailsIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;

    if (startsWithName(t)) return false;
    if (endsWithName(t)) return false;
    if (startsWithStory(t)) return false;

    // ✅ NEW
    if (hasBadNameContext(t)) return false;

    const low = t.toLowerCase();

    if (!low.includes(String(employee).toLowerCase())) return false;
    if (!(low.includes("nail") || low.includes("nails"))) return false;

    if (containsAny(t, nailsBannedPhrases)) return false;

    if (countSentences(t) > 1) return false;

    const wc = wordCount(t);
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
- IMPORTANT: Treat "${employee}" as a PERSON. Do NOT say "through ${employee}" or "in ${employee}" or "at ${employee}".
- Include "nail" or "nails" at least once.
- Keep it general like a template so the customer can edit.
- Keep it short.
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

    // ✅ NEW
    if (hasBadNameContext(t)) return false;

    const low = t.toLowerCase();
    const empLow = String(employee).toLowerCase();

    // ✅ NEW: no-name mode
    if (noName) {
      if (low.includes(empLow)) return false; // reject if it mentions her name
    } else {
      if (!low.includes(empLow)) return false; // require name normally
    }

    if (!low.includes("massage")) return false;

    if (containsAny(t, massageBannedPhrases)) return false;

    if (countSentences(t) > 1) return false;

    const wc = wordCount(t);
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
- Do NOT start with a story opener.
- Do NOT mention the business name.
- Include the word "massage" at least once.
- Keep it very simple and general like a template.
- Keep it short.
- Avoid the words "session" and "experience".
- Do NOT add made up details or stories.
- Do NOT use semicolons, colons, or any dashes.
${noName ? "- Do NOT mention any employee name." : `- Mention "${employee}" exactly once.\n- Do NOT start with "${employee}".\n- Do NOT end with "${employee}".\n- IMPORTANT: Treat "${employee}" as a PERSON. Do NOT say "through ${employee}" or "in ${employee}" or "at ${employee}".`}

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

    // ✅ NEW (doesn’t hurt detailing)
    if (hasBadNameContext(t)) return false;

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
- IMPORTANT: Treat "${employee}" as a PERSON. Do NOT say "through ${employee}" or "in ${employee}" or "at ${employee}".
- Keep it short.
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
        isSolar ? 1.25 : isNails ? 1.15 : isMassage ? 1.15 : 1.05,
        // slightly lower tokens = slightly shorter
        isSolar ? 65 : isNails ? 65 : isMassage ? 65 : 85
      );

      review = sanitize(review);
      review = fixBadNameContext(review); // ✅ NEW
      review = trimToSentences(review, sentenceTarget);
      review = trimToMaxWords(review, maxWordsForType());

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
    review = fixBadNameContext(review); // ✅ NEW
    review = trimToSentences(review, sentenceTarget);
    review = trimToMaxWords(review, maxWordsForType());

    // Solar fallback (KEEP your behavior)
    if (isSolar && !solarIsAcceptable(review)) {
      const solarFallback = [
        `Really appreciate ${employee} being respectful about solar.`,
        `Solid overall and ${employee} was great with solar.`,
        `Glad I talked with ${employee} about solar.`,
        `Good visit and ${employee} was helpful with solar.`,
        `Professional help from ${employee} on solar.`,
        `Positive visit and ${employee} was great on solar.`,
        `Everything felt professional and ${employee} helped with solar.`,
        `Happy overall and ${employee} was friendly about solar.`,
      ];
      review = sanitize(pick(solarFallback));
      review = fixBadNameContext(review); // ✅ NEW
      review = trimToSentences(review, 1);
      review = trimToMaxWords(review, maxWordsForType());
    }

    // Nails fallback (NEW)
    if (isNails && !nailsIsAcceptable(review)) {
      const nailsFallback = [
        `My nails look so cute and ${employee} did great.`,
        `Love how my nails turned out and ${employee} was awesome.`,
        `My nails came out really nice and ${employee} helped a lot.`,
        `So happy with my nails and ${employee} did great.`,
        `My nails look amazing and I booked with ${employee}.`,
      ];
      review = sanitize(pick(nailsFallback));
      review = fixBadNameContext(review); // ✅ NEW
      review = trimToSentences(review, 1);
      review = trimToMaxWords(review, maxWordsForType());
    }

    // Massage fallback (NEW) — supports no-name mode
    if (isMassage && !massageIsAcceptable(review)) {
      const massageFallbackNamed = [
        `My massage felt great and ${employee} was awesome.`,
        `Really happy I booked a massage with ${employee}.`,
        `My massage was relaxing and ${employee} did great.`,
        `My massage helped a lot and ${employee} was great.`,
      ];

      const massageFallbackNoName = [
        `My massage felt really relaxing and I would come back.`,
        `Really happy I booked a massage and I feel great after.`,
        `My massage was exactly what I needed today.`,
        `Such a relaxing massage and I would recommend it.`,
      ];

      review = sanitize(pick(noName ? massageFallbackNoName : massageFallbackNamed));
      review = fixBadNameContext(review); // ✅ NEW
      review = trimToSentences(review, 1);
      review = trimToMaxWords(review, maxWordsForType());
    }

    // Detailing fallback (KEEP your behavior)
    if (!isSolar && !isNails && !isMassage && !detailingIsAcceptable(review)) {
      review =
        sentenceTarget === 2
          ? `My car looks great after the detail. ${employee} did a solid job.`
          : `My car looks great after the detail, ${employee} did a solid job.`;

      review = sanitize(review);
      review = fixBadNameContext(review); // ✅ NEW
      review = trimToSentences(review, sentenceTarget);
      review = trimToMaxWords(review, maxWordsForType());
    }

    return res.status(200).json({ review });
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    return res.json({ error: "AI generation failed" });
  }
};
