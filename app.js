// app.js (FULL)
const express = require("express");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
dotenv.config();

let OpenAI = null;
try {
  OpenAI = require("openai").OpenAI;
} catch {}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const client = process.env.OPENAI_API_KEY && OpenAI
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

// -------------------- Fallback prompts (complete + specific) --------------------
const localFallback = [
  "You’ve written a Chinese abstract for your project and your supervisor wants an English version. Translate it into English (150–180 words) and polish the tone to sound academic but natural.",
  "Your tutor says this paragraph is vague and hard to evaluate. Rewrite it to be more specific, add 1 concrete example, and keep it under 120 words.",
  "You need to email a professor about a deadline extension. Rewrite it to sound polite and confident (under 110 words) while keeping all key facts unchanged.",
  "You have messy lecture notes from a seminar. Turn them into a clean outline with 3 headings and 6 bullet points you can paste into slides.",
  "Your poster layout feels empty and unfocused. Suggest 6 composition/hierarchy changes to make it richer without clutter, and justify the top 2 choices in one sentence each.",
  "A p5.js sketch stutters on your laptop. Identify 3 likely causes and propose one minimal fix to try first, with a short explanation."
];

function pick(arr) {
  return arr[(Math.random() * arr.length) | 0];
}

// -------------------- Session store (anti-repeat, in-memory) --------------------
const sessionStore = new Map(); // sessionId -> { prompts: string[], lastSeen: number }

function getSession(sessionId) {
  const id = sessionId && String(sessionId).trim() ? String(sessionId).trim() : "default";
  let s = sessionStore.get(id);
  if (!s) {
    s = { prompts: [], lastSeen: Date.now() };
    sessionStore.set(id, s);
  } else {
    s.lastSeen = Date.now();
  }
  return s;
}

setInterval(() => {
  const now = Date.now();
  const TTL = 1000 * 60 * 30;
  for (const [k, v] of sessionStore.entries()) {
    if (now - v.lastSeen > TTL) sessionStore.delete(k);
  }
}, 1000 * 60 * 5);

// -------------------- Similarity --------------------
const STOP = new Set([
  "the","a","an","and","or","to","of","in","on","for","with","is","are","was","were",
  "this","that","these","those","it","i","you","we","they","my","your","our",
  "into","from","as","at","by","be","but","not","do","does","did","so","if","then",
  "make","help","need","please","can","could","should","would","must","have","has"
]);

function tokenize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 4 && !STOP.has(w));
}

function jaccard(a, b) {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = A.size + B.size - inter;
  return union ? inter / union : 0;
}

function tooSimilar(candidate, list, thresh = 0.46) {
  for (const old of list) {
    if (jaccard(candidate, old) > thresh) return true;
  }
  return false;
}

// -------------------- Sanitize + completeness checks --------------------
function sanitizePrompt(text) {
  let t = String(text || "").trim();
  t = t.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  t = t.replace(/^\d+[\)\.\:]\s*/g, "").trim();
  t = t.replace(/^round\s*\d+\s*[:：\-]\s*/i, "").trim();
  t = t.replace(/^\-\s*/g, "").trim();
  t = t.replace(/\s+/g, " ").trim();
  t = t.replace(/(\.\.\.|…)+\s*$/g, "").trim();
  return t;
}

function looksIncomplete(t) {
  if (!t) return true;
  const s = t.trim();
  if (s.length < 80) return true;
  if (/(\.\.\.|…)\s*$/.test(s)) return true;
  if (!/[.!?]$/.test(s)) return true;
  if (/[,\-–—]\s*[a-z]{1,3}\.$/i.test(s)) return true;
  return false;
}

// -------------------- Round -> category (keeps variety, not fixed prompts) --------------------
function categoryForRound(round) {
  const r = ((round - 1) % 10) + 1;
  const map = {
    1: "translation_polish",
    2: "rewrite_tone",
    3: "summarize_structure",
    4: "poster_creativity",
    5: "argument_clarity",
    6: "code_debug",
    7: "planning_decision",
    8: "research_methods",
    9: "presentation_copy",
    10: "translation_polish_strict"
  };
  return map[r] || "general";
}

function tagsForCategory(cat) {
  const t = {
    translation_polish: { type: "writing", difficulty: 2, uncertainty: 2 },
    translation_polish_strict: { type: "writing", difficulty: 3, uncertainty: 2 },
    rewrite_tone: { type: "writing", difficulty: 2, uncertainty: 2 },
    summarize_structure: { type: "study", difficulty: 2, uncertainty: 2 },
    poster_creativity: { type: "creative", difficulty: 2, uncertainty: 3 },
    argument_clarity: { type: "study", difficulty: 3, uncertainty: 3 },
    code_debug: { type: "code", difficulty: 3, uncertainty: 2 },
    planning_decision: { type: "life", difficulty: 2, uncertainty: 2 },
    research_methods: { type: "study", difficulty: 3, uncertainty: 3 },
    presentation_copy: { type: "writing", difficulty: 2, uncertainty: 2 }
  };
  return t[cat] || { type: "general", difficulty: 2, uncertainty: 2 };
}

