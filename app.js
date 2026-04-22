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
  study_writing: [
    "A class paragraph keeps circling the same idea, so the main claim gets lost. Rewrite it so the point is obvious, without adding new facts.",
    "A short reflection draft sounds stiff and over-formal. Polish it into a calmer academic tone that still reads naturally, keeping the meaning unchanged."
  ],
  study_summary: [
    "Lecture notes are scattered across half-sentences, arrows, and side comments. Restructure them into a clean summary that is easy to review.",
    "A dense paragraph hides the key idea under definitions and examples. Summarise it in plain English while keeping the central point."
  ],
  online_life: [
    "A comment you typed could easily be read as sarcastic even if you didn’t mean it. Rewrite it to keep the point but reduce the chance of misreading.",
    "A short post draft feels unclear and slightly awkward. Rewrite it so it sounds human, readable, and easy to follow."
  ],
  common_sense: [
    "A friend shares a neat-sounding claim that feels too convenient to trust. Write a reply that checks assumptions and asks good questions without sounding smug.",
    "Someone keeps mixing up a simple concept and gets frustrated. Rewrite your explanation so it stays accurate but feels easy to grasp."
  ],
  daily_life: [
    "A small recurring issue at home keeps coming back, but you don’t want to start an argument. Rewrite a message that is calm, clear, and cooperative.",
    "A week plan exists in fragments—sticky notes, screenshots, and half-finished lists. Turn it into a simple plan that is easy to follow."
  ],
  travel_planning: [
    "Plans are scattered across chat messages and screenshots, and people disagree on priorities. Turn the notes into a flexible itinerary with a sensible flow.",
    "A day plan in a new city keeps growing into too many stops. Propose a route that stays flexible and doesn’t feel rushed."
  ],
  decision_tradeoff: [
    "Two options both sound good for different reasons, so the decision keeps stalling. Structure the choice by clarifying priorities and trade-offs.",
    "A small project needs a direction, but the pros and cons are still fuzzy. Rewrite your thoughts into a clear comparison that supports a decision."
  ],
  creative_design: [
    "A poster draft looks busy but still feels flat, like everything has the same weight. Suggest concrete layout changes that improve hierarchy and focus.",
    "A concept is strong, but the composition doesn’t guide the eye. Propose a clearer visual structure that makes the focal point obvious."
  ],
  code_debug: [
    "A p5.js sketch runs smoothly at first, then starts stuttering. Suggest likely causes and one minimal fix to test first, with a brief reason.",
    "A Node endpoint sometimes returns empty data without obvious errors. Suggest a debugging path and the first code change you would try."
  ],
  communication: [
    "In a group chat, your tone was misread and the thread is getting tense. Rewrite a reply that is friendly, precise, and de-escalating.",
    "A clarification request needs to be posted in a busy channel without sounding demanding. Rewrite the message to be specific and polite."
  ]
};

function pick(arr) {
  return arr[(Math.random() * arr.length) | 0];
}

/* -----------------------------
   Session memory (anti-repeat)
   ----------------------------- */
const sessionStore = new Map(); // sessionId -> { prompts: string[], plan: string[], lenPlan: ("short"|"long")[], lastSeen: number }

