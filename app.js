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
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch {}
    }
    return null;
  }
}

// -------------------- Local non-fixed generator (only if API fails) --------------------
const TOPICS = ["写作", "总结", "翻译", "学习计划", "解释概念", "代码调试", "邮件", "简历", "面试", "创意", "论文结构", "语气润色"];
const VERBS = ["帮我", "给我", "解释", "改写", "优化", "总结", "翻译", "规划", "列出", "比较", "生成"];
const CONSTRAINTS = ["100字以内", "三点理由", "更学术", "更口语", "更简洁", "更有说服力", "给例子", "分步骤", "表格形式", "先给大纲"];

function localRandomQuestion(round) {
  // deterministic-ish randomness across rounds but not fixed
  const t = TOPICS[Math.floor(Math.random() * TOPICS.length)];
  const v = VERBS[Math.floor(Math.random() * VERBS.length)];
  const c = CONSTRAINTS[Math.floor(Math.random() * CONSTRAINTS.length)];
  const extra = Math.random() < 0.5 ? `，并${CONSTRAINTS[Math.floor(Math.random() * CONSTRAINTS.length)]}` : "";
  return `${v}${t}相关的问题，要求：${c}${extra}。`;
}

// -------------------- /api/question with non-repetition --------------------
const RECENT_Q = new Set(); // store last 20 questions
const RECENT_Q_MAX = 20;

function rememberQuestion(q) {
  RECENT_Q.add(q);
  if (RECENT_Q.size > RECENT_Q_MAX) {
    // delete oldest by recreating set (simple)
    const arr = Array.from(RECENT_Q);
    RECENT_Q.clear();
    arr.slice(arr.length - RECENT_Q_MAX).forEach(x => RECENT_Q.add(x));
  }
}

async function generateQuestionWithRetries(round, maxTries = 4) {
  const avoidList = Array.from(RECENT_Q).slice(-10);

  const prompt = `
Generate ONE short question that people commonly ask AI assistants (ChatGPT-like) in everyday life.
Make it realistic and specific (writing / summarization / translation / planning / explanation / coding / advice).
Avoid harmful, illegal, or medical diagnosis content.

IMPORTANT:
- The question must be different from the following recent questions:
${avoidList.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Return JSON ONLY:
{
  "question": "string",
  "tags": { "type": "one of: writing|summarize|translate|plan|explain|code|advice", "difficulty": 1-5, "uncertainty": 1-5 }
}

Round: ${round} of 10.
`;

  for (let i = 0; i < maxTries; i++) {
    const r = await client.responses.create({
      model: MODEL,
      input: prompt
    });

    const text = r.output_text || "";
    const obj = safeJsonParse(text);
    const q = obj?.question ? String(obj.question).trim() : "";

    if (!q) continue;

    // basic de-dup check (exact match)
    if (!RECENT_Q.has(q)) {
      return { question: q, tags: obj.tags || { type: "general", difficulty: 2, uncertainty: 2 } };
    }
  }

  // if still repeating, append a small random twist to force uniqueness
  const fallback = `给我一个常见AI问题（第${round}轮），但换个角度问：${localRandomQuestion(round)}`;
  return { question: fallback, tags: { type: "general", difficulty: 2, uncertainty: 2 } };
}

app.get("/api/question", async (req, res) => {
  const round = Number(req.query.round || 1);

  // If no key, still generate non-fixed questions locally (not the 10 fixed lines)
  if (!process.env.OPENAI_API_KEY) {
    const q = localRandomQuestion(round);
    return res.json({ question: q, tags: { type: "general", difficulty: 2, uncertainty: 2 } });
  }

  try {
    const out = await generateQuestionWithRetries(round, 4);
    rememberQuestion(out.question);
    res.json(out);
  } catch (e) {
    // If API fails, still return a non-fixed local question
    const q = localRandomQuestion(round);
    res.json({ question: q, tags: { type: "general", difficulty: 2, uncertainty: 2 } });
  }
});

// -------------------- /api/wordfield (unchanged, still AI-generated) --------------------
const RECENT_BG = [];
const RECENT_BG_MAX = 6;

function pushRecentBG(items) {
  RECENT_BG.push(items.slice(0, 80).join("|"));
  while (RECENT_BG.length > RECENT_BG_MAX) RECENT_BG.shift();
}

app.get("/api/wordfield", async (req, res) => {
  const round = Number(req.query.round || 1);
  const count = Math.max(120, Math.min(Number(req.query.count || 260), 420));
  const topic = (req.query.topic || "").slice(0, 120);

  if (!process.env.OPENAI_API_KEY) {
    // local dynamic fragments (non-fixed)
    const items = Array.from({ length: count }, () => {
      const t = TOPICS[Math.floor(Math.random() * TOPICS.length)];
      const c = CONSTRAINTS[Math.floor(Math.random() * CONSTRAINTS.length)];
      const v = VERBS[Math.floor(Math.random() * VERBS.length)];
      return `${v}${t}｜${c}`.slice(0, 22);
    });
    return res.json({ items });
  }

  const avoid = RECENT_BG.length
    ? `Avoid repeating content similar to these recent batches:\n- ${RECENT_BG.join("\n- ")}\n`
    : "";

  const prompt = `
You are generating background text for a generative art installation.

Generate ${count} short text fragments to fill the screen.
They should look like real things people ask AI, but split into:
- single words, short phrases, or very short micro-questions (2–8 words),
- mix English + Chinese naturally,
- NO long sentences, NO numbering, NO bullet points inside the items.

Make them related to everyday AI use:
writing, rewriting, summarizing, translating, planning, explaining, coding, advice, study.

If a topic is provided, lightly bias toward it:
Topic: "${topic}"

${avoid}

Return JSON ONLY:
{ "items": ["text1", "text2", ...] }

Round: ${round}/10
`;

  try {
    const r = await client.responses.create({
      model: MODEL,
      input: prompt
    });

    const text = r.output_text || "";
    const obj = safeJsonParse(text);

    if (!obj?.items || !Array.isArray(obj.items)) throw new Error("Bad JSON");

    const items = obj.items
      .map(s => String(s).trim())
      .filter(Boolean)
      .map(s => s.slice(0, 22));

    pushRecentBG(items);

    res.json({ items });
  } catch (e) {
    // local dynamic fallback
    const items = Array.from({ length: count }, () => {
      const t = TOPICS[Math.floor(Math.random() * TOPICS.length)];
      const c = CONSTRAINTS[Math.floor(Math.random() * CONSTRAINTS.length)];
      const v = VERBS[Math.floor(Math.random() * VERBS.length)];
      return `${v}${t}｜${c}`.slice(0, 22);
    });
    res.json({ items });
  }
});

app.listen(PORT, () => {
  console.log(`Running on http://localhost:${PORT}`);
});