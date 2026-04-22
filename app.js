/**
 * Aaron Jiang — Addiction
 * Short note: This server feeds a 10-round prompt sequence to a browser sketch.
 * Each prompt describes a realistic task; the user chooses “Think” or “Ask AI”.
 * At the end, the run contributes an anonymous score to a public distribution.
 */

const express = require("express");
const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
dotenv.config();

let OpenAI = null;
try { OpenAI = require("openai").OpenAI; } catch {}

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const client =
  process.env.OPENAI_API_KEY && OpenAI ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

/* -----------------------------
   Prompt pools (offline fallback)
   ----------------------------- */
const FALLBACK = {
  academic_writing: [
    "You have a draft paragraph for a class report that sounds generic. Rewrite it to be clearer and more specific, keeping the meaning unchanged.",
    "Your supervisor says your abstract feels stiff. Polish the tone so it reads academic but still natural, without adding new claims."
  ],
  academic_summary: [
    "You took dense reading notes and now need a clean summary you can review quickly. Turn the notes into a short, well-structured recap with clear headings.",
    "You have a long paragraph from an article and want the core idea fast. Summarize it in plain language while preserving the main point."
  ],
  research_methods: [
    "You drafted a short research idea but the method is unclear. Rewrite it so the method, data source, and limitation are explicit and easy to understand.",
    "You need to justify your research method to a tutor. Make the justification clearer and more convincing, without sounding overconfident."
  ],
  daily_life: [
    "You need to message a roommate about a recurring chore issue without sounding aggressive. Rewrite your message to be calm, clear, and cooperative.",
    "You’re organizing a busy week and keep forgetting small tasks. Turn your messy list into a simple plan that’s easy to follow."
  ],
  travel_planning: [
    "You’re planning a short trip but your notes are scattered across chats and screenshots. Turn them into a simple itinerary that feels realistic and easy to follow.",
    "You want to plan a day out in a new city without over-scheduling. Propose a flexible plan with a clear flow and a backup idea."
  ],
  workplace_comms: [
    "You need to reply to a teammate who misunderstood your message. Rewrite your response to be friendly, precise, and de-escalating.",
    "You’re asking for clarification in a group chat. Rewrite your question so it’s concise and specific, without sounding demanding."
  ],
  decision_tradeoff: [
    "You’re stuck between two options and keep changing your mind. Help structure a decision by clarifying what matters most and what you’d trade off.",
    "You need to pick a direction for a small project. Turn your scattered thoughts into a clear comparison that makes the choice easier."
  ],
  creative_poster: [
    "Your poster draft feels flat and hard to scan. Suggest concrete layout improvements that make hierarchy and focus clearer.",
    "You have a concept but the composition feels empty. Propose a stronger visual structure that guides the viewer’s eye."
  ],
  code_debug: [
    "A small p5.js sketch stutters and you don’t know why. Suggest likely causes and a minimal first fix to test, with a short explanation.",
    "Your Node endpoint sometimes returns empty data. Propose a debugging approach and the first code change you would try."
  ],
  presentation_copy: [
    "Your slide text feels crowded and unclear. Rewrite it to be tighter and easier to present aloud, while keeping key points.",
    "You have a talk topic but no structure. Propose a clean slide outline that flows logically from problem to takeaway."
  ]
};

function pick(arr) {
  return arr[(Math.random() * arr.length) | 0];
}

/* -----------------------------
   Session memory (anti-repeat)
   ----------------------------- */
const sessionStore = new Map(); // sessionId -> { prompts: string[], plan: string[], lastSeen: number }

function getSession(sessionIdRaw) {
  const id = sessionIdRaw && String(sessionIdRaw).trim() ? String(sessionIdRaw).trim() : "default";
  let s = sessionStore.get(id);
  if (!s) {
    s = { prompts: [], plan: null, lastSeen: Date.now() };
    sessionStore.set(id, s);
  } else {
    s.lastSeen = Date.now();
  }
  return s;
}

// Light cleanup: if nobody requests for ~30 min, we drop the session memory.
setInterval(() => {
  const now = Date.now();
  const TTL = 1000 * 60 * 30;
  for (const [k, v] of sessionStore.entries()) {
    if (now - v.lastSeen > TTL) sessionStore.delete(k);
  }
}, 1000 * 60 * 5);

/* -----------------------------
   10-round category plan
   Academic max 3, others once each
   ----------------------------- */
