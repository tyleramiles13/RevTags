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

  async function generateReview() {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 1.2,
        top_p: 1,
        max_tokens: 180,
        messages: [
          {
            role: "system",
            content:
              "You write natural, human-sounding Google reviews. Keep it realistic and not overly salesy.",
          },
          {
            role: "user",
            content: `
Write a Google review draft for a ${type}.

Only requirement:
- Include the employee name "${employee}" somewhere in the review.

Optional notes the customer provided (use if helpful, but you don't have to):
${notes || "(none)"}

Return ONLY the review text.
            `.trim(),
          },
        ],
      }),
    });

    const text = await resp.text();
    if (!resp.ok) throw new Error(text);

    const data = JSON.parse(text);
    return (data?.choices?.[0]?.message?.content || "").trim();
  }

  try {
    let review = await generateReview();

    // ✅ The ONLY enforced rule: make sure employee name is included.
    const low = review.toLowerCase();
    const empLow = String(employee).toLowerCase();

    if (!low.includes(empLow)) {
      // Add name in the least intrusive way possible
      review = review.trim();
      if (review.length > 0 && !/[.!?]$/.test(review)) review += ".";
      review += ` ${employee}.`;
    }

    return res.status(200).json({ review });
  } catch (e) {
    console.error(e);
    res.statusCode = 500;
    return res.json({ error: "AI generation failed" });
  }
};
