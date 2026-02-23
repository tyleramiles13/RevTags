module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.json({ error: "Method not allowed" });
  }

  const body = req.body || {};

  // ✅ accept multiple field names (prevents missing businessType -> detailing default)
  const employee = body.employee;
  const serviceNotes = body.serviceNotes;

  const businessTypeRaw =
    body.businessType ??
    body.business_type ??
    body.business_type ??
    body.type ??
    "";

  // optional business name (helps inference)
  const businessRaw = body.business ?? body.businessName ?? body.business_name ?? "";

  const noName =
    body?.noName === true ||
    body?.noName === "true" ||
    body?.noName === 1 ||
    body?.noName === "1";

  if (!employee) {
    res.statusCode = 400;
    return res.json({ error: "Missing employee" });
  }

  const apiKey = process.env.OPENAI_API_KEY_REAL;
  if (!apiKey) {
    res.statusCode = 500;
    return res.json({ error: "Missing OPENAI_API_KEY_REAL" });
  }

  // -------- BUSINESS TYPE --------
  let type = String(businessTypeRaw || "").toLowerCase().trim();
  const businessLower = String(businessRaw || "").toLowerCase().trim();

  // detailing aliases
  if (type === "auto-detailing") type = "auto_detailing";
  if (type === "detail" || type === "detailing") type = "auto_detailing";

  // nails aliases
  if (["nail", "nails", "nail_salon", "nail-salon"].includes(type)) type = "nails";

  // massage aliases
  if (["massage", "massages", "massage_therapy", "massage-therapy"].includes(type)) type = "massage";

  // skin/laser aliases
  if (
    [
      "skin",
      "skincare",
      "aesthetics",
      "medspa",
      "med_spa",
      "medical_spa",
      "medical-spa",
      "laser",
      "laser_hair_removal",
      "laser-hair-removal",
      "skin_laser",
      "skin-laser",
      "hair_removal",
      "hair-removal",
    ].includes(type)
  ) {
    type = "skin";
  }

  // insurance aliases
  if (["insurance", "ins", "agent", "insurance_agent", "insurance-agent"].includes(type)) type = "insurance";

  // ✅ if STILL missing, infer from business name (prevents Allstate -> detailing)
  if (!type) {
    if (businessLower.includes("allstate") || businessLower.includes("insurance")) {
      type = "insurance";
    } else if (
      businessLower.includes("massage") ||
      businessLower.includes("therapy") ||
      businessLower.includes("bodywork")
    ) {
      type = "massage";
    } else if (
      businessLower.includes("nail") ||
      businessLower.includes("lashes") ||
      businessLower.includes("salon")
    ) {
      type = "nails";
    } else if (
      businessLower.includes("laser") ||
      businessLower.includes("med spa") ||
      businessLower.includes("medspa") ||
      businessLower.includes("aesthetic") ||
      businessLower.includes("skin")
    ) {
      type = "skin";
    } else {
      // default stays detailing (safe)
      type = "auto_detailing";
    }
  }

  const notes = String(serviceNotes || "").trim();

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // sentence targets
  const sentenceTarget =
    ["solar", "nails", "massage", "skin", "insurance"].includes(type)
      ? 1
      : Math.random() < 0.25
      ? 2
      : 1;

  // ------------- helpers -------------
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

  // ✅ NEW helper (used ONLY for massage name-repeat protection)
  function countNameOccurrences(text, name) {
    const t = String(text || "").toLowerCase();
    const n = String(name || "").toLowerCase().trim();
    if (!t || !n) return 0;
    const matches = t.match(new RegExp(`\\b${n}\\b`, "g"));
    return matches ? matches.length : 0;
  }

  // ------------------------
  // SOLAR
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

Optional notes (tone only):
${notes || "(none)"}

Instruction:
${pick(patterns)}

Return ONLY the review text.
    `.trim();
  }

  // ------------------------
  // MASSAGE (your existing improved version)
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
    "really happy i booked",
  ];

  function massageIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;

    if (startsWithStory(t)) return false;

    const low = t.toLowerCase();
    const empLow = String(employee).toLowerCase();

    if (noName) {
      if (low.includes(empLow)) return false;
    } else {
      if (!low.includes(empLow)) return false;
      if (countNameOccurrences(t, employee) !== 1) return false;
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
      `Write ONE short review line that feels human (not templated).`,
      `Write ONE simple positive sentence that is not overly specific.`,
      `Write ONE short sentence with a slightly different structure than usual.`,
    ];

    const massageNameRule = noName
      ? "- Do NOT mention any employee name."
      : Math.random() < 0.35
      ? `- Mention "${employee}" exactly once.\n- You MAY start with "${employee}" if it sounds natural.\n- It's OK if it ends with "${employee}".`
      : `- Mention "${employee}" exactly once.\n- Do NOT start with "${employee}".\n- Put the name naturally later in the sentence.\n- It's OK if it ends with "${employee}".`;

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
- Avoid starting with “Really happy I booked…”.
${massageNameRule}

