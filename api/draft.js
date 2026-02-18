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

  // ✅ gentle shortening
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
    if (type === "nails") return 16; // ✅ slightly higher to avoid fragments after trimming
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

    // If it ends with a quote/comma or incomplete punctuation
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
      "who really",
      "that",
      "knows",
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

    // Ends with “who really knows” / “she really” / “I…”
    if (/(who|she|he)\s+really$/.test(cleaned)) return true;
    if (/\bwho\s+really\s+knows$/.test(cleaned)) return true;
    if (/\bi\s*$/.test(cleaned)) return true;

    // If last token is tiny / weird
    const last = cleaned.split(/\s+/).filter(Boolean).slice(-1)[0] || "";
    if (last.length <= 1) return true;

    return false;
  }

  // ------------------------
  // SOLAR (same as you had)
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
- Treat "${employee}" as a PERSON (not a place): do NOT say "through ${employee}" or "in ${employee}" or "at ${employee}".
- Keep it general like a template so the customer can edit.
- Keep it short.
- Do NOT use any of these phrases: ${solarBannedPhrases.join(", ")}.
- Do NOT use semicolons, colons, or any dashes.
- Make it a complete sentence that ends cleanly.

Optional notes (tone only, no specific claims):
${notes || "(none)"}

Instruction:
${pick(patterns)}

Return ONLY the review text.
    `.trim();
  }

  // ------------------------
  // NAILS (UPGRADED for human + varied + no fragments)
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
    // ✅ stop the repetitive theme you showed
    "great time chatting",
    "had a great time chatting",
    "chatting with",
  ];

  const nailsStyleCards = [
    {
      name: "Result-focused",
      hint: "Focus on how the nails turned out (simple + real).",
      starters: ["Love how my nails turned out", "My nails look so good", "So happy with my nails", "These nails are perfect"],
    },
    {
      name: "Skill-focused",
      hint: "Mention the tech’s skill without sounding like an ad.",
      starters: ["Cambria knows what she’s doing", "Cambria has such a good eye", "Cambria did an awesome job", "Cambria nailed it"],
    },
    {
      name: "Low-key",
      hint: "Calm and short, like a real person typing fast.",
      starters: ["Super happy with this set", "Really like this set", "This set came out great", "So glad I booked"],
    },
    {
      name: "Clean + simple",
      hint: "Minimal words, no fluff, not dramatic.",
      starters: ["Great nails", "Love this set", "So cute", "Turned out great"],
    },
  ];

  function nailsIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;

    if (startsWithName(t)) return false;
    if (endsWithName(t)) return false;
    if (startsWithStory(t)) return false;
    if (hasBadNameContext(t)) return false;

    if (countSentences(t) > 1) return false;

    const low = t.toLowerCase();
    if (!low.includes(String(employee).toLowerCase())) return false;
    if (!(low.includes("nail") || low.includes("nails"))) return false;

    if (containsAny(t, nailsBannedPhrases)) return false;

    const wc = wordCount(t);
    // ✅ keep it short but not tiny
    if (wc < 7) return false;
    if (wc > 18) return false;

    // ✅ must end cleanly
    if (!/[.!?]$/.test(t)) return false;
    if (endsLikeFragment(t)) return false;

    return true;
  }

  function buildPromptNails() {
    const style = pick(nailsStyleCards);
    const starter = pick(style.starters);

    const patterns = [
      `Write ONE sentence that sounds like a real person typing a quick Google review.`,
      `Write ONE sentence that feels human and not like a template.`,
      `Write ONE short sentence someone would actually post.`,
    ];

    return `
Write a Google review draft for a nails appointment.