async function generateScenarioPrompt({ round, avoidText }) {
  const cat = categoryForRound(round);

  const system = [
    "You generate ONE English scenario-based task prompt for an interactive artwork.",
    "The user must choose: do it themselves vs ask an AI assistant.",
    "",
    "Hard requirements:",
    "- 2–3 sentences.",
    "- Must include a concrete situation: WHO + WHAT artifact they have + WHY it matters (pressure/context).",
    "- Must clearly state the exact task to do (rewrite/translate/outline/debug/brainstorm/etc.).",
    "- Must include at least ONE measurable constraint (word count, tone, format, number of options, etc.).",
    "- Avoid precise countdowns or strict time limits. Do NOT say 'in 20 minutes', 'in 2 hours', 'tonight'.",
    "- If time is mentioned, keep it vague (e.g., 'soon', 'today', 'this week') or omit it.",
    "- No lists, no bullet points, no numbering, no quotes.",
    "- Do NOT mention 'Round' or 'AskAI'.",
    "- The prompt MUST be complete: end with proper punctuation, and NEVER use ellipses.",
    "",
    "Length variety:",
    "- Randomly vary length across outputs: sometimes concise, sometimes medium, sometimes longer, but always complete.",
    "",
    "Return ONLY the prompt text."
  ].join("\n");

  const categoryGuide = {
    translation_polish:
      "Focus: Chinese -> English translation + polish for academic/professional tone. Artifact: abstract/statement/email.",
    translation_polish_strict:
      "Focus: same as above but stricter academic style + remove filler + keep meaning.",
    rewrite_tone:
      "Focus: rewrite with tone control (polite but firm / academic but clear / less robotic). Artifact: email/paragraph/statement.",
    summarize_structure:
      "Focus: convert messy content into structured output (headings/outline/bullets). Artifact: notes/article excerpt.",
    poster_creativity:
      "Focus: poster/visual concept: improve hierarchy/composition, propose concrete changes/options. Artifact: poster draft description.",
    argument_clarity:
      "Focus: strengthen argument: clarify claim, add evidence slot, add counterargument, tighten logic. Artifact: thesis paragraph.",
    code_debug:
      "Focus: p5.js / Node.js bug/performance/async issue. Artifact: code snippet + symptom.",
    planning_decision:
      "Focus: choose between options with trade-offs and constraints. Artifact: 2 concept directions.",
    research_methods:
      "Focus: research proposal method justification / operationalization / limitations. Artifact: short proposal draft.",
    presentation_copy:
      "Focus: presentation slides: outline/speaker notes/title options with constraints. Artifact: slide topic."
  };

  const user = [
    `Category: ${cat}`,
    categoryGuide[cat] || "Focus: practical everyday scenario task.",
    avoidText ? `Avoid similar topics/phrasing to:\n${avoidText}` : ""
  ].filter(Boolean).join("\n\n");

  const r = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 1.08,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  });

  return sanitizePrompt(r.choices?.[0]?.message?.content || "");
}

// -------------------- Question API --------------------
app.get("/api/question", async (req, res) => {
  const round = Number(req.query.round || 1);
  const sessionId = String(req.query.session || "default");
  const avoid = String(req.query.avoid || "").trim();

  const sess = getSession(sessionId);
  const avoidList = []
    .concat(sess.prompts.slice(-18))
    .concat(avoid ? [avoid] : []);

  if (!client) {
    const q = pick(localFallback);
    sess.prompts.push(q);
    return res.json({ question: q, tags: tagsForCategory(categoryForRound(round)) });
  }

  try {
    let best = "";
    const maxTries = 12;

    for (let i = 0; i < maxTries; i++) {
      const candidate = await generateScenarioPrompt({
        round,
        avoidText: avoidList.join("\n---\n")
      });

      if (!candidate) continue;
      if (looksIncomplete(candidate)) continue;
      if (tooSimilar(candidate, avoidList, 0.46)) continue;

      best = candidate;
      break;
    }

    if (!best) best = pick(localFallback);

    sess.prompts.push(best);
    if (sess.prompts.length > 120) sess.prompts.shift();

    res.json({
      question: best,
      tags: tagsForCategory(categoryForRound(round))
    });
  } catch (e) {
    const q = pick(localFallback);
    sess.prompts.push(q);
    res.json({
      question: q,
      tags: tagsForCategory(categoryForRound(round))
    });
  }
});

/* =========================
   PUBLIC STATS (Histogram)
   ========================= */

const DATA_DIR = path.join(__dirname, "data");
const STATS_PATH = path.join(DATA_DIR, "stats.json");

// 10 buckets: 0-9,10-19,...,90-100
function bucketIndex(rate) {
  const r = Math.max(0, Math.min(100, Number(rate)));
  if (r >= 100) return 9;
  return Math.floor(r / 10);
}

function defaultStats() {
  return {
    total: 0,
    buckets: new Array(10).fill(0),
    updatedAt: Date.now()
  };
}

function loadStats() {
  try {
    if (!fs.existsSync(STATS_PATH)) return defaultStats();
    const raw = fs.readFileSync(STATS_PATH, "utf-8");
    const j = JSON.parse(raw);
    if (!j || !Array.isArray(j.buckets) || j.buckets.length !== 10) return defaultStats();
    return {
      total: Number(j.total || 0),
      buckets: j.buckets.map(n => Number(n || 0)).slice(0, 10),
      updatedAt: Number(j.updatedAt || Date.now())
    };
  } catch {
    return defaultStats();
  }
}

function saveStats(stats) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATS_PATH, JSON.stringify(stats, null, 2), "utf-8");
  } catch {}
}

let STATS = loadStats();

app.get("/api/stats", (req, res) => {
  res.json({
    total: STATS.total,
    buckets: STATS.buckets,
    updatedAt: STATS.updatedAt
  });
});

app.post("/api/submit", (req, res) => {
  const rate = Number(req.body?.rate);
  if (!Number.isFinite(rate)) {
    return res.status(400).json({ ok: false, error: "rate must be a number" });
  }

  const idx = bucketIndex(rate);
  STATS.total += 1;
  STATS.buckets[idx] += 1;
  STATS.updatedAt = Date.now();
  saveStats(STATS);

  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));