Optional notes (tone only):
${notes || "(none)"}

Instruction:
${pick(patterns)}

Return ONLY the review text.
    `.trim();
  }

  // ------------------------
  // SKIN / LASER
  // ------------------------
  const skinBannedPhrases = [
    "life changing",
    "miracle",
    "guaranteed",
    "cured",
    "results are guaranteed",
    "pain free",
    "no pain",
    "no downtime",
  ];

  function skinIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;

    if (startsWithName(t)) return false;
    if (endsWithName(t)) return false;
    if (startsWithStory(t)) return false;

    const low = t.toLowerCase();
    if (!low.includes(String(employee).toLowerCase())) return false;
    if (!(low.includes("skin") || low.includes("laser"))) return false;

    if (containsAny(t, skinBannedPhrases)) return false;
    if (countSentences(t) > 1) return false;

    const wc = wordCount(t);
    if (wc < 7) return false;

    return true;
  }

  function buildPromptSkin() {
    return `
Write a Google review draft.

Hard rules:
- Exactly ONE sentence.
- Do NOT start with "${employee}".
- Do NOT end with "${employee}".
- Do NOT start with a story opener.
- Do NOT mention the business name.
- Mention "${employee}" exactly once.
- Include either the word "skin" or "laser" (at least one).
- Keep it general like a template, no medical claims or guarantees.
- Keep it short.
- Do NOT use semicolons, colons, or any dashes.
- Avoid hype words like: ${skinBannedPhrases.join(", ")}.

Optional notes (tone only):
${notes || "(none)"}

Return ONLY the review text.
    `.trim();
  }

  // ------------------------
  // INSURANCE (your improved version)
  // ------------------------
  const insuranceBannedPhrases = [
    "smooth and straightforward",
    "refreshingly straightforward",
    "easy to understand",
    "navigating the process",
    "insurance experience",
    "process was smooth",
    "stressfree",
    "hasslefree",
    "no pressure",
    "walked me through",
    "broke everything down",
    "explained everything",

    "sorted",
    "sorted out",
    "sorted here",
    "squared away",
    "squared",
    "headache",
    "hassle",
    "without a fuss",
    "a fuss",
    "breeze",
    "super chill",
    "chill vibe",
    "folks were",
    "way less stressful",
    "less stressful",
    "made it easy",
    "easy options",
    "my options",
    "got my insurance",
    "getting my insurance",
    "insurance process",
    "the process",
    "process",
    "decent",
    "pretty alright",
    "alright",
    "nothing super exciting",
    "kinda",
    "meh",
    "had to deal with",
  ];

  function insuranceIsAcceptable(text) {
    const t = String(text || "").trim();
    if (!t) return false;
    if (startsWithStory(t)) return false;

    const low = t.toLowerCase();
    const empLow = String(employee).toLowerCase();

    if (noName) {
      if (low.includes(empLow)) return false;
    } else {
      if (!low.includes(empLow)) return false;
      if (startsWithName(t)) return false;
      if (endsWithName(t)) return false;
    }

    if (!low.includes("insurance")) return false;
    if (containsAny(t, insuranceBannedPhrases)) return false;

    const wc = wordCount(t);
    if (wc < 6) return false;

    return true;
  }

  function buildPromptInsurance() {
    const patterns = [
      "Write ONE short sentence that sounds like a real person leaving a quick Google review.",
      "Write ONE simple positive sentence that feels normal and not salesy.",
      "Write ONE short sentence that sounds satisfied and confident (not slang).",
      "Write ONE short insurance review that feels human and clean.",
    ];

    return `
Write a Google review draft.