Hard rules:
- Exactly ONE sentence, and it must be a COMPLETE sentence (no trailing fragments like "she really" or "who really knows").
- Do NOT start with "${employee}".
- Do NOT end with "${employee}".
- Do NOT start with a story opener.
- Do NOT mention the business name.
- Mention "${employee}" exactly once.
- Treat "${employee}" as a PERSON (not a place): do NOT say "through ${employee}" or "in ${employee}" or "at ${employee}".
- Include "nail" or "nails" at least once.
- Keep it short: 7 to 18 words.
- Do NOT use the word "experience".
- Do NOT include "thanks to" or "thank you".
- Avoid talking about "chatting" or "great time chatting".
- Do NOT use semicolons, colons, or any dashes.

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
  // MASSAGE (same as you had + fragment check)
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
    if (hasBadNameContext(t)) return false;
    if (endsLikeFragment(t)) return false;

    const low = t.toLowerCase();
    const empLow = String(employee).toLowerCase();

    if (noName) {
      if (low.includes(empLow)) return false;
    } else {
      if (!low.includes(empLow)) return false;
    }

    if (!low.includes("massage")) return false;

    if (containsAny(t, massageBannedPhrases)) return false;

    if (countSentences(t) > 1) return false;

    const wc = wordCount(t);
    if (wc < 7) return false;

    if (!/[.!?]$/.test(t)) return false;

    return true;
  }

  function buildPromptMassage() {
    const patterns = [
      `Write ONE very simple sentence that sounds like a real review starter and is easy to edit.`,
      `Write ONE short, normal sentence someone would actually type after a massage.`,
      `Write ONE short and casual review line that feels human.`,
      `Write ONE simple positive sentence that is not overly specific.`,
    ];

    return `
Write a review draft.

Hard rules:
- Exactly ONE sentence.
- Must be a complete sentence (no trailing fragments).
- Do NOT start with a story opener.
- Do NOT mention the business name.
- Include the word "massage" at least once.
- Keep it very simple and general like a template.
- Keep it short.
- Avoid the words "session" and "experience".
- Do NOT add made up details or stories.
- Do NOT use semicolons, colons, or any dashes.
${noName ? "- Do NOT mention any employee name." : `- Mention "${employee}" exactly once.\n- Do NOT start with "${employee}".\n- Do NOT end with "${employee}".\n- Treat "${employee}" as a PERSON: do NOT say "through ${employee}" or "in ${employee}" or "at ${employee}".`}

Optional notes (tone only):
${notes || "(none)"}

Instruction:
${pick(patterns)}

Return ONLY the review text.
    `.trim();
  }

  // ------------------------
  // DETAILING (same as you had + fragment check)
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
- Treat "${employee}" as a PERSON: do NOT say "through ${employee}" or "in ${employee}" or "at ${employee}".
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

  // ✅ For nails: generate several options and pick the best one
  function scoreNailsCandidate(t) {
    const low = String(t || "").toLowerCase();

    // lower score = better
    let score = 0;

    // discourage the patterns you showed
    const badThemes = ["had a great time", "great time", "chatting"];
    for (const p of badThemes) {
      if (low.includes(p)) score += 5;
    }

    // discourage super generic "impressed" / "skills" combos
    const mildCliches = ["really impressed", "skills", "absolutely", "nailed the look"];
    for (const p of mildCliches) {
      if (low.includes(p)) score += 2;
    }

    // prefer shorter
    const wc = wordCount(t);
    score += Math.max(0, wc - 14) * 0.5;

    return score;
  }

  try {
    let review = "";
    const isSolar = type === "solar";
    const isNails = type === "nails";
    const isMassage = type === "massage";

    // ✅ NAILS: batch generate and pick best
    if (isNails) {
      const candidates = [];
      for (let i = 0; i < 9; i++) {
        const prompt = buildPromptNails();
        let r = await generate(prompt, 1.25, 70);

        r = sanitize(r);
        r = fixBadNameContext(r);
        r = trimToSentences(r, 1);
        r = ensureEndsWithPunctuation(r);
        r = trimToMaxWords(r, maxWordsForType());

        if (nailsIsAcceptable(r)) candidates.push(r);
      }

      if (candidates.length > 0) {
        candidates.sort((a, b) => scoreNailsCandidate(a) - scoreNailsCandidate(b));
        review = candidates[0];
        return res.status(200).json({ review });
      }
      // fall through to normal retry/fallback if batch failed
    }

    // Normal path (solar/massage/detailing)
    for (let attempt = 0; attempt < 4; attempt++) {
      const prompt = isSolar
        ? buildPromptSolar()
        : isMassage
        ? buildPromptMassage()
        : buildPromptDetailing();

      review = await generate(
        prompt,
        isSolar ? 1.25 : isMassage ? 1.15 : 1.05,
        isSolar ? 65 : isMassage ? 65 : 85
      );

      review = sanitize(review);
      review = fixBadNameContext(review);
      review = trimToSentences(review, sentenceTarget);
      review = ensureEndsWithPunctuation(review);
      review = trimToMaxWords(review, maxWordsForType());

      if (isSolar) {
        if (solarIsAcceptable(review)) break;
      } else if (isMassage) {
        if (massageIsAcceptable(review)) break;
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

    // Nails fallback (stronger, more human)
    if (isNails && !nailsIsAcceptable(review)) {
      const nailsFallback = [
        `Love my nails, ${employee} did such a good job.`,
        `My nails turned out perfect, ${employee} is the best.`,
        `So happy with my nails, ${employee} nailed the shape.`,
        `These nails are so cute, ${employee} did amazing work.`,
        `My nails look so clean and cute, ${employee} did great.`,
      ];
      review = sanitize(pick(nailsFallback));
      review = fixBadNameContext(review);
      review = trimToSentences(review, 1);
      review = ensureEndsWithPunctuation(review);
      review = trimToMaxWords(review, maxWordsForType());
    }

    // Massage fallback
    if (isMassage && !massageIsAcceptable(review)) {
      const massageFallbackNamed = [
        `My massage felt great and ${employee} was awesome.`,
        `Really happy I booked a massage with ${employee}.`,
        `My massage was relaxing and ${employee} did great.`,
      ];

      const massageFallbackNoName = [
        `My massage felt really relaxing and I would come back.`,
        `My massage was exactly what I needed today.`,
        `Such a relaxing massage and I would recommend it.`,
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
