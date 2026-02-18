module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.json({ error: "Method not allowed" });
  }

  const { employee, businessType, serviceNotes } = req.body || {};

  // ✅ no-name mode (only impacts types that use it)
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

  // Added types
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

  // Default stays detailing
  if (!type) type = "auto_detailing";

  const notes = String(serviceNotes || "").trim();

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Sentence targets
  // Solar: ALWAYS 1
  // Nails: ALWAYS 1
  // Massage: ALWAYS 1 (we keep this)
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

  function ensureEndsWithPunctuation(text) {
    let t = String(text || "").trim();
    if (!t) return t;
    if (!/[.!?]$/.test(t)) t += ".";
    return t;
  }

  // ✅ gentle shortening (keeps it readable)
  function trimToMaxWords(text, maxWords) {
    const t = String(text || "").trim();
    if (!t) return t;

    const words = t.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return t;

    let out = words.slice(0, maxWords).join(" ");
    out = ensureEndsWithPunctuation(out);
    return out;
  }

  function maxWordsForType() {
    if (type === "solar") return 16;
    if (type === "nails") return 14;
    if (type === "massage") return noName ? 14 : 14; // keep tight
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

  // ✅ Stop employee name being used like a location/channel
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

  function fixBadNameContext(text) {
    let t = String(text || "");
    const name = String(employee || "").trim();
    if (!t || !name) return t;

    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(
      new RegExp(`\\b(through|thru|via)\\s+${escaped}\\b`, "gi"),
      `with ${name}`
    );
    t = t.replace(
      new RegExp(`\\b(in|at|from|out of)\\s+${escaped}\\b`, "gi"),
      `with ${name}`
    );
    return t;
  }

  // ✅ Reject fragments like: "she really", "who really knows", "I..."
  function endsLikeFragment(text) {
    const t = String(text || "").trim();
    if (!t) return true;

    if (/[,"']$/.test(t)) return true;

    const cleaned = t.replace(/[.!?]+$/g, "").trim().toLowerCase();

    const badEndings = [
      "she",
      "he",
      "they",
      "really",
      "so",
      "and",
      "but",
      "because",
      "who",
      "that",
      "how",
      "i",
      "we",
      "my",
      "the",
      "a",
      "an",
      "to",
      "with",
      "for",
      "of",
      "in",
      "at",
      "from",
    ];

    if (badEndings.includes(cleaned)) return true;

    if (/(who|she|he)\s+really$/.test(cleaned)) return true;
    if (/\bi\s*$/.test(cleaned)) return true;

    const last = cleaned.split(/\s+/).filter(Boolean).slice(-1)[0] || "";
    if (last.length <= 1) return true;

    return false;
  }

  // ------------------------
  // SOLAR (same as your version)
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
    if (hasBadNameContext(t)) return false;
    if (endsLikeFragment(t)) return false;

    const low = t.toLowerCase();
    if (!low.includes("solar")) return false;
    if (!low.includes(String(employee).toLowerCase())) return false;
    if (containsAny(t, solarBannedPhrases)) return false;
    if (countSentences(t) > 1) return false;

    const wc = wordCount(t);
    if (wc < 8) return false;

    return /[.!?]$/.test(t);
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
- Treat "${employee}" as a PERSON (not a place): do NOT say "through ${employee}" or "in ${employee}" or "at ${employee}".
- Keep it general like a template so the customer can edit.
- Keep it short.
- Do NOT use any of these phrases: ${solarBannedPhrases.join(", ")}.
- Do NOT use semicolons, colons, or any dashes.
- Make it a complete sentence that ends cleanly.

Optional notes (tone only):
${notes || "(none)"}

Instruction:
${pick(patterns)}

Return ONLY the review text.
    `.trim();
  }

  // ------------------------
  // NAILS (your existing nails rules — unchanged here)
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
    if (hasBadNameContext(t)) return false;
    if (endsLikeFragment(t)) return false;

    const low = t.toLowerCase();
    if (!low.includes(String(employee).toLowerCase())) return false;
    if (!(low.includes("nail") || low.includes("nails"))) return false;
    if (containsAny(t, nailsBannedPhrases)) return false;
    if (countSentences(t) > 1) return false;

    const wc = wordCount(t);
    if (wc < 7) return false;

    return /[.!?]$/.test(t);
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
- Treat "${employee}" as a PERSON (not a place): do NOT say "through ${employee}" or "in ${employee}" or "at ${employee}".
- Include "nail" or "nails" at least once.
- Keep it general like a template so the customer can edit.
- Keep it short.
- Do NOT use the word "experience".
- Do NOT include "thanks to" or "thank you".
- Do NOT use semicolons, colons, or any dashes.
- Make it a complete sentence that ends cleanly.

Optional notes (tone only):
${notes || "(none)"}

Instruction:
${pick(patterns)}

Return ONLY the review text.
    `.trim();
  }

  // ------------------------
  // MASSAGE (FIXED: varied + rejects your repeated templates)
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
    // ✅ kill the repetitive templates you showed
    "exactly what i needed",
    "completely relaxed",
    "relaxed and rejuvenated",
    "rejuvenated",
    "ease my tension",
    "eased my tension",
    "helped ease my tension",
    "incredibly relaxing",
    "left me feeling",
  ];

  const massageStyleCards = [
    {
      hint: "Short + real. Mention feeling better without sounding dramatic.",
      starters: ["So glad I booked", "Really happy I came in", "I feel so much better", "That was perfect"],
    },
    {
      hint: "Calm and simple. No big words.",
      starters: ["Really relaxing", "Great massage", "Super calming", "Felt really good"],
    },
    {
      hint: "Result-focused but general (no medical claims).",
      starters: ["Left feeling refreshed", "Left feeling lighter", "Feeling way more relaxed", "Feeling refreshed after"],
    },
    {
      hint: "Appreciative but not salesy.",
      starters: ["Really appreciate", "So thankful", "Glad I found", "Happy I booked with"],
    },
  ];

  function massageIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;

    if (startsWithName(t)) return false;
    if (endsWithName(t)) return false;
    if (startsWithStory(t)) return false;
    if (hasBadNameContext(t)) return false;
    if (endsLikeFragment(t)) return false;

    if (countSentences(t) > 1) return false;

    const low = t.toLowerCase();
    const empLow = String(employee).toLowerCase();

    // no-name mode
    if (noName) {
      if (low.includes(empLow)) return false;
    } else {
      if (!low.includes(empLow)) return false;
    }

    if (!low.includes("massage")) return false;
    if (containsAny(t, massageBannedPhrases)) return false;

    const wc = wordCount(t);
    if (wc < 7) return false;
    if (wc > 18) return false;

    if (!/[.!?]$/.test(t)) return false;

    // ✅ reject the most repetitive opener pattern
    if (low.startsWith("the massage was")) return false;

    return true;
  }

  function buildPromptMassage() {
    const style = pick(massageStyleCards);
    const starter = pick(style.starters);

    const patterns = [
      `Write ONE sentence that sounds like a real person leaving a quick Google review.`,
      `Write ONE short sentence that feels human and not like a template.`,
      `Write ONE short sentence someone would actually post.`,
    ];

    return `
Write a Google review draft for a massage.

Hard rules:
- Exactly ONE sentence, complete sentence (no trailing fragments).
- Do NOT start with a story opener.
- Do NOT mention the business name.
- Include the word "massage" at least once.
- Keep it short: 7 to 18 words.
- Avoid cliché templates like "exactly what I needed" or "relaxed and rejuvenated".
- Do NOT use the words "session" or "experience".
- Do NOT invent specific medical claims.
- Do NOT use semicolons, colons, or any dashes.
- Do NOT start with "The massage was".

${noName ? `
Name rules:
- Do NOT mention any employee name.
` : `
Name rules:
- Mention "${employee}" exactly once.
- Do NOT start with "${employee}".
- Do NOT end with "${employee}".
- Treat "${employee}" as a PERSON (not a place): do NOT say "through ${employee}" or "in ${employee}" or "at ${employee}".
`}

Style goal:
- ${style.hint}
- Optional starter vibe: "${starter}" (you can rephrase it, just keep the vibe).

Optional notes (tone only):
${notes || "(none)"}

Instruction:
${pick(patterns)}

Return ONLY the review text.
    `.trim();
  }

  // ------------------------
  // DETAILING (same as your version)
  // ------------------------
  function detailingIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;
    if (startsWithName(t)) return false;
    if (startsWithStory(t)) return false;
    if (hasBadNameContext(t)) return false;
    if (endsLikeFragment(t)) return false;
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
- Treat "${employee}" as a PERSON (not a place): do NOT say "through ${employee}" or "in ${employee}" or "at ${employee}".
- Keep it short.
- Do NOT use semicolons, colons, or any dashes.
- Make it a complete sentence that ends cleanly.

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
                "Write short, human-sounding Google reviews. Make them varied. Do not leave trailing fragments. Do not invent specific factual claims.",
            },
            { role: "user", content: prompt },
          ],
          temperature: temp,
          top_p: 0.95,
          presence_penalty: 0.8,
          frequency_penalty: 0.5,
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

  // ✅ Massage scoring: discourage sameness even within the batch
  function scoreMassageCandidate(t) {
    const low = String(t || "").toLowerCase();

    let score = 0;

    // Penalize your repetitive words
    const repetitive = ["relaxing", "relaxed", "rejuvenated", "tension", "exactly what i needed"];
    for (const p of repetitive) {
      if (low.includes(p)) score += 3;
    }

    // Penalize bland opener patterns
    if (low.startsWith("the massage")) score += 6;
    if (low.startsWith("my massage")) score += 3;
    if (low.includes("left me feeling")) score += 4;

    // Prefer shorter
    const wc = wordCount(t);
    score += Math.max(0, wc - 13) * 0.6;

    return score;
  }

  try {
    let review = "";
    const isSolar = type === "solar";
    const isNails = type === "nails";
    const isMassage = type === "massage";

    // ✅ MASSAGE: batch generate and pick best (THIS is the main fix)
    if (isMassage) {
      const candidates = [];
      for (let i = 0; i < 9; i++) {
        const prompt = buildPromptMassage();
        let r = await generate(prompt, 1.25, 70);

        r = sanitize(r);
        r = fixBadNameContext(r);
        r = trimToSentences(r, 1);
        r = ensureEndsWithPunctuation(r);
        r = trimToMaxWords(r, maxWordsForType());

        if (massageIsAcceptable(r)) candidates.push(r);
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => scoreMassageCandidate(a) - scoreMassageCandidate(b));
        review = candidates[0];
        return res.status(200).json({ review });
      }
      // If batch failed, fall through to normal retry/fallback
    }

    // Normal path: solar/nails/detailing
    for (let attempt = 0; attempt < 4; attempt++) {
      const prompt = isSolar
        ? buildPromptSolar()
        : isNails
        ? buildPromptNails()
        : buildPromptDetailing();

      review = await generate(
        prompt,
        isSolar ? 1.25 : isNails ? 1.15 : 1.05,
        isSolar ? 65 : isNails ? 65 : 85
      );

      review = sanitize(review);
      review = fixBadNameContext(review);
      review = trimToSentences(review, sentenceTarget);
      review = ensureEndsWithPunctuation(review);
      review = trimToMaxWords(review, maxWordsForType());

      if (isSolar) {
        if (solarIsAcceptable(review)) break;
      } else if (isNails) {
        if (nailsIsAcceptable(review)) break;
      } else {
        if (detailingIsAcceptable(review)) break;
      }
    }

    review = sanitize(review);
    review = fixBadNameContext(review);
    review = trimToSentences(review, sentenceTarget);
    review = ensureEndsWithPunctuation(review);
    review = trimToMaxWords(review, maxWordsForType());

    // Solar fallback
    if (isSolar && !solarIsAcceptable(review)) {
      const solarFallback = [
        `Really appreciate ${employee} being respectful about solar.`,
        `Solid overall and ${employee} was great with solar.`,
        `Glad I talked with ${employee} about solar.`,
        `Good visit and ${employee} was helpful with solar.`,
      ];
      review = sanitize(pick(solarFallback));
      review = fixBadNameContext(review);
      review = trimToSentences(review, 1);
      review = ensureEndsWithPunctuation(review);
      review = trimToMaxWords(review, maxWordsForType());
    }

    // Nails fallback
    if (isNails && !nailsIsAcceptable(review)) {
      const nailsFallback = [
        `My nails look so cute and ${employee} did great.`,
        `Love how my nails turned out and ${employee} was awesome.`,
        `My nails came out really nice and ${employee} helped a lot.`,
        `So happy with my nails and ${employee} did great.`,
        `My nails look amazing and I booked with ${employee}.`,
      ];
      review = sanitize(pick(nailsFallback));
      review = fixBadNameContext(review);
      review = trimToSentences(review, 1);
      review = ensureEndsWithPunctuation(review);
      review = trimToMaxWords(review, maxWordsForType());
    }

    // Massage fallback (now more varied + avoids your templates)
    if (isMassage && !massageIsAcceptable(review)) {
      const massageFallbackNamed = [
        `Really happy I booked a massage with ${employee} today.`,
        `Great massage with ${employee}, I feel refreshed after.`,
        `So glad I came in for a massage with ${employee}.`,
        `My massage with ${employee} felt calm and steady.`,
      ];

      const massageFallbackNoName = [
        `Really happy I booked a massage today.`,
        `Great massage and I feel refreshed after.`,
        `So glad I came in for a massage.`,
        `My massage felt calm and steady.`,
      ];

      review = sanitize(pick(noName ? massageFallbackNoName : massageFallbackNamed));
      review = fixBadNameContext(review);
      review = trimToSentences(review, 1);
      review = ensureEndsWithPunctuation(review);
      review = trimToMaxWords(review, maxWordsForType());
    }

    // Detailing fallback
    if (!isSolar && !isNails && !isMassage && !detailingIsAcceptable(review)) {
      review =
        sentenceTarget === 2
          ? `My car looks great after the detail. ${employee} did a solid job.`
          : `My car looks great after the detail, ${employee} did a solid job.`;

      review = sanitize(review);
      review = fixBadNameContext(review);
      review = trimToSentences(review, sentenceTarget);
      review = ensureEndsWithPunctuation(review);
      review = trimToMaxWords(review, maxWordsForType());
    }

    return res.status(200).json({ review });
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    return res.json({ error: "AI generation failed" });
  }
};