Hard rules:
- Exactly ONE sentence.
- Keep it SHORT and natural.
- Tone must be positive, satisfied, and normal (no slang, no negativity).
- Include the word "insurance" at least once.
- Do NOT mention the business name.
- Do NOT make savings promises or pricing claims.
- Do NOT use semicolons, colons, or any dashes.
- Avoid these vibes/phrases: hassle, headache, chill, decent, alright, process, straightforward, easy to understand, sorted, squared away.
- Avoid starting with "Got my insurance..." or "Getting my insurance...".
${noName ? "- Do NOT mention any employee name." : `- Mention "${employee}" exactly once.\n- Do NOT start with "${employee}".\n- Do NOT end with "${employee}".\n- Don’t make it sound like an ad.`}

Optional notes:
${notes || "(none)"}

Instruction:
${pick(patterns)}

Return ONLY the review text.
`.trim();
  }

  // ------------------------
  // DETAILING
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
        isSolar ? 1.25 : isNails ? 1.15 : isMassage ? 1.25 : isSkin ? 1.1 : isInsurance ? 1.1 : 1.05,
        isSolar ? 65 : isNails ? 65 : isMassage ? 70 : isSkin ? 70 : isInsurance ? 70 : 85
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

    // ----- fallbacks -----

    if (isSolar && !solarIsAcceptable(review)) {
      const solarFallback = [
        `Really appreciate ${employee} being respectful about solar.`,
        `Solid overall and ${employee} was great with solar.`,
        `Glad I talked with ${employee} about solar.`,
        `Good visit and ${employee} was helpful about solar.`,
        `Professional help from ${employee} on solar.`,
        `Positive visit and ${employee} was great on solar.`,
        `Everything felt professional and ${employee} helped with solar.`,
        `Happy overall and ${employee} was friendly about solar.`,
      ];
      review = sanitize(pick(solarFallback));
      review = trimToSentences(review, 1);
      review = trimToMaxWords(review, maxWordsForType());
    }

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

    if (isMassage && !massageIsAcceptable(review)) {
      const massageFallbackNamed = [
        `Great massage today and ${employee} was awesome.`,
        `My massage felt really relaxing and ${employee} did great.`,
        `Massage was exactly what I needed and ${employee} nailed it.`,
        `Super relaxing massage and ${employee} was really solid.`,
        `Really happy with my massage, ${employee} did a great job.`,
        `Massage felt great and ${employee} made it comfortable.`,
        `Loved the massage and ${employee} was very professional.`,
        `My massage was so good and ${employee} did amazing.`,
      ];

      const massageFallbackNoName = [
        `My massage felt really relaxing and I would come back.`,
        `Really happy I booked a massage and I feel great after.`,
        `My massage was exactly what I needed today.`,
        `Such a relaxing massage and I would recommend it.`,
        `Great massage and I feel way better now.`,
      ];

      review = sanitize(pick(noName ? massageFallbackNoName : massageFallbackNamed));
      review = trimToSentences(review, 1);
      review = trimToMaxWords(review, maxWordsForType());
    }

    if (isSkin && !skinIsAcceptable(review)) {
      const skinFallback = [
        `Really happy with my skin and laser visit, ${employee} was great.`,
        `Great skin and laser service, ${employee} was very professional.`,
        `Super smooth skin and laser visit, ${employee} was really helpful.`,
        `Happy overall with skin and laser, ${employee} was kind and patient.`,
        `Great visit for skin and laser, ${employee} made it easy.`,
      ];
      review = sanitize(pick(skinFallback));
      if (!/[.!?]$/.test(review)) review += ".";
      review = trimToSentences(review, 1);
      review = trimToMaxWords(review, maxWordsForType());
    }

    if (isInsurance && !insuranceIsAcceptable(review)) {
      const insuranceFallbackNamed = [
        `Really glad I reached out to ${employee} for insurance help.`,
        `Insurance help was great and ${employee} was easy to work with.`,
        `Happy with my insurance and ${employee} was very helpful.`,
        `Great insurance support and ${employee} made it simple.`,
        `Really appreciate ${employee} helping me with insurance.`,
      ];

      const insuranceFallbackNoName = [
        `Really happy with the help I got for insurance.`,
        `Great insurance help and everything went smoothly.`,
        `Happy I got my insurance taken care of here.`,
        `Good insurance help and I feel set up now.`,
      ];

      review = sanitize(pick(noName ? insuranceFallbackNoName : insuranceFallbackNamed));
      if (!/[.!?]$/.test(review)) review += ".";
      review = trimToSentences(review, 1);
      review = trimToMaxWords(review, maxWordsForType());
    }

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