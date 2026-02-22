module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.json({ error: "Method not allowed" });
  }

  const { employee, businessType, serviceNotes } = req.body || {};

  // no-name mode (only impacts types that use it)
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

  // ✅ NEW: Insurance normalization
  if (
    type === "insurance" ||
    type === "ins" ||
    type === "insurance_agency" ||
    type === "insurance-agency" ||
    type === "allstate"
  ) {
    type = "insurance";
  }

  // Default stays detailing
  if (!type) type = "auto_detailing";

  const notes = String(serviceNotes || "").trim();

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Sentence targets
  // Solar: 1
  // Nails: 1
  // Massage: 1
  // Insurance: 1
  // Detailing: mostly 1, sometimes 2
  const sentenceTarget =
    type === "solar"
      ? 1
      : type === "nails"
      ? 1
      : type === "massage"
      ? 1
      : type === "insurance"
      ? 1
      : Math.random() < 0.25
      ? 2
      : 1;

  // -------- helpers --------
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

  function trimToMaxWords(text, maxWords) {
    const t = String(text || "").trim();
    if (!t) return t;

    const words = t.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return t;

    let out = words.slice(0, maxWords).join(" ");
    out = ensureEndsWithPunctuation(out);
    return out;
  }

  // ✅ Slightly shorter across the board
  function maxWordsForType() {
    if (type === "solar") return 14;
    if (type === "nails") return 14;
    if (type === "massage") return 14;
    if (type === "insurance") return 14;
    return sentenceTarget === 2 ? 28 : 20;
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

  // Stop employee name being used like a location/channel
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

  // Reject trailing fragments
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

    const last = cleaned.split(/\s+/).filter(Boolean).slice(-1)[0] || "";
    if (last.length <= 1) return true;

    return false;
  }

  // Similarity helpers
  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[\u2019]/g, "'")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function trigrams(text) {
    const words = normalize(text).split(" ").filter(Boolean);
    if (words.length < 3) return new Set(words);
    const grams = [];
    for (let i = 0; i < words.length - 2; i++) {
      grams.push(words[i] + " " + words[i + 1] + " " + words[i + 2]);
    }
    return new Set(grams);
  }

  function jaccard(aSet, bSet) {
    if (!aSet.size && !bSet.size) return 1;
    let inter = 0;
    for (const x of aSet) if (bSet.has(x)) inter++;
    const union = aSet.size + bSet.size - inter;
    return union === 0 ? 0 : inter / union;
  }

  function similarityScore(a, b) {
    return jaccard(trigrams(a), trigrams(b));
  }

  function isNearDuplicate(candidate, accepted, threshold) {
    const cNorm = normalize(candidate);
    for (const a of accepted) {
      if (normalize(a) === cNorm) return true;
      if (similarityScore(candidate, a) >= threshold) return true;
    }
    return false;
  }

  // pick from top-N to avoid same “best” template every time
  function pickFromTop(scored, topN) {
    if (!Array.isArray(scored) || scored.length === 0) return null;
    const n = Math.min(topN, scored.length);
    return scored[Math.floor(Math.random() * n)];
  }

  // -------- prompts + acceptability --------

  // SOLAR
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
    if (wordCount(t) < 8) return false;

    return /[.!?]$/.test(t);
  }

  function buildPromptSolar() {
    const patterns = [
      `Write ONE short sentence that sounds like a real Google review starter and is easy to edit.`,
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

  // NAILS (speed mode batch)
  const nailsBannedPhrases = [
    "thanks to",
    "thank you",
    "experience",
    "chatting",
    "great time chatting",
    "had a great time chatting",

    // ✅ kill the repeating templates you showed
    "really love my nails",
    "love my nails",
    "my nails look amazing",
    "did a great job",
    "was great",
    "came out really nice",
    "turned out great",
  ];

  // also avoid starting with these 2-3 word openers
  const nailsBadStarts = [
    "love my",
    "really love",
    "my nails",
    "these nails",
  ];

  function nailsIsAcceptable(text) {
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

    // if noName ever used for nails, respect it
    if (noName) {
      if (low.includes(empLow)) return false;
    } else {
      if (!low.includes(empLow)) return false;
    }

    if (!(low.includes("nail") || low.includes("nails"))) return false;
    if (containsAny(t, nailsBannedPhrases)) return false;

    for (const s of nailsBadStarts) {
      if (low.startsWith(s)) return false;
    }

    const wc = wordCount(t);
    if (wc < 7) return false;
    if (wc > 16) return false;

    return /[.!?]$/.test(t);
  }

  function buildPromptNailsBatch() {
    return `
Write 12 VERY DIFFERENT one-sentence Google review drafts for getting nails done.

Hard rules:
- Each line is ONE complete sentence only.
- Each sentence must include "nail" or "nails".
- Keep each sentence 7 to 16 words.
- Do NOT mention the business name.
- Do NOT use these phrases: love my nails, really love my nails, my nails look amazing, did a great job, was great, turned out great.
- Avoid starting sentences with: "My nails", "Love my", "Really love", "These nails".
- Avoid "thanks", "thank you", and the word "experience".
- Avoid "chatting".
- Avoid overly salesy words like amazing, fantastic, incredible, top notch.
- Do NOT use semicolons, colons, or any dashes.
${noName ? "- Do NOT include any employee name.\n" : `- Mention "${employee}" exactly once in each sentence.\n- Do NOT start or end with "${employee}".\n`}

Optional notes (tone only):
${notes || "(none)"}

Return ONLY the 12 sentences, each on a new line.
    `.trim();
  }

  function scoreNailsCandidate(t) {
    const low = normalize(t);
    let score = 0;

    const cliche = ["amazing", "fantastic", "incredible", "best", "highly recommend", "top notch"];
    for (const p of cliche) if (low.includes(p)) score += 3;

    // prefer shorter
    const wc = wordCount(t);
    score += Math.max(0, wc - 12) * 0.7;

    // punish anything that resembles the old template cluster
    const templatey = ["love my nails", "my nails look", "did a great", "was great"];
    for (const p of templatey) if (low.includes(p)) score += 8;

    return score;
  }

  // MASSAGE (speed mode batch)
  const massageBannedPhrases = [
    "session",
    "experience",
    "deep tissue",
    "sports massage",
    "hot stone",
    "prenatal",
    "trigger points",
    "injury",
    "pain is gone",

    // cliché cluster
    "rejuvenated",
    "melt away",
    "melted away",
    "left me feeling",
    "can't wait to return",
    "can’t wait to return",
    "return for another",
    "exactly what i needed",
    "incredibly relaxing",
    "completely relaxed",
    "fantastic",
    "amazing",
    "excellent massage",
    "completely renewed",
    "renewed and lighter",
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

    if (noName) {
      if (low.includes(empLow)) return false;
    } else {
      if (!low.includes(empLow)) return false;
    }

    if (!low.includes("massage")) return false;
    if (containsAny(t, massageBannedPhrases)) return false;

    const wc = wordCount(t);
    if (wc < 7) return false;
    if (wc > 16) return false;

    if (!/[.!?]$/.test(t)) return false;
    if (low.startsWith("the massage was")) return false;

    return true;
  }

  function buildPromptMassageBatch() {
    return `
Write 12 VERY DIFFERENT one-sentence Google review drafts for a massage.

Hard rules:
- Each line is ONE complete sentence only.
- Include the word "massage" in every sentence.
- Keep each sentence 7 to 16 words.
- Do NOT start with "The massage was".
- Avoid cliché phrases like rejuvenated, melt away stress, exactly what I needed, can't wait to return.
- Do NOT use the words "session" or "experience".
- Do NOT invent medical claims.
- Do NOT use semicolons, colons, or any dashes.
${noName ? "- Do NOT include any employee name.\n" : `- Mention "${employee}" exactly once in each sentence.\n- Do NOT start or end with "${employee}".\n`}

Optional notes (tone only):
${notes || "(none)"}

Return ONLY the 12 sentences, each on a new line.
    `.trim();
  }

  function scoreMassageCandidate(t) {
    const low = normalize(t);
    let score = 0;

    const cliche = ["amazing", "fantastic", "incredible", "excellent", "rejuvenated", "renewed", "melt away", "stress"];
    for (const p of cliche) if (low.includes(p)) score += 3;

    const wc = wordCount(t);
    score += Math.max(0, wc - 12) * 0.7;

    return score;
  }

  // ✅ NEW: INSURANCE (speed mode batch)
  const insuranceBannedPhrases = [
    // keep it real / not salesy / not risky
    "saved me",
    "saved us",
    "lowest rate",
    "best rate",
    "cheapest",
    "guaranteed",
    "promise",
    "approved instantly",
    "cut my bill",
    "dropped my rate",
    "claim was denied",
    "lawsuit",

    // repetitive fluff
    "experience",
    "process",
    "super easy",
    "very easy",
    "made it easy",
    "smooth",

    // avoid sounding like ads
    "highly recommend",
    "top notch",
    "amazing",
    "fantastic",
    "incredible",
  ];

  function insuranceIsAcceptable(text) {
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

    if (noName) {
      if (low.includes(empLow)) return false;
    } else {
      // if noName is false, we allow name OR not-name for insurance,
      // but we will TRY to include it via prompt.
      // (This prevents hard failures if it doesn't include the name.)
    }

    // must feel insurance-ish but not force "insurance" word every time
    const hasInsuranceHint =
      low.includes("insurance") ||
      low.includes("policy") ||
      low.includes("coverage") ||
      low.includes("agent") ||
      low.includes("office");

    if (!hasInsuranceHint) return false;

    if (containsAny(t, insuranceBannedPhrases)) return false;

    const wc = wordCount(t);
    if (wc < 7) return false;
    if (wc > 16) return false;

    return /[.!?]$/.test(t);
  }

  function buildPromptInsuranceBatch() {
    return `
Write 12 VERY DIFFERENT one-sentence Google review drafts for an insurance office.

Hard rules:
- Each line is ONE complete sentence only.
- Keep each sentence 7 to 16 words.
- Do NOT mention the business name.
- Do NOT invent specific savings, prices, rates, or claim outcomes.
- Avoid "experience", "process", "super easy", "made it easy", and "smooth".
- Avoid overly salesy words like amazing, fantastic, incredible, top notch.
- Include at least ONE of these words in each sentence: insurance, policy, coverage, agent, office.
- Do NOT use semicolons, colons, or any dashes.
${noName ? "- Do NOT include any employee name.\n" : `- If natural, mention "${employee}" once (not at the start or end).\n`}

Optional notes (tone only):
${notes || "(none)"}

Return ONLY the 12 sentences, each on a new line.
    `.trim();
  }

  function scoreInsuranceCandidate(t) {
    const low = normalize(t);
    let score = 0;

    const cliche = ["highly recommend", "top notch", "amazing", "fantastic", "incredible"];
    for (const p of cliche) if (low.includes(p)) score += 3;

    const wc = wordCount(t);
    score += Math.max(0, wc - 12) * 0.7;

    return score;
  }

  // DETAILING
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
          presence_penalty: 0.85,
          frequency_penalty: 0.6,
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

  function processBatchLines(batchText) {
    const lines = String(batchText || "")
      .split("\n")
      .map((x) => sanitize(x))
      .map((x) => fixBadNameContext(x))
      .map((x) => trimToSentences(x, 1))
      .map((x) => ensureEndsWithPunctuation(x))
      .map((x) => trimToMaxWords(x, maxWordsForType()))
      .filter(Boolean);

    // remove empty + obvious bullet prefixes
    return lines
      .map((x) => x.replace(/^\d+[\)\.\-]\s*/, "").trim())
      .filter(Boolean);
  }

  try {
    let review = "";
    const isSolar = type === "solar";
    const isNails = type === "nails";
    const isMassage = type === "massage";
    const isInsurance = type === "insurance";

    // ✅ INSURANCE: ONE AI CALL, then filter/pick
    if (isInsurance) {
      const prompt = buildPromptInsuranceBatch();
      const batch = await generate(prompt, 1.18, 240);

      const lines = processBatchLines(batch);

      const accepted = [];
      const SIM_THRESHOLD = 0.34;

      for (const r of lines) {
        if (!insuranceIsAcceptable(r)) continue;
        if (isNearDuplicate(r, accepted, SIM_THRESHOLD)) continue;
        accepted.push(r);
      }

      if (accepted.length > 0) {
        const scored = accepted
          .map((t) => ({ t, s: scoreInsuranceCandidate(t) }))
          .sort((a, b) => a.s - b.s)
          .map((x) => x.t);

        const chosen = pickFromTop(scored, 3) || scored[0];
        return res.status(200).json({ review: chosen });
      }

      // fallback
      review = noName
        ? `Very helpful insurance office, quick and professional.`
        : `Very helpful insurance office, ${employee} was quick and professional.`;
      review = sanitize(review);
      review = trimToSentences(review, 1);
      review = ensureEndsWithPunctuation(review);
      review = trimToMaxWords(review, maxWordsForType());
      return res.status(200).json({ review });
    }

    // ✅ MASSAGE: ONE AI CALL, then filter/pick
    if (isMassage) {
      const prompt = buildPromptMassageBatch();
      const batch = await generate(prompt, 1.2, 240);

      const lines = processBatchLines(batch);

      const accepted = [];
      const SIM_THRESHOLD = 0.34;

      for (const r of lines) {
        if (!massageIsAcceptable(r)) continue;
        if (isNearDuplicate(r, accepted, SIM_THRESHOLD)) continue;
        accepted.push(r);
      }

      if (accepted.length > 0) {
        const scored = accepted
          .map((t) => ({ t, s: scoreMassageCandidate(t) }))
          .sort((a, b) => a.s - b.s)
          .map((x) => x.t);

        const chosen = pickFromTop(scored, 3) || scored[0];
        return res.status(200).json({ review: chosen });
      }

      // fallback
      review = noName
        ? `Great massage today, I feel better after.`
        : `Great massage with ${employee}, I feel better after.`;
      review = sanitize(review);
      review = trimToSentences(review, 1);
      review = ensureEndsWithPunctuation(review);
      review = trimToMaxWords(review, maxWordsForType());
      return res.status(200).json({ review });
    }

    // ✅ NAILS: ONE AI CALL, then filter/pick
    if (isNails) {
      const prompt = buildPromptNailsBatch();
      const batch = await generate(prompt, 1.2, 240);

      const lines = processBatchLines(batch);

      const accepted = [];
      const SIM_THRESHOLD = 0.34;

      for (const r of lines) {
        if (!nailsIsAcceptable(r)) continue;
        if (isNearDuplicate(r, accepted, SIM_THRESHOLD)) continue;
        accepted.push(r);
      }

      if (accepted.length > 0) {
        const scored = accepted
          .map((t) => ({ t, s: scoreNailsCandidate(t) }))
          .sort((a, b) => a.s - b.s)
          .map((x) => x.t);

        const chosen = pickFromTop(scored, 3) || scored[0];
        return res.status(200).json({ review: chosen });
      }

      // fallback (also less template-y)
      const nailsFallback = noName
        ? [
            `These nails came out clean and I am really happy.`,
            `Super happy with how my nails look.`,
            `My nails came out exactly how I wanted.`,
            `Love how neat my nails turned out.`,
          ]
        : [
            `These nails came out clean and ${employee} was so careful.`,
            `Super happy with my nails, ${employee} was very detail oriented.`,
            `My nails came out exactly how I wanted, ${employee} nailed it.`,
            `Love how neat my nails turned out, ${employee} was great.`,
          ];

      review = sanitize(pick(nailsFallback));
      review = trimToSentences(review, 1);
      review = ensureEndsWithPunctuation(review);
      review = trimToMaxWords(review, maxWordsForType());
      return res.status(200).json({ review });
    }

    // SOLAR: retry approach
    if (isSolar) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const prompt = buildPromptSolar();
        review = await generate(prompt, 1.22, 70);

        review = sanitize(review);
        review = fixBadNameContext(review);
        review = trimToSentences(review, 1);
        review = ensureEndsWithPunctuation(review);
        review = trimToMaxWords(review, maxWordsForType());

        if (solarIsAcceptable(review)) break;
      }

      if (!solarIsAcceptable(review)) {
        const solarFallback = [
          `Solid overall and ${employee} was helpful with solar.`,
          `Glad I talked with ${employee} about solar.`,
          `Good visit and ${employee} was helpful with solar.`,
          `Really appreciate ${employee} being respectful about solar.`,
        ];
        review = sanitize(pick(solarFallback));
        review = trimToSentences(review, 1);
        review = ensureEndsWithPunctuation(review);
        review = trimToMaxWords(review, maxWordsForType());
      }

      return res.status(200).json({ review });
    }

    // DETAILING: retry approach
    for (let attempt = 0; attempt < 4; attempt++) {
      const prompt = buildPromptDetailing();
      review = await generate(prompt, 1.05, 90);

      review = sanitize(review);
      review = fixBadNameContext(review);
      review = trimToSentences(review, sentenceTarget);
      review = ensureEndsWithPunctuation(review);
      review = trimToMaxWords(review, maxWordsForType());

      if (detailingIsAcceptable(review)) break;
    }

    if (!detailingIsAcceptable(review)) {
      review =
        sentenceTarget === 2
          ? `My car looks great after the detail. ${employee} did a solid job.`
          : `My car looks great after the detail, ${employee} did a solid job.`;

      review = sanitize(review);
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