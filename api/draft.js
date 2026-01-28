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

  // --- Determine business type (safe default) ---
  let type = (businessType || "").toLowerCase().trim();
  if (type === "auto-detailing") type = "auto_detailing";
  if (type === "detail" || type === "detailing") type = "auto_detailing";

  if (!type) {
    const notesLower = (serviceNotes || "").toLowerCase();
    const solarHints = [
      "solar", "panel", "panels", "quote", "pricing", "bill", "savings",
      "financing", "install", "installation", "estimate", "kw", "utility", "roof"
    ];
    const looksSolar = solarHints.some((w) => notesLower.includes(w));
    type = looksSolar ? "solar" : "auto_detailing";
  }

  const topic = {
    auto_detailing: {
      label: "auto detailing",
      tokens: [
        "interior", "seats", "carpets", "mats", "dashboard", "console", "windows",
        "exterior", "paint", "wheels", "tires", "finish", "shine",
        "clean", "detailed", "like new", "great job", "attention to detail"
      ],
      softAvoid: ["spotless", "fresh", "magic"]
    },
    solar: {
      label: "solar consultation",
      tokens: [
        "solar", "panels", "quote", "estimate", "pricing", "bill", "utility",
        "savings", "financing", "roof", "installation", "timeline", "options",
        "questions", "next steps", "process"
      ],
      softAvoid: []
    }
  };

  const cfg = topic[type] || topic.auto_detailing;
  const notes = String(serviceNotes || "").trim();

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // Mostly 1 sentence, sometimes 2
  const wantTwoSentences = Math.random() < 0.25;
  const sentenceTarget = wantTwoSentences ? 2 : 1;

  // --- Helpers: sanitize instead of rejecting ---
  function sanitizePunctuation(text) {
    if (!text) return "";
    // Remove forbidden punctuation ; : and any dash types
    return text.replace(/[;:—–-]/g, "");
  }

  function trimToTwoSentences(text) {
    const raw = (text || "").trim();
    if (!raw) return raw;

    const parts = raw.split(/([.!?])/).filter(Boolean);
    // parts like: ["Sentence one", ".", " Sentence two", ".", " Sentence three", "."]
    let out = "";
    let count = 0;

    for (let i = 0; i < parts.length; i += 2) {
      const chunk = (parts[i] || "").trim();
      const punct = (parts[i + 1] || "").trim();
      if (!chunk) continue;

      out += (out ? " " : "") + chunk + (punct || ".");
      count += 1;

      if (count >= Math.min(2, sentenceTarget)) break;
    }

    return out.trim();
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

  function startsWithBoringStoryOpener(text) {
    const t = (text || "").trim().toLowerCase();
    if (!t) return false;
    const banned = [
      "after ", "after a ", "after an ", "after the ",
      "on my way", "when i", "when we",
      "last week", "yesterday", "this weekend"
    ];
    return banned.some((s) => t.startsWith(s));
  }

  function containsSoftAvoid(text) {
    const t = (text || "").toLowerCase();
    return (cfg.softAvoid || []).some((p) => t.includes(String(p).toLowerCase()));
  }

  function isAcceptable(text) {
    const raw = (text || "").trim();
    if (!raw) return false;

    // Keep these two rules because they really help quality
    if (startsWithEmployeeName(raw)) return false;
    if (startsWithBoringStoryOpener(raw)) return false;

    // Keep Will’s special “don’t say these” vibe
    if (containsSoftAvoid(raw)) return false;

    return true;
  }

  function buildPrompt() {
    const focusA = pick(cfg.tokens);
    const focusB = pick(cfg.tokens);

    const frames1 = [
      `Write one sentence that sounds like a real customer. Mention "${employee}" once, not at the start. Include a small ${cfg.label} detail.`,
      `Write one sentence with a simple result first, then mention "${employee}" later. Include a ${cfg.label} detail.`
    ];

    const frames2 = [
      `Write two short sentences. Mention "${employee}" in the second sentence. Include one ${cfg.label} detail total.`,
      `Write two short sentences that sound natural. Mention "${employee}" once, not at the start.`
    ];

    const frame = sentenceTarget === 1 ? pick(frames1) : pick(frames2);

    return `
Write a short Google review draft.

Rules:
- ${sentenceTarget} sentence${sentenceTarget === 2 ? "s" : ""} only.
- Do not start with "${employee}".
- Do not start with a long story opener like "After..." or "Last week...".
- Do NOT mention the business name.

Context:
- Business type: ${cfg.label}
- Employee: "${employee}"

Include:
- Mention "${employee}" once.
- Add one small relevant detail using words like "${focusA}" or "${focusB}".

Optional notes (use lightly):
${notes || "(none)"}

Return ONLY the review text.
    `.trim();
  }

  async function generateOnce() {
    const prompt = buildPrompt();

    // Add a short timeout so it never feels “stuck”
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const resp = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content:
                "Write short, human sounding Google reviews. Vary structure. No promotional tone."
            },
            { role: "user", content: prompt }
          ],
          temperature: 1.1,
          max_tokens: 90
        })
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

    // Only 3 tries. Much faster.
    for (let attempt = 0; attempt < 3; attempt++) {
      review = await generateOnce();

      // Sanitize instead of rejecting
      review = sanitizePunctuation(review);
      review = trimToTwoSentences(review);

      if (isAcceptable(review)) break;
    }

    // Final safety sanitize
    review = sanitizePunctuation(review);
    review = trimToTwoSentences(review);

    // Random fallback (fast, never repeats)
    if (!isAcceptable(review)) {
      const solarFallback = [
        `Really glad I got clear info about solar. ${employee} made the quote feel simple.`,
        `The solar info was easy to follow. ${employee} answered my questions and explained the estimate.`,
        `Good solar conversation. ${employee} explained options and pricing in a simple way.`
      ];

      const detailFallback = [
        `My car looks great after the detail. ${employee} did a solid job on the interior.`,
        `Really happy with how clean my car turned out. ${employee} did a great job.`
      ];

      review = type === "solar" ? pick(solarFallback) : pick(detailFallback);
      review = sanitizePunctuation(review);
      review = trimToTwoSentences(review);
    }

    return res.status(200).json({ review });
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    return res.json({ error: "AI generation failed" });
  }
};







