module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.json({ error: "Method not allowed" });
  }

  const { employee, businessType, serviceNotes } = req.body || {};

  // ✅ no-name mode (supports true/"true"/1/"1")
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

  // Existing added types
  if (type === "nail" || type === "nails" || type === "nail_salon" || type === "nail-salon") {
    type = "nails";
  }
  if (type === "massage" || type === "massages" || type === "massage_therapy" || type === "massage-therapy") {
    type = "massage";
  }

  // ✅ NEW: Skin / Laser Hair Removal / Med Spa
  if (
    type === "skin" ||
    type === "skincare" ||
    type === "aesthetics" ||
    type === "medspa" ||
    type === "med_spa" ||
    type === "medical_spa" ||
    type === "medical-spa" ||
    type === "laser" ||
    type === "laser_hair_removal" ||
    type === "laser-hair-removal" ||
    type === "hair_removal" ||
    type === "hair-removal" ||
    type === "skin_laser" ||
    type === "skin-laser"
  ) {
    type = "skin";
  }

  // ✅ NEW: Insurance
  if (
    type === "insurance" ||
    type === "ins" ||
    type === "agent" ||
    type === "insurance_agent" ||
    type === "insurance-agent"
  ) {
    type = "insurance";
  }

  // Default stays detailing (important for Will pages that don’t send a type)
  if (!type) type = "auto_detailing";

  const notes = String(serviceNotes || "").trim();

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Sentence targets
  // Solar: ALWAYS 1
  // Nails: ALWAYS 1
  // Massage: ALWAYS 1
  // Skin: ALWAYS 1
  // Insurance: ALWAYS 1
  // Detailing: mostly 1, sometimes 2
  const sentenceTarget =
    type === "solar"
      ? 1
      : type === "nails"
      ? 1
      : type === "massage"
      ? 1
      : type === "skin"
      ? 1
      : type === "insurance"
      ? 1
      : Math.random() < 0.25
      ? 2
      : 1;

  // Remove forbidden punctuation + normalize whitespace
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

  function trimToMaxWords(text, maxWords) {
    const t = String(text || "").trim();
    if (!t) return t;

    const words = t.split(/\s+/).filter(Boolean);
    if (words.length <= maxWords) return t;

    let out = words.slice(0, maxWords).join(" ");
    if (!/[.!?]$/.test(out)) out += ".";
    return out;
  }

  function maxWordsForType() {
    if (type === "solar") return 16;
    if (type === "nails") return 14;
    if (type === "massage") return noName ? 15 : 14;
    if (type === "skin") return 16;
    if (type === "insurance") return 14;

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

  // ✅ Blocks “in Cambria” / “in Nicole” etc (common failure mode)
  function containsInName(text) {
    const name = String(employee || "").trim();
    if (!name) return false;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\bin\\s+${escaped}\\b`, "i");
    return re.test(String(text || ""));
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
    if (containsInName(t)) return false;

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
- Keep it general like a template so the customer can edit.
- Keep it short.
- Do NOT use any of these phrases: ${solarBannedPhrases.join(", ")}.
- Do NOT use semicolons, colons, or any dashes.

Optional notes (tone only, no specific claims):
${notes || "(none)"}

Return ONLY the review text.
    `.trim();
  }

  // ------------------------
  // NAILS
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
    if (containsInName(t)) return false;

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
- Include "nail" or "nails" at least once.
- Keep it general like a template so the customer can edit.
- Keep it short.
- Do NOT use the word "experience".
- Do NOT include "thanks to" or "thank you".
- Do NOT use semicolons, colons, or any dashes.
- Do NOT write "in ${employee}".

Optional notes (tone only):
${notes || "(none)"}

Return ONLY the review text.
    `.trim();
  }

  // ------------------------
  // MASSAGE
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

    if (startsWithStory(t)) return false;
    if (containsInName(t)) return false;

    const low = t.toLowerCase();
    const empLow = String(employee).toLowerCase();

    if (noName) {
      if (low.includes(empLow)) return false; // reject if it mentions name
    } else {
      if (!low.includes(empLow)) return false;
      if (startsWithName(t)) return false;
      if (endsWithName(t)) return false;
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
${noName ? "- Do NOT mention any employee name." : `- Mention "${employee}" exactly once.\n- Do NOT start with "${employee}".\n- Do NOT end with "${employee}".\n- Do NOT write "in ${employee}".`}

Optional notes (tone only):
${notes || "(none)"}

Return ONLY the review text.
    `.trim();
  }

  // ------------------------
  // SKIN / LASER (NEW)
  // ------------------------
  const skinBannedPhrases = [
    "life changing",
    "miracle",
    "cured",
    "guaranteed",
    "results are guaranteed",
    "best ever",
    "pain free",
    "no pain",
    "no downtime",
    "medical advice",
    "diagnosis",
    "diagnose",
  ];

  function skinIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;

    if (startsWithName(t)) return false;
    if (endsWithName(t)) return false;
    if (startsWithStory(t)) return false;
    if (containsInName(t)) return false;

    const low = t.toLowerCase();
    const empLow = String(employee).toLowerCase();

    if (noName) {
      if (low.includes(empLow)) return false;
    } else {
      if (!low.includes(empLow)) return false;
    }

    if (!(low.includes("skin") || low.includes("laser"))) return false;
    if (containsAny(t, skinBannedPhrases)) return false;

    if (countSentences(t) > 1) return false;

    const wc = wordCount(t);
    if (wc < 7) return false;

    return true;
  }

  function buildPromptSkin() {
    const patterns = [
      `Write ONE short sentence that sounds like a real review starter and is easy to edit.`,
      `Write ONE simple sentence that feels human and casual, not salesy.`,
      `Write ONE short sentence someone would actually type and could tweak.`,
      `Write ONE short and normal template line that leaves room for edits.`,
    ];

    return `
Write a Google review draft.

Hard rules:
- Exactly ONE sentence.
- Do NOT start with "${employee}".
- Do NOT end with "${employee}".
- Do NOT start with a story opener.
- Do NOT mention the business name.
- Keep it general like a template (no medical claims or guarantees).
- Include either the word "skin" or "laser" at least once.
- Keep it short.
- Do NOT use semicolons, colons, or any dashes.
- Avoid hype words like: ${skinBannedPhrases.join(", ")}.
${noName ? "- Do NOT mention any employee name." : `- Mention "${employee}" exactly once.\n- Do NOT write "in ${employee}".`}

Optional notes (tone only):
${notes || "(none)"}

Instruction:
${pick(patterns)}

Return ONLY the review text.
    `.trim();
  }

  // ------------------------
  // INSURANCE (NEW + IMPROVED)
  // ------------------------
  // The goal here: avoid “corporate template” language.
  const insuranceBannedPhrases = [
    // corporate-ish repeats you showed
    "smooth and straightforward",
    "refreshingly straightforward",
    "easy to understand",
    "navigating",
    "navigate",
    "the process",
    "process",
    "hasslefree",
    "hassle free",
    "stressfree",
    "stress free",
    "no pressure",
    "walked me through",
    "broke it down",
    "answered all my questions",
    "options",
    "made everything easy",
  ];

  function insuranceIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;

    if (startsWithStory(t)) return false;
    if (containsInName(t)) return false;

    const low = t.toLowerCase();
    const empLow = String(employee).toLowerCase();

    if (noName) {
      if (low.includes(empLow)) return false;
    } else {
      if (!low.includes(empLow)) return false;
      if (startsWithName(t)) return false;
      if (endsWithName(t)) return false;
    }

    // must include “insurance” so it stays relevant
    if (!low.includes("insurance")) return false;

    // keep it 1 sentence + short
    if (countSentences(t) > 1) return false;

    const wc = wordCount(t);
    if (wc < 6) return false;

    if (containsAny(t, insuranceBannedPhrases)) return false;

    return true;
  }

  function buildPromptInsurance() {
    const patterns = [
      `Write ONE short casual sentence like a real person typing on their phone.`,
      `Write ONE quick, low key sentence that feels human, not corporate.`,
      `Write ONE short sentence that someone would actually post without thinking much.`,
      `Write ONE short line that sounds real and slightly imperfect is okay.`,
    ];

    return `
Write a Google review draft.

Hard rules:
- Exactly ONE sentence.
- Include the word "insurance" at least once.
- Do NOT mention the business name.
- Keep it short and casual (sound like a real person).
- Avoid corporate phrasing and avoid these phrases: ${insuranceBannedPhrases.join(", ")}.
- Avoid “professional/office” tone.
- Do NOT mention pricing, rates, savings, or guarantees.
- Do NOT use semicolons, colons, or any dashes.
${noName ? "- Do NOT mention any employee name." : `- Mention "${employee}" exactly once.\n- Do NOT start with "${employee}".\n- Do NOT end with "${employee}".\n- Do NOT write "in ${employee}".`}

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
                "Write short, human sounding Google reviews. Keep them casual and believable. Avoid repeating the same phrasing. Avoid corporate tone.",
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
    const isSkin = type === "skin";
    const isInsurance = type === "insurance";

    for (let attempt = 0; attempt < 4; attempt++) {
      const prompt = isSolar
        ? buildPromptSolar()
        : isNails
        ? buildPromptNails()
        : isMassage
        ? buildPromptMassage()
        : isSkin
        ? buildPromptSkin()
        : isInsurance
        ? buildPromptInsurance()
        : buildPromptDetailing();

      review = await generate(
        prompt,
        isSolar ? 1.25 : isNails ? 1.15 : isMassage ? 1.15 : isSkin ? 1.1 : isInsurance ? 1.2 : 1.05,
        // slightly lower tokens = slightly shorter (insurance kept short)
        isSolar ? 65 : isNails ? 65 : isMassage ? 65 : isSkin ? 70 : isInsurance ? 55 : 85
      );

      review = sanitize(review);
      review = trimToSentences(review, sentenceTarget);
      review = trimToMaxWords(review, maxWordsForType());

      if (isSolar) {
        if (solarIsAcceptable(review)) break;
      } else if (isNails) {
        if (nailsIsAcceptable(review)) break;
      } else if (isMassage) {
        if (massageIsAcceptable(review)) break;
      } else if (isSkin) {
        if (skinIsAcceptable(review)) break;
      } else if (isInsurance) {
        if (insuranceIsAcceptable(review)) break;
      } else {
        if (detailingIsAcceptable(review)) break;
      }
    }

    review = sanitize(review);
    review = trimToSentences(review, sentenceTarget);
    review = trimToMaxWords(review, maxWordsForType());

    // Solar fallback
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
      review = trimToSentences(review, 1);
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
      review = trimToSentences(review, 1);
      review = trimToMaxWords(review, maxWordsForType());
    }

    // Massage fallback (supports no-name)
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
      review = trimToSentences(review, 1);
      review = trimToMaxWords(review, maxWordsForType());
    }

    // Skin fallback (supports no-name)
    if (isSkin && !skinIsAcceptable(review)) {
      const skinFallbackNamed = [
        `Really happy with my skin laser visit, ${employee} was great.`,
        `Great skin laser service, ${employee} was very professional.`,
        `Loved the skin laser visit, ${employee} made it easy.`,
        `Happy overall with skin laser, ${employee} was kind and patient.`,
      ];

      const skinFallbackNoName = [
        `Really happy with my skin laser visit today.`,
        `Great skin laser service and I would come back.`,
        `Loved the skin laser visit and it felt easy.`,
        `Happy overall with my skin laser visit.`,
      ];

      review = sanitize(pick(noName ? skinFallbackNoName : skinFallbackNamed));
      review = trimToSentences(review, 1);
      review = trimToMaxWords(review, maxWordsForType());
    }

    // ✅ Insurance fallback (IMPROVED, more human)
    if (isInsurance && !insuranceIsAcceptable(review)) {
      const insuranceFallbackNamed = [
        `Really glad I talked with ${employee} about insurance.`,
        `Insurance stuff felt easier after talking with ${employee}.`,
        `Happy I got my insurance handled with ${employee}.`,
        `Good insurance help and ${employee} kept it simple.`,
        `Glad I reached out for insurance, ${employee} was easy to work with.`,
      ];

      const insuranceFallbackNoName = [
        `Glad I finally got my insurance handled today.`,
        `Insurance stuff felt easier than I expected.`,
        `Happy I got my insurance figured out.`,
        `Quick help with insurance and it felt simple.`,
        `Insurance was way less stressful than I thought.`,
      ];

      review = sanitize(pick(noName ? insuranceFallbackNoName : insuranceFallbackNamed));
      review = trimToSentences(review, 1);
      review = trimToMaxWords(review, maxWordsForType());
    }

    // Detailing fallback
    if (!isSolar && !isNails && !isMassage && !isSkin && !isInsurance && !detailingIsAcceptable(review)) {
      review =
        sentenceTarget === 2
          ? `My car looks great after the detail. ${employee} did a solid job.`
          : `My car looks great after the detail, ${employee} did a solid job.`;

      review = sanitize(review);
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