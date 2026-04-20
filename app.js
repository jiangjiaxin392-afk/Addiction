const express = require("express");
const dotenv = require("dotenv");
const OpenAI = require("openai");

dotenv.config();

const app = express();
app.use(express.json());
app.use(express.static("public"));

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const PORT = process.env.PORT || 3000;
const MODEL = process.env.MODEL || "gpt-5";

function safeJsonParse(text) {
  try { return JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) { try { return JSON.parse(m[0]); } catch {} }
    return null;
  }
}

// ---- Non-repeating questions (10 rounds) ----
const RECENT_Q = new Set();
const RECENT_Q_MAX = 25;

function rememberQuestion(q) {
  RECENT_Q.add(q);
  if (RECENT_Q.size > RECENT_Q_MAX) {
    const arr = Array.from(RECENT_Q);
    RECENT_Q.clear();
    arr.slice(arr.length - RECENT_Q_MAX).forEach(x => RECENT_Q.add(x));
  }
}

function localRandomEnglishQuestion(round) {
  const topics = ["rewrite a paragraph", "summarize an article", "translate a sentence", "make a study plan", "explain a concept", "debug code", "write an email", "brainstorm titles", "improve clarity", "outline an essay"];
  const constraints = ["in 3 bullet points", "in a more academic tone", "more concise", "with examples", "step by step", "under 120 words"];
  const t = topics[Math.floor(Math.random() * topics.length)];
  const c = constraints[Math.floor(Math.random() * constraints.length)];
  return `Round ${round}: Help me ${t}, ${c}.`;
}

async function generateQuestionWithRetries(round, maxTries = 4) {
  const avoidList = Array.from(RECENT_Q).slice(-10);

  const prompt = `
Generate ONE short, natural, everyday question that people commonly ask AI assistants.
IMPORTANT:
- English only.
- No harmful/illegal content, no medical diagnosis.
- Make it specific (writing / summarizing / translating / planning / explaining / coding / advice).
- Must be different from these recent questions:
${avoidList.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Return JSON ONLY:
{
  "question": "string",
  "tags": { "type": "one of: writing|summarize|translate|plan|explain|code|advice", "difficulty": 1-5, "uncertainty": 1-5 }
}

Round: ${round} of 10.
`;

  for (let i = 0; i < maxTries; i++) {
    const r = await client.responses.create({ model: MODEL, input: prompt });
    const text = r.output_text || "";
    const obj = safeJsonParse(text);
    const q = obj?.question ? String(obj.question).trim() : "";
    if (!q) continue;
    if (!RECENT_Q.has(q)) {
      return { question: q, tags: obj.tags || { type: "general", difficulty: 2, uncertainty: 2 } };
    }
  }
  return { question: localRandomEnglishQuestion(round), tags: { type: "general", difficulty: 2, uncertainty: 2 } };
}

app.get("/api/question", async (req, res) => {
  const round = Number(req.query.round || 1);

  if (!process.env.OPENAI_API_KEY) {
    return res.json({ question: localRandomEnglishQuestion(round), tags: { type: "general", difficulty: 2, uncertainty: 2 } });
  }

  try {
    const out = await generateQuestionWithRetries(round, 4);
    rememberQuestion(out.question);
    res.json(out);
  } catch {
    res.json({ question: localRandomEnglishQuestion(round), tags: { type: "general", difficulty: 2, uncertainty: 2 } });
  }
});

// ---- Background word pool (English only) ----
const RECENT_BG = [];
const RECENT_BG_MAX = 6;

function pushRecentBG(items) {
  RECENT_BG.push(items.slice(0, 120).join("|"));
  while (RECENT_BG.length > RECENT_BG_MAX) RECENT_BG.shift();
}

app.get("/api/wordfield", async (req, res) => {
  const round = Number(req.query.round || 1);
  const count = Math.max(120, Math.min(Number(req.query.count || 220), 420));
  const topic = (req.query.topic || "").slice(0, 120);

  if (!process.env.OPENAI_API_KEY) {
    // local fallback: random English fragments
    const base = ("rewrite summarize translate plan explain debug email outline thesis tone clarity concise steps example").split(" ");
    const items = Array.from({ length: count }, () => base[Math.floor(Math.random() * base.length)]);
    return res.json({ items });
  }

  const avoid = RECENT_BG.length
    ? `Avoid repeating content similar to these recent batches:\n- ${RECENT_BG.join("\n- ")}\n`
    : "";

  const prompt = `
Generate ${count} short English-only fragments to fill a screen background.
They should look like typical AI prompt words:
- single words or very short phrases (1–3 words).
- No punctuation-heavy sentences.
- No numbering, no bullets.
Theme: everyday AI use (writing, rewriting, summarize, translate, plan, explain, code, advice).

Lightly bias toward this topic:
"${topic}"

${avoid}

Return JSON ONLY:
{ "items": ["word1", "short phrase", ...] }

Round: ${round}/10
`;

  try {
    const r = await client.responses.create({ model: MODEL, input: prompt });
    const text = r.output_text || "";
    const obj = safeJsonParse(text);

    if (!obj?.items || !Array.isArray(obj.items)) throw new Error("Bad JSON");

    const items = obj.items
      .map(s => String(s).trim())
      .filter(Boolean)
      .map(s => s.slice(0, 16));

    pushRecentBG(items);
    res.json({ items });
  } catch {
    const base = ("rewrite summarize translate plan explain debug email outline thesis tone clarity concise steps example").split(" ");
    const items = Array.from({ length: count }, () => base[Math.floor(Math.random() * base.length)]);
    res.json({ items });
  }
});

app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));