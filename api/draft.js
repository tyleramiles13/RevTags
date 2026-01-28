module.exports = async function handler(req, res) {
  // --- Only allow POST ---
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

  // -----------------------------
  //  Restarted logic (clean slate)
  // -----------------------------

  const type = String(businessType || "").trim().toLowerCase(); // optional
  const notes = String(serviceNotes || "").trim(); // optional

  // Banned punctuation: no semicolons, no dashes (hyphen/en/em)
  function hasBannedPunctuation(text) {
    return /[;—–-]/.test(text || "");
  }

  // We also don’t want “story openers” that create fake scenarios
  function startsWithStoryOpener(text) {
    const t = (text || "").trim().toLowerCase();
    if (!t) return false;

    const bannedStarts = [
      "after ",
      "after a ",
      "after an ",
      "after the ",
      "after my ",
      "after our ",
      "following ",
      "on my way",
      "on our way",
      "when i",
      "when we",
      "last week",
      "yesterday",
      "this weekend",
      "over the weekend",
      "during the trip",
      "road trip",
      "roadtrip",
      "hauling",
      "snacks",
      "sports gear",
      "kids",
      "dog",
      "pet"
    ];

    return bannedStarts.some((s) => t.startsWith(s));
  }

  function countSentences(text) {
    const parts = (text || "")
      .trim()
      .split(/[.!?]+/)
      .filter(Boolean);
    return parts.length;
  }

  function startsWithEmployeeName(text) {
    const t = (text || "").trim().toLowerCase();
    const name = String(employee || "").trim().toLowerCase();
    if (!t || !name) return false;

    return (
      t.startsWith(name + " ") ||
      t.startsWith(name + ",") ||
      t.startsWith(name + "'") ||
      t.startsWith(name + "’")
    );
  }

  // Simple validator: keep it short + clean + editable
  function isGood(text) {
    const raw = (text || "").trim();
    if (!raw) return false;

    if (countSentences(raw) > 2) return false;

    // No banned punctuation
    if (hasBannedPunctuation(raw)) return false;

    // No story openers
    if (startsWithStoryOpener(raw)) return false;

    // Don’t start with the employee name
    if (startsWithEmployeeName(raw)) return false;

    // Avoid overly-specific looking drafts (keep it editable)
    const lower = raw.toLowerCase();
    const tooSpecificWords = [
      "road trip",
      "roadtrip",
      "snacks",
      "sports gear",
      "haul",
      "hauling",
      "kids",
      "dog",
      "pet",
      "yesterday",
      "last week"
    ];
    if (tooSpecificWords.some((w) => lower.includes(w))) return false;

    return true;
  }

  // Template pool — these are intentionally generic starter drafts.
  // They vary but stay “editable”.
  function buildPrompt() {
    // Choose a “style” to encourage variety
    const openings = [
      "Quick and easy experience",
      "Really happy with how everything turned out",
      "Super smooth from start to finish",
      "Everything looks great and I’m happy with the result",
      "Great service and good communication",
      "Very satisfied with the work",
      "Solid experience overall"
    ];

    const templateIdeas = [
      // 1 sentence
      `"{OPENING}. {EMPLOYEE} did a great job and I would recommend them!"`,
      `"{OPENING}. {EMPLOYEE} was friendly and I’d recommend them to anyone."`,
      `"{OPENING}. Big thanks to {EMPLOYEE} for the help!"`,

      // 2 sentences
      `"{OPENING}. {EMPLOYEE} was professional and made things simple. I’d recommend them."`,
      `"{OPENING}. {EMPLOYEE} was easy to work with and the result turned out great. Would recommend."`,
      `"{OPENING}. {EMPLOYEE} was helpful and kept things straightforward. I’d use them again."`,

      // Another vibe
      `"Really impressed with the result. {EMPLOYEE} was great to work with and I’d recommend them."`,
      `"Everything turned out great. {EMPLOYEE} was friendly, professional, and easy to work with."`
    ];

    // Provide optional context without forcing specifics
    const typeHint = type ? `Business type: ${type}.` : `Business type: (not provided).`;
    const notesHint = notes ? `Notes: ${notes}` : `Notes: (none).`;

    // Randomly pick one opening, but instruct the model to vary structure anyway
    const opening = openings[Math.floor(Math.random() * openings.length)];

    return `
Write a short Google review starter draft the customer can quickly edit and personalize.

Hard rules:
- Max 2 sentences.
- Do NOT use semicolons.
- Do NOT use dashes of any kind (no - and no long dashes).
- Do NOT start with the employee name "${employee}".
- Do NOT start with story setups like "After..." or "Last week..." or anything that sounds like a personal scenario.
- Keep it generic and editable. Avoid specific situations.

Required:
- Mention the employee name "${employee}" somewhere.

Context (optional):
${typeHint}
${notesHint}

Pick ONE template idea and adapt it. Keep punctuation simple (periods, commas, at most one exclamation point).
Make it sound like a real person, but keep it vague.

Use this opening phrase (or something similar, but don’t start with "${employee}"):
"${opening}"

Template ideas (choose one and vary wording):
${templateIdeas.join("\n")}

Return ONLY the review text.
`.trim();
  }

  async function generateOnce() {
    const prompt = buildPrompt();

    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You write short, human-sounding Google review starter drafts. Keep them generic and editable. Do not add personal scenarios. No semicolons or dashes. Do not start with the employee name."
          },
          { role: "user", content: prompt }
        ],
        temperature: 1.1,
        max_tokens: 70
      })
    });

    const bodyText = await resp.text();
    if (!resp.ok) throw new Error(bodyText);

    const data = JSON.parse(bodyText);
    const text = (data?.choices?.[0]?.message?.content || "").trim();
    return text;
  }

  try {
    let review = "";

    // Retry a few times to satisfy strict rules
    for (let i = 0; i < 8; i++) {
      review = await generateOnce();
      if (isGood(review)) break;
    }

    // Fallback (still generic + editable)
    if (!isGood(review)) {
      review = `Really happy with the result. ${employee} did a great job and I would recommend them.`;
    }

    return res.status(200).json({ review });
  } catch (e) {
    console.error("Draft API error:", e);
    res.statusCode = 500;
    return res.json({ error: "AI generation failed" });
  }
};