const PLAN_CATS = [
  "academic_writing",
  "academic_summary",
  "research_methods",
  "daily_life",
  "travel_planning",
  "workplace_comms",
  "decision_tradeoff",
  "creative_poster",
  "code_debug",
  "presentation_copy"
];

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function ensurePlan(sess) {
  if (!sess.plan || sess.plan.length !== 10) sess.plan = shuffleInPlace(PLAN_CATS.slice());
  return sess.plan;
}

function categoryForRound(sess, round) {
  const plan = ensurePlan(sess);
  const r = Math.max(1, Math.min(10, Number(round) || 1));
  return plan[r - 1];
}

function tagsForCategory(cat) {
  const tags = {
    academic_writing: { type: "writing", difficulty: 2, uncertainty: 2 },
    academic_summary: { type: "study", difficulty: 2, uncertainty: 2 },
    research_methods: { type: "study", difficulty: 3, uncertainty: 3 },

    daily_life: { type: "life", difficulty: 2, uncertainty: 2 },
    travel_planning: { type: "life", difficulty: 2, uncertainty: 2 },
    workplace_comms: { type: "writing", difficulty: 2, uncertainty: 2 },
    decision_tradeoff: { type: "life", difficulty: 2, uncertainty: 2 },
    creative_poster: { type: "creative", difficulty: 2, uncertainty: 3 },
    code_debug: { type: "code", difficulty: 3, uncertainty: 2 },
    presentation_copy: { type: "writing", difficulty: 2, uncertainty: 2 }
  };
  return tags[cat] || { type: "general", difficulty: 2, uncertainty: 2 };
}

/* -----------------------------
   Similarity check (quick Jaccard)
   ----------------------------- */
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

/* -----------------------------
   Prompt hygiene (keep output “complete”)
   ----------------------------- */
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
  if (s.length < 55) return true;
  if (/(\.\.\.|…)\s*$/.test(s)) return true;
  if (!/[.!?]$/.test(s)) return true;
  return false;
}

/* -----------------------------
   Prompt generation (OpenAI)
   Notes:
   - keeps constraints “light”
   - avoids strong time/budget language
   - varies phrasing and length
   ----------------------------- */
const CATEGORY_GUIDE = {
  academic_writing:
    "Academic writing polish. Artifact: abstract/paragraph/statement. Constraints: tone, clarity, no new claims. Avoid travel contexts.",
  academic_summary:
    "Summarize or structure. Artifact: notes/article paragraph. Constraints: readability and organisation. Avoid travel contexts.",
  research_methods:
    "Methods clarity. Artifact: short proposal. Constraints: explicit method, assumptions, limitations. Avoid travel contexts.",
  daily_life:
    "Everyday life. Artifact: text message / small plan / request. Keep it local and ordinary (home, campus, friends). Avoid travel scenarios.",
  travel_planning:
    "Travel planning. Artifact: scattered notes. Constraints: flexible flow, practicality.",
  workplace_comms:
    "Work/school communication. Artifact: email/chat reply. Constraints: professional but human, de-escalating. Avoid travel contexts.",
  decision_tradeoff:
    "Trade-off thinking. Artifact: two options. Constraints: priorities, pros/cons, decision framing. Avoid travel contexts unless explicitly relevant.",
  creative_poster:
    "Poster/design improvement. Artifact: layout description. Constraints: hierarchy, scanability, focus. Avoid travel contexts.",
  code_debug:
    "Light debugging. Artifact: code + symptom. Constraint: minimal first change, explain why. Avoid travel contexts.",
  presentation_copy:
    "Slides/speaking. Artifact: slide text/outline. Constraints: clarity for speaking, easy scanning. Avoid travel contexts."
};

const VIBE_SEEDS = [
  "Write it like a real moment someone would describe to a friend.",
  "Make it sound like a quick task you’d genuinely do today.",
  "Keep it slightly awkward in a realistic way, not dramatic.",
  "Make it direct, like a note you left for yourself.",
  "Make it feel like you’re under mild pressure, but not panicking."
];

// Extra filters to stop “travel leakage” and money obsession.
const TRAVEL_RE = /\b(trip|travel|itinerary|flight|airport|hotel|hostel|visa|booking|train ticket|boarding pass|city break)\b/i;
const MONEY_RE = /\b(budget|price|cost|expensive|cheap|afford|dollars|usd|eur|euro|pounds|gbp|yen|rmb|cny)\b|[$€£¥]/i;

function mentionsTravel(text) {
  return TRAVEL_RE.test(String(text || ""));
}

