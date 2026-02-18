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
  const nn = String(noName || "").toLowerCase() === "true";

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
  // GLOBAL anti-cliche controls (this is the big “stop repeating” fix)
  // ------------------------
  const globalCliches = [
    "highly recommend",
    "would highly recommend",
    "great service",
    "amazing service",
    "great experience",
    "amazing experience",
    "very professional",
    "super professional",
    "friendly and professional",
    "went above and beyond",
    "above and beyond",
    "10/10",
    "five stars",
    "5 stars",
    "exceptional",
    "outstanding",
    "top notch",
    "best in town",
    "look no further",
    "i can't recommend",
    "couldn't recommend",
    "definitely recommend",
    "fast and efficient",
  ];

  const globalStoryOpeners = [
    "i just",
    "i recently",
    "we recently",
    "today i",
    "this morning",
    "this afternoon",
    "from start to finish",
  ];

  function startsWithGenericOpener(text) {
    const t = String(text || "").trim().toLowerCase();
    if (!t) return false;
    return globalStoryOpeners.some((p) => t.startsWith(p));
  }

  function hasTooManyExclamations(text) {
    const t = String(text || "");
    const count = (t.match(/!/g) || []).length;
    return count > 1;
  }

  function hasEmoji(text) {
    return /[\u{1F300}-\u{1FAFF}]/u.test(String(text || ""));
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
    if (startsWithGenericOpener(t)) return false;

    const low = t.toLowerCase();

    if (!low.includes("solar")) return false;

    // Must mention employee once (unless noName is enabled)
    if (nn) {
      if (low.includes(String(employee).toLowerCase())) return false;
    } else {
      if (!low.includes(String(employee).toLowerCase())) return false;
      if (includeEmployeeOnce(t) !== 1) return false;
      if (endsWithName(t)) return false;
      if (hasInEmployee(t, employee)) return false;
    }

    if (containsAny(t, solarBannedPhrases)) return false;
    if (containsAny(t, globalCliches)) return false;

    if (countSentences(t) > 1) return false;

    const wc = wordCount(t);
    if (wc < 8) return false;
    if (wc > 16) return false;

    if (!/[.!?]$/.test(t)) return false;
    if (endsWithBadToken(t)) return false;

    if (hasEmoji(t)) return false;
    if (hasTooManyExclamations(t)) return false;

    return true;
  }

  function buildPromptSolar() {
    const tone = pick([
      "casual and simple",
      "short and normal",
      "friendly but not salesy",
      "plain and real",
    ]);

    const structure = pick([
      "Mention solar + one quick positive + name mention naturally.",
      "Keep it vague, like a starter line someone would type.",
      "Say what you liked without sounding like an ad.",
      "Keep it calm and straightforward.",
    ]);

    const patterns = [
      `Write ONE short sentence that sounds like a real Google review starter and is easy for a customer to edit.`,
      `Write ONE sentence that feels genuine but stays general so the customer can personalize it.`,
      `Write ONE sentence that sounds normal and not robotic and leaves room for the customer to add details.`,
      `Write ONE sentence that is positive and vague like a template someone could tweak.`,
    ];

    return `
Write a Google review draft.

Tone:
- ${tone}

Structure:
- ${structure}

Hard rules:
- Exactly ONE sentence.
- Do NOT start with a story opener.
- Do NOT mention the business name.
- Include the word "solar" exactly once.
- Keep it general like a template so the customer can edit.
- Do NOT use any of these phrases: ${solarBannedPhrases.join(", ")}.
- Avoid these overused review phrases: ${globalCliches.join(", ")}.
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
  // NAILS (unchanged, but add global anti-cliche)
  // ------------------------
  const nailsBannedPhrases = [
    "after a long day",
    "after a long week",
    "after work",
    "roadtrip",
    "hauling",
    "experience",
    "vibe",
    "thanks to",
    "thank you",
  ];

  function nailsIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;

    if (countSentences(t) > 1) return false;
    if (!/[.!?]$/.test(t)) return false;
    if (endsWithBadToken(t)) return false;

    const wc = wordCount(t);
    if (wc < 6 || wc > 14) return false;

    if (containsAny(t, nailsBannedPhrases)) return false;
    if (containsAny(t, globalCliches)) return false;

    const low = t.toLowerCase();
    if (!(low.includes("nail") || low.includes("nails"))) return false;

    // user request: remove “and” for nails
    if (/\band\b/i.test(t)) return false;

    if (startsWithStory(t)) return false;
    if (startsWithGenericOpener(t)) return false;

    if (nn) {
      const empLow = String(employee || "").trim().toLowerCase();
      if (empLow && low.includes(empLow)) return false;
    } else {
      const empLow = String(employee || "").trim().toLowerCase();
      if (!empLow) return false;
      if (!low.includes(empLow)) return false;
      if (includeEmployeeOnce(t) !== 1) return false;
      if (startsWithName(t)) return false;
      if (endsWithName(t)) return false;
      if (hasInEmployee(t, employee)) return false;
    }

    if (hasEmoji(t)) return false;
    if (hasTooManyExclamations(t)) return false;

    return true;
  }

  function buildPromptNails() {
    const tone = pick([
      "short and sweet",
      "simple and real",
      "happy but not dramatic",
      "casual and normal",
    ]);

    const nnPatterns = [
      `Write ONE short sentence that sounds like a real nails review starter someone could edit.`,
      `Write ONE simple sentence that feels human and normal for a nails review.`,
      `Write ONE short nails review template line with no extra details.`,
      `Write ONE short line that focuses on the nails result (no extra story).`,
    ];

    const namedPatterns = [
      `Write ONE short sentence that sounds like a real nails review starter someone could edit.`,
      `Write ONE simple sentence that feels human and normal.`,
      `Write ONE short nails review template line that mentions the tech in a natural way.`,
      `Write ONE short line that mentions "${employee}" naturally without starting with the name.`,
    ];

    return `
Write a Google review draft.

Tone:
- ${tone}

Hard rules:
- Exactly ONE sentence.
- Do NOT start with a story opener.
- Do NOT mention the business name.
- Do NOT use the word "experience" or "vibe".
- Do NOT use the word "and".
- Avoid these overused review phrases: ${globalCliches.join(", ")}.
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
${nn ? pick(nnPatterns) : pick(namedPatterns)}

Return ONLY the review text.
    `.trim();
  }

  // ------------------------
  // MASSAGE (unchanged, but add global anti-cliche)
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
    if (startsWithGenericOpener(t)) return false;

    const low = t.toLowerCase();
    if (!low.includes("massage")) return false;

    if (containsAny(t, massageBannedPhrases)) return false;
    if (containsAny(t, globalCliches)) return false;

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

    if (hasEmoji(t)) return false;
    if (hasTooManyExclamations(t)) return false;

    return true;
  }

  function buildPromptMassage() {
    const tone = pick([
      "simple and calm",
      "short and normal",
      "relieved but not dramatic",
      "casual and real",
    ]);

    const patterns = nn
      ? [
          `Write ONE very simple sentence someone would type as a review starter.`,
          `Write ONE short and normal sentence that is easy to edit.`,
          `Write ONE simple positive line with no extra details.`,
          `Write ONE simple line that mentions massage without sounding like an ad.`,
        ]
      : [
          `Write ONE very simple sentence someone would type as a review starter.`,
          `Write ONE short and normal sentence that mentions the therapist naturally.`,
          `Write ONE simple positive line that is easy to edit.`,
          `Write ONE short line that mentions "${employee}" naturally without starting with the name.`,
        ];

    return `
Write a review draft.

Tone:
- ${tone}

Hard rules:
- Exactly ONE sentence.
- Do NOT start with a story opener.
- Do NOT mention the business name.
- Include the word "massage" at least once.
- Keep it very simple and general like a template.
- Avoid the words "session", "experience", and "vibe".
- Avoid these overused review phrases: ${globalCliches.join(", ")}.
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
  // DETAILING (this is where repetition usually happens)
  // ------------------------
  function detailingIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;

    // keep your existing guardrails
    if (startsWithName(t)) return false;
    if (startsWithStory(t)) return false;

    // new: block generic openers + clichés (major repetition reducers)
    if (startsWithGenericOpener(t)) return false;
    if (containsAny(t, globalCliches)) return false;

    // new: keep it clean
    if (hasEmoji(t)) return false;
    if (hasTooManyExclamations(t)) return false;

    // keep it from getting weird-long or fragment-short
    const wc = wordCount(t);
    if (sentenceTarget === 1) {
      if (wc < 10 || wc > 26) return false;
    } else {
      if (wc < 16 || wc > 40) return false;
    }

    // must end with punctuation and not end on junk
    if (!/[.!?]$/.test(t)) return false;
    if (endsWithBadToken(t)) return false;

    // name rules
    const low = t.toLowerCase();
    const empLow = String(employee || "").trim().toLowerCase();

    if (nn) {
      if (empLow && low.includes(empLow)) return false;
    } else {
      if (!empLow) return false;
      if (!low.includes(empLow)) return false;
      if (includeEmployeeOnce(t) !== 1) return false;
      if (endsWithName(t)) return false;
      if (hasInEmployee(t, employee)) return false;
    }

    // sentence count check (allow <= target, then trim handles it)
    if (countSentences(t) > sentenceTarget) return false;

    return true;
  }

  function buildPromptDetailing() {
    const tone = pick([
      "casual and normal (like a real person typed it)",
      "short and calm",
      "happy but not overhyped",
      "simple and straightforward",
      "friendly and low-key",
    ]);

    const structure = pick([
      "Result first, then mention the employee naturally.",
      "Mention the employee naturally, then the clean result.",
      "One simple compliment + one simple result.",
      "Keep it plain and believable, like a quick review starter.",
      "Avoid sounding like marketing; write like a customer.",
    ]);

    const allowedStarters = pick([
      "So happy with how it turned out",
      "My car looks so clean",
      "Really happy with the detail",
      "Super happy with the results",
      "My car came out really clean",
      "The car looks great now",
      "Everything looks really clean",
      "Great detail and it looks awesome",
      "Love how clean it looks",
      "It came out really nice",
    ]);

    return `
Write a short Google review draft.

Tone:
- ${tone}

Structure:
- ${structure}

Rules:
- ${sentenceTarget} sentence${sentenceTarget === 2 ? "s" : ""} only.
- Do NOT start with "${employee}".
- Do NOT start with a story opener.
- Do NOT mention the business name.
- Avoid these overused review phrases: ${globalCliches.join(", ")}.
- Do NOT use semicolons, colons, or any dashes.
- Do NOT use emojis.
- Use at most one exclamation point (prefer none).
- Start with something like: "${allowedStarters}" (you can rephrase it, but keep that vibe).
- Keep it believable and not salesy.

Context:
- Employee name: "${employee}"
- This is an auto detailing service.

${nn ? `
Name rules:
- Do NOT mention "${employee}" at all.
` : `
Name rules:
- Mention "${employee}" exactly once.
- Mention them naturally (not as the first word).
- Do NOT end with "${employee}".
- NEVER write "in ${employee}".
`}

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
                "Write short, human-sounding review drafts. Make them varied. Avoid clichés and repeated phrasing. Do not invent specific claims.",
            },
            { role: "user", content: prompt },
          ],
          temperature: temp,
          top_p: 0.9,
          presence_penalty: 0.7,
          frequency_penalty: 0.4,
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
        isSolar ? 1.2 : isNails ? 1.1 : isMassage ? 1.15 : 1.15,
        // shorter outputs for nails/massage/solar, leave detailing alone
        isSolar ? 70 : isNails ? 55 : isMassage ? 55 : 120
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
      const solarFallback = nn
        ? [
            `Appreciated how professional they were about solar.`,
            `Good solar visit and it felt respectful.`,
            `Helpful solar info and no pressure.`,
            `Solid solar visit and it felt professional.`,
          ]
        : [
            `Appreciated ${employee} being respectful about solar.`,
            `Good solar visit and ${employee} was helpful.`,
            `Helpful solar info from ${employee} with no pressure.`,
            `Solid solar visit and ${employee} was professional.`,
          ];

      review = sanitize(pick(solarFallback));
      if (!/[.!?]$/.test(review)) review += ".";
      review = trimToSentences(review, 1);
    }

    // Nails fallback (NEW, bulletproof)
    if (isNails && !nailsIsAcceptable(review)) {
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

    // Detailing fallback (now more varied)
    if (!isSolar && !isNails && !isMassage && !detailingIsAcceptable(review)) {
      const detailingFallback = nn
        ? [
            `My car looks really clean after the detail.`,
            `Really happy with how clean everything turned out.`,
            `The detail made a big difference and it looks great.`,
            `Super happy with the results from the detail.`,
          ]
        : sentenceTarget === 2
        ? [
            `My car looks really clean after the detail. ${employee} did a solid job.`,
            `Really happy with how it turned out. ${employee} made the car look great.`,
            `The car came out really clean. ${employee} did a great job.`,
            `Super happy with the detail. ${employee} was easy to work with.`,
          ]
        : [
            `My car looks really clean after the detail, ${employee} did a solid job.`,
            `Really happy with how it turned out, ${employee} did a great job.`,
            `The car came out really clean, ${employee} was great.`,
            `Super happy with the detail, ${employee} did a good job.`,
          ];

      review = sanitize(pick(detailingFallback));
      if (!/[.!?]$/.test(review)) review += ".";
      review = trimToSentences(review, sentenceTarget);
    }

    return res.status(200).json({ review });
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    return res.json({ error: "AI generation failed" });
  }
};