function getSession(sessionIdRaw) {
  const id = sessionIdRaw && String(sessionIdRaw).trim() ? String(sessionIdRaw).trim() : "default";
  let s = sessionStore.get(id);
  if (!s) {
    s = { prompts: [], plan: null, lenPlan: null, lastSeen: Date.now() };
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

/* -----------------------------
   10-round theme plan (all unique)
   ----------------------------- */
const PLAN_THEMES = [
  "daily_life",
  "study_writing",
  "online_life",
  "common_sense",
  "code_debug",
  "creative_design",
  "travel_planning",
  "decision_tradeoff",
  "communication",
  "study_summary"
];

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function ensurePlan(sess) {
  if (!sess.plan || sess.plan.length !== 10) sess.plan = shuffleInPlace(PLAN_THEMES.slice());
  return sess.plan;
}

function themeForRound(sess, round) {
  const plan = ensurePlan(sess);
  const r = Math.max(1, Math.min(10, Number(round) || 1));
  return plan[r - 1];
}

function tagsForTheme(theme) {
  const tags = {
    daily_life: { type: "life", difficulty: 2, uncertainty: 2 },
    study_writing: { type: "study", difficulty: 2, uncertainty: 2 },
    study_summary: { type: "study", difficulty: 2, uncertainty: 2 },
    online_life: { type: "life", difficulty: 2, uncertainty: 2 },
    common_sense: { type: "general", difficulty: 2, uncertainty: 2 },
    code_debug: { type: "code", difficulty: 3, uncertainty: 2 },
    creative_design: { type: "creative", difficulty: 2, uncertainty: 3 },
    travel_planning: { type: "life", difficulty: 2, uncertainty: 2 },
    decision_tradeoff: { type: "life", difficulty: 2, uncertainty: 2 },
    communication: { type: "writing", difficulty: 2, uncertainty: 2 }
  };
  return tags[theme] || { type: "general", difficulty: 2, uncertainty: 2 };
}

/* -----------------------------
   10-round length plan (4 short + 6 long)
   Short is still concrete: situation + artifact + task.
   ----------------------------- */
function ensureLengthPlan(sess) {
  if (sess.lenPlan && sess.lenPlan.length === 10) return sess.lenPlan;

  const plan = []
    .concat(new Array(4).fill("short"))
    .concat(new Array(6).fill("long"));

  sess.lenPlan = shuffleInPlace(plan);
  return sess.lenPlan;
}

function lengthForRound(sess, round) {
  const p = ensureLengthPlan(sess);
  const r = Math.max(1, Math.min(10, Number(round) || 1));
  return p[r - 1];
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
const ENDING_LINE = "If it were you, would you Ask AI or think it through yourself?";

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

// Make sure every prompt ends with the same closing question.
function ensureEnding(text) {
  let s = sanitizePrompt(text);
  if (!s) return s;

  // If it already ends with the intended question, keep it.
  const tail = s.slice(-ENDING_LINE.length).toLowerCase();
  if (tail === ENDING_LINE.toLowerCase()) return s;

  // Remove other “choice questions” if the model wrote them.
  s = s
    .replace(/\s*(Do you|Would you|Will you)\s+(want to|prefer to|rather|choose).*[?]\s*$/i, "")
    .replace(/\s*(Would you)\s+(ask ai|use ai|use an ai assistant).*[?]\s*$/i, "")
    .trim();

  // Ensure punctuation before appending.
  if (s && !/[.!?]$/.test(s)) s += ".";

  return `${s} ${ENDING_LINE}`;
}

/* -----------------------------
   Prompt generation (OpenAI)
   ----------------------------- */
const THEME_GUIDE = {
  daily_life:
    "Daily life. Keep it grounded: home, campus, friends. Artifact can be a message, a note, a small plan.",
  study_writing:
    "Study writing. Artifact: a short paragraph, reflection, or claim. Improve clarity without adding new facts.",
  study_summary:
    "Study summarising/structuring. Artifact: notes or a dense paragraph. Make it easier to review.",
  online_life:
    "Online tone. Artifact: comment, post draft, DM, reply. Focus on clarity and misinterpretation risk.",
  common_sense:
    "Common sense / media literacy. Artifact: a claim or explanation. Check assumptions; keep it accessible.",
  code_debug:
    "Debug/performance. Artifact: code + symptom. Suggest a minimal first test and why.",
  creative_design:
    "Design/poster/visual communication. Artifact: layout description. Improve hierarchy and readability.",
  travel_planning:
    "Travel planning (only once per run). Artifact: scattered notes. Keep it flexible; avoid prices and strict schedules.",
  decision_tradeoff:
    "Decision framing. Artifact: two options. Clarify priorities and trade-offs, not time/budget.",
  communication:
    "Communication. Artifact: chat message, reply, short update. Avoid making every case an email."
};

const SCENE_SEEDS = {
  daily_life: [
    "a roommate texting about a small recurring issue",
    "a friend waiting on a reply you forgot",
    "a to-do list that keeps growing without order",
    "an apology that should not become a long essay",
    "a reminder you want to sound kind, not bossy"
  ],
  study_writing: [
    "a paragraph that repeats the same phrase",
    "a claim that sounds confident but is vague",
    "a reflection that swings between too dramatic and too flat",
    "a conclusion that doesn’t actually conclude",
    "a draft that needs a calmer academic tone"
  ],
  study_summary: [
    "notes mixing quotes and your own thoughts",
    "a reading where the key idea is buried",
    "a lecture recap that is too long to revise",
    "a paragraph full of definitions that needs order",
    "a section that needs a clean structure for revision"
  ],
  online_life: [
    "a comment thread where tone is easy to misread",
    "a short post draft that could be misunderstood",
    "a DM that should be clear but not intense",
    "a reply that should calm things down",
    "a caption that needs to sound natural, not forced"
  ],
  common_sense: [
    "a viral claim that sounds too neat to be true",
    "a simple concept someone keeps misunderstanding",
    "an argument that needs clearer assumptions",
    "a disagreement where you want to ask better questions",
    "a short explanation that should be accurate but simple"
  ],
  code_debug: [
    "a sketch that slows down after a minute",
    "a bug that appears only after several clicks",
    "a fetch that sometimes returns nothing",
    "a performance drop from drawing too much per frame",
    "a state issue you want to isolate with a minimal test"
  ],
  creative_design: [
    "a poster where everything looks equally important",
    "a layout that feels empty in the centre",
    "a design that reads fine up close but not from a distance",
    "a concept that needs a stronger focal point",
    "a draft that needs clearer hierarchy and spacing"
  ],
  travel_planning: [
    "friends sending suggestions with different tastes",
    "a day plan that should feel flexible, not rushed",
    "too many stops that need simplification",
    "a route that needs a clear flow and a backup",
    "notes scattered across chat and screenshots"
  ],
  decision_tradeoff: [
    "two directions with different risks",
    "a trade-off between clarity and ambition",
    "a choice you keep postponing",
    "priorities that conflict with each other",
    "an option comparison you want to keep honest"
  ],
  communication: [
    "a group chat misunderstanding your tone",
    "a short update that needs to be readable fast",
    "a clarification request in a busy channel",
    "a reply that should de-escalate tension",
    "a message that should be firm but not cold"
  ]
};

const TRAVEL_RE = /\b(trip|travel|itinerary|flight|airport|hotel|hostel|visa|booking|train ticket|boarding pass|city break)\b/i;
const MONEY_RE = /\b(budget|price|cost|expensive|cheap|afford|dollars|usd|eur|euro|pounds|gbp|yen|rmb|cny)\b|[$€£¥]/i;

// Avoid over-template openings. Not banned, just discouraged.
const YOU_START_RE = /^\s*(you|you’re|you're|you have|you need)\b/i;

function mentionsTravel(text) {
  return TRAVEL_RE.test(String(text || ""));
}

function mentionsMoney(text) {
  return MONEY_RE.test(String(text || ""));
}

function startsTooTemplate(text) {
  return YOU_START_RE.test(String(text || ""));
}

function lengthDirective(lenKind) {
  if (lenKind === "short") {
    return "Length: 1–2 sentences. Still include a clear situation, the artifact, and the exact task.";
  }
  return "Length: 3–4 sentences. Keep it easy to read, with a clear task.";
}

async function generateScenarioPrompt({ theme, avoidText, lenKind }) {
  const system = [
    "Write ONE English scenario prompt for a public interactive artwork.",
    "It should feel like a real situation with a clear task.",
    "",
    "Hard rules:",
    "- Keep the language simple and readable (no academic jargon unless the theme is study writing).",
    "- Include a concrete situation + a specific artifact (message, notes, paragraph, comment, code, plan).",
    "- Make the task unambiguous (rewrite / summarise / clarify / plan / compare / debug / redesign).",
    "- Avoid money/price/budget.",
    "- Avoid strict time limits and countdowns.",
    "- No lists, no bullet points, no numbering, no quotes, no ellipses.",
    "",
    "Style:",
    "- Do not always start with 'You' or 'You’re'. Vary openings naturally.",
    "- Vary sentence rhythm; avoid a repeated template.",
    "",
    `Important ending rule: end with exactly this final sentence: "${ENDING_LINE}"`,
    "",
    "Return only the prompt text."
  ].join("\n");

  const pool = SCENE_SEEDS[theme] || ["a realistic situation with a clear artifact"];
  const scene = pool[(Math.random() * pool.length) | 0];

  const user = [
    `Theme: ${theme}`,
    THEME_GUIDE[theme] || "Practical scenario task.",
    `Scene seed: ${scene}`,
    lengthDirective(lenKind),
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

  return ensureEnding(r.choices?.[0]?.message?.content || "");
}

/* -----------------------------
   API: Question
   ----------------------------- */
app.get("/api/question", async (req, res) => {
  const round = Number(req.query.round || 1);
  const sessionId = String(req.query.session || "default");
  const avoid = String(req.query.avoid || "").trim();

  const sess = getSession(sessionId);
  const theme = themeForRound(sess, round);
  const lenKind = lengthForRound(sess, round);

  const avoidList = []
    .concat(sess.prompts.slice(-22))
    .concat(avoid ? [avoid] : []);

  // Offline path
  if (!client) {
    const pool = FALLBACK[theme] || FALLBACK.daily_life;
    const q = ensureEnding(pick(pool));
    sess.prompts.push(q);
    return res.json({
      question: q,
      tags: tagsForTheme(theme),
      source: "fallback",
      reason: "client_not_ready"
    });
  }

  try {
    let best = "";
    const maxTries = 34;

    for (let i = 0; i < maxTries; i++) {
      const candidateRaw = await generateScenarioPrompt({
        theme,
        lenKind,
        avoidText: avoidList.join("\n---\n")
      });

      const candidate = ensureEnding(candidateRaw);
      if (!candidate) continue;
      if (looksIncomplete(candidate)) continue;

      // Travel should only happen in the travel theme.
      if (theme !== "travel_planning" && mentionsTravel(candidate)) continue;

      // Avoid money language almost entirely.
      if (mentionsMoney(candidate)) continue;

      // Stronger avoidance early on; later we relax a bit.
      if (i < 18 && startsTooTemplate(candidate)) continue;

      if (tooSimilar(candidate, avoidList, 0.46)) continue;

      best = candidate;
      break;
    }

    if (!best) {
      const pool = FALLBACK[theme] || FALLBACK.daily_life;
      best = ensureEnding(pick(pool));
      sess.prompts.push(best);
      return res.json({
        question: best,
        tags: tagsForTheme(theme),
        source: "fallback",
        reason: "no_candidate_passed_filters"
      });
    }

    sess.prompts.push(best);
    if (sess.prompts.length > 160) sess.prompts.shift();

    res.json({
      question: best,
      tags: tagsForTheme(theme),
      source: "openai",
      length: lenKind
    });
  } catch (e) {
    const pool = FALLBACK[theme] || FALLBACK.daily_life;
    const q = ensureEnding(pick(pool));
    sess.prompts.push(q);
    res.json({
      question: q,
      tags: tagsForTheme(theme),
      source: "fallback",
      error: String(e?.message || e)
    });
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
  return r >= 100 ? 9 : Math.floor(r / 10);
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
  } catch {}
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Running on http://localhost:${PORT}`));