function mentionsMoney(text) {
  return MONEY_RE.test(String(text || ""));
}

async function generateScenarioPrompt({ cat, avoidText }) {
  const system = [
    "You generate ONE English scenario-based task prompt for a public interactive artwork.",
    "The user must choose: do it themselves vs ask an AI assistant.",
    "",
    "Requirements:",
    "- Specific, concrete situation. Mention the artifact (message/email/notes/draft/itinerary/code/slide text).",
    "- The task must be unambiguous (rewrite/plan/clarify/structure/compare/debug/etc.).",
    "- Include a constraint, but keep it natural and lightweight.",
    "- Avoid money/price/budget constraints unless absolutely necessary.",
    "",
    "Variation:",
    "- Vary length: 1–4 sentences.",
    "- Vary opening phrasing; don’t repeat the same template.",
    "- No lists, no bullet points, no numbering, no quotes.",
    "- Do NOT mention 'Round' or 'AskAI'.",
    "- Must end with proper punctuation; never use ellipses.",
    "",
    "Return ONLY the prompt text."
  ].join("\n");

  const vibe = VIBE_SEEDS[(Math.random() * VIBE_SEEDS.length) | 0];

  const user = [
    `Category: ${cat}`,
    CATEGORY_GUIDE[cat] || "Practical scenario task.",
    vibe,
    avoidText ? `Avoid similar topics/phrasing to:\n${avoidText}` : ""
  ].filter(Boolean).join("\n\n");

  const r = await client.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 1.15,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user }
    ]
  });

  return sanitizePrompt(r.choices?.[0]?.message?.content || "");
}

/* -----------------------------
   API: Question
   ----------------------------- */
app.get("/api/question", async (req, res) => {
  const round = Number(req.query.round || 1);
  const sessionId = String(req.query.session || "default");
  const avoid = String(req.query.avoid || "").trim();

  const sess = getSession(sessionId);
  const cat = categoryForRound(sess, round);

  const avoidList = []
    .concat(sess.prompts.slice(-22))
    .concat(avoid ? [avoid] : []);

  // If no API key, serve local fallback for the requested category.
  if (!client) {
    const pool = FALLBACK[cat] || FALLBACK.daily_life;
    const q = pick(pool);
    sess.prompts.push(q);
    return res.json({ question: q, tags: tagsForCategory(cat) });
  }

  try {
    let best = "";
    const maxTries = 22;

    for (let i = 0; i < maxTries; i++) {
      const candidate = await generateScenarioPrompt({
        cat,
        avoidText: avoidList.join("\n---\n")
      });

      if (!candidate) continue;
      if (looksIncomplete(candidate)) continue;

      // ✅ stop “travel leakage”
      if (cat !== "travel_planning" && mentionsTravel(candidate)) continue;

      // ✅ stop money obsession (almost never mention money)
      if (mentionsMoney(candidate)) continue;

      if (tooSimilar(candidate, avoidList, 0.46)) continue;

      best = candidate;
      break;
    }

    if (!best) {
      const pool = FALLBACK[cat] || FALLBACK.daily_life;
      best = pick(pool);
    }

    sess.prompts.push(best);
    if (sess.prompts.length > 160) sess.prompts.shift();

    res.json({ question: best, tags: tagsForCategory(cat) });
  } catch {
    const pool = FALLBACK[cat] || FALLBACK.daily_life;
    const q = pick(pool);
    sess.prompts.push(q);
    res.json({ question: q, tags: tagsForCategory(cat) });
  }
});

/* -----------------------------
   Public stats (histogram)
   Stored as JSON for small-scale deployment.
   ----------------------------- */
const DATA_DIR = path.join(__dirname, "data");
const STATS_PATH = path.join(DATA_DIR, "stats.json");

function bucketIndex(rate) {
  const r = Math.max(0, Math.min(100, Number(rate)));
  return r >= 100 ? 9 : Math.floor(r / 10); // 0–9, 10–19, ..., 90–100
}

function defaultStats() {
  return { total: 0, buckets: new Array(10).fill(0), updatedAt: Date.now() };
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
  } catch {
    // For a short-lived deployment this is fine; you can add logging later if needed.
  }
}

let STATS = loadStats();

app.get("/api/stats", (req, res) => {
  res.json({ total: STATS.total, buckets: STATS.buckets, updatedAt: STATS.updatedAt });
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

/* -----------------------------
   Boot
   ----------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));