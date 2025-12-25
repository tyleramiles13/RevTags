import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY_REAL,
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { business, employee, extra } = req.body;

  if (!business || !employee) {
    return res.status(400).json({ error: "Missing data" });
  }

  try {
    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You write short, natural Google reviews. They must sound like real customers, not marketing copy. Vary phrasing every time.",
        },
        {
          role: "user",
          content: `Write a short Google review for ${employee} at ${business}. 
          Keep it casual, friendly, and realistic. Do not sound promotional.
          ${extra || ""}`,
        },
      ],
      temperature: 0.9,
      max_tokens: 120,
    });

    res.status(200).json({
      review: completion.choices[0].message.content.trim(),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "AI generation failed" });
  }
}
