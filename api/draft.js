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

  const type = String(businessType || "business").trim();
  const notes = String(serviceNotes || "").trim();

  // 1 sentence most of the time, sometimes 2. Never more than 2.
  const sentenceTarget = Math.random() < 0.82 ? 1 : 2;

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  // ---- Text helpers ----
  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[\u2019]/g, "'")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function wordCount(text) {
    return normalize(text).split(" ").filter(Boolean).length;
  }

  function splitSentences(text) {
    const raw = String(text || "").trim();
    if (!raw) return [];
    // Split on sentence-ending punctuation while keeping it
    const parts = raw.split(/([.!?])/).filter(Boolean);
    const out = [];
    for (let i = 0; i < parts.length; i += 2) {
      const s = (parts[i] || "").trim();
      const p = (parts[i + 1] || "").trim();
      if (!s) continue;
      out.push((s + (p || ".")).trim());
    }
    return out;
  }

  function clampToMaxSentences(text, maxSentences) {
    const sents = splitSentences(text);
    if (sents.length <= maxSentences) return String(text || "").trim();
    return sents.slice(0, maxSentences).join(" ").trim();
  }

  function ensurePunctuationEnd(text) {
    let t = String(text || "").trim();
    if (!t) return t;
    if (!/[.!?]$/.test(t)) t += ".";
    return t;
  }

  function ensureEmployeeName(text, employeeName) {
    const t = String(text || "").trim();
    const low = t.toLowerCase();
    const empLow = String(employeeName || "").toLowerCase().trim();
    if (!empLow) return t;

    if (low.includes(empLow)) return t;

    // Add it gently if missing
    let out = ensurePunctuationEnd(t);
    out += ` ${employeeName}.`;
    return out.trim();
  }

  // ---- Similarity scoring (to pick the most distinct candidate) ----
  function trigrams(text) {
    const words = normalize(text).split(" ").filter(Boolean);
    if (words.length < 3) return new Set(words); // fallback
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
    const A = trigrams(a);
    const B = trigrams(b);
    return jaccard(A, B);
  }

  // A small “overused phrase” list to help choose more unique drafts.
  // (Not a hard rule; only used in scoring.)
  const clichePhrases = [
    "highly recommend",
    "great service",
    "amazing service",
    "great experience",
    "very professional",
    "went above and beyond",
    "10/10",
    "five stars",
    "look no further",
    "best in town",
    "top notch",
  ];

  function clichePenalty(text) {
    const low = String(text || "").toLowerCase();
    let hits = 0;
    for (const p of clichePhrases) {
      if (low.includes(p)) hits += 1;
    }
    return hits; // higher = worse
  }

  function lengthPenalty(text, targetSentences) {
    const wc = wordCount(text);
    // Aim short. 1 sentence: ~8–20 words. 2 sentences: ~14–32 words.
    if (targetSentences === 1) {
      if (wc < 5) return 2;
      if (wc <= 22) return 0;
      if (wc <= 28) return 1;
      return 3;
    } else {
      if (wc < 10) return 2;
      if (wc <= 34) return 0;
      if (wc <= 42) return 1;
      return 3;
    }
  }

  // ---- Prompt variety: we rotate “style cards” to force different outputs ----
  const styleCards = [
    {
      name: "Short + direct",
      instructions:
        "Write like a real person leaving a quick note. Keep it simple and not salesy.",
      starterHints: [
        "Really happy with how it turned out",
        "Glad I booked",
        "Super happy with the result",
        "This was exactly what I needed",
        "So glad I chose this",
      ],
    },
    {
      name: "Warm + grateful",
      instructions:
        "Write warm and appreciative, but avoid sounding like marketing. Keep it natural.",
      starterHints: [
        "Seriously appreciate it",
        "Thanks again",
        "I’m really grateful",
        "Really appreciate the help",
      ],
    },
    {
      name: "Calm + matter-of-fact",
      instructions:
        "Write calm and practical, like someone who doesn’t overhype things.",
      starterHints: [
        "Solid work",
        "Good job",
        "Happy with the service",
        "Everything was handled well",
      ],
    },
    {
      name: "Light + conversational",
      instructions:
        "Write like someone texting a quick review. Still professional enough for Google.",
      starterHints: [
        "Not gonna lie",
        "Honestly",
        "For real",
        "Just saying",
      ],
    },
    {
      name: "Result-focused",
      instructions:
        "Focus on the result/outcome without inventing specific claims or details.",
      starterHints: [
        "The difference was noticeable",
        "It turned out great",
        "It looks so much better",
        "Huge improvement",
      ],
    },
    {
      name: "Minimalist",
      instructions:
        "Write very short and clean. No fluff. No dramatic language.",
      starterHints: [
        "Quick and easy",
        "Simple and solid",
        "Exactly as expected",
        "Really smooth",
      ],
    },
  ];

  function buildPrompt(styleCard, targetSentences) {
    const starter = pick(styleCard.starterHints);
    return `
Write a Google review draft for a ${type}.

Hard requirements:
- Include the employee name "${employee}" somewhere in the review text.
- Write ${targetSentences} sentence${targetSentences === 2 ? "s" : ""} only.
- Never write more than 2 sentences.

Style:
- ${styleCard.instructions}
- Make it feel human and not repetitive.
- Avoid sounding like an ad.
- Vary vocabulary and sentence structure.

Starter hint (optional): You can start with something like "${starter}" (or ignore it).

Optional notes from the customer (use only if they fit, do not invent details):
${notes |
