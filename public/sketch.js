// sketch.js (FULL) — cover + quiz + public histogram (no file rename)

const totalRounds = 10;

let round = 0;
let askCount = 0;
let shakeAmp = 0;
let shakePulse = 0;
let vapor = 0;

let questionText = "Loading...";
let uiQuestion, uiMeta, btnThink, btnAI, btnRestart;

let brain;
let liquid;
let finished = false;

let wordPool = [];
let netWords = [];

let net = {
  cols: 32,
  rows: 18,
  marginX: 28,
  marginY: 28,
  fontSize: 12,
  wordAlpha: 195,
  lineAlpha: 26,
  diagonals: true
};

let netLayer;
let netDirty = true;
let netTick = 0;

let liquidLayer;

// anti-repeat (front-end side)
let recentQuestions = [];
const RECENT_Q_MAX = 18;

// stable per page load
const SESSION_ID = (Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 18);

// Only used if API fails
const FALLBACK_PROMPTS = [
  "You’ve written a Chinese abstract for your project. Translate it into English (150–180 words) and polish the tone to sound academic but natural.",
  "Your tutor says this paragraph is vague. Rewrite it to be more specific, add 1 concrete example, and keep it under 120 words.",
  "You need to email a professor about a deadline extension. Rewrite it to sound polite and confident (under 110 words), keeping the key facts unchanged.",
  "You have messy lecture notes. Turn them into a clean outline with 3 headings and 6 bullet points you can paste into slides.",
  "Your poster layout feels empty. Suggest 6 composition/hierarchy changes to make it richer without clutter, and justify the top 2 choices in one sentence each.",
  "A p5.js sketch stutters on your laptop. Identify 3 likely causes and propose one minimal fix to try first, with a short explanation."
];

function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

function isTooSimilar(q) {
  const a = q.toLowerCase();
  for (const old of recentQuestions) {
    const b = old.toLowerCase();
    const aWords = new Set(a.split(/\W+/).filter(w => w.length >= 5));
    const bWords = new Set(b.split(/\W+/).filter(w => w.length >= 5));
    if (aWords.size === 0 || bWords.size === 0) continue;
    let inter = 0;
    for (const w of aWords) if (bWords.has(w)) inter++;
    const overlap = inter / Math.max(1, Math.min(aWords.size, bWords.size));
    if (overlap > 0.55) return true;
  }
  return false;
}

function sanitizePrompt(q) {
  if (!q) return "";
  let s = String(q).replace(/\s+/g, " ").trim();
  s = s.replace(/^["'“”]+|["'“”]+$/g, "").trim();
  s = s.replace(/^round\s*\d+\s*[:：\-]\s*/i, "").trim();
  s = s.replace(/(\.\.\.|…)\s*$/g, "").trim();
  if (s && !/[.!?。！？]$/.test(s)) s += ".";
  return s;
}

/* =========================
   STATE: cover / quiz / done
   ========================= */
let MODE = "cover"; // "cover" | "quiz" | "done"

/* =========================
   HUD SAFE ZONE + AUTO FIT
   ========================= */
function applyHudSafeZone() {
  const hud = document.getElementById("hud");
  if (!hud || !uiQuestion) return;

  const safeH = Math.min(Math.floor(window.innerHeight * 0.18), 180);
  const sidePad = 24;
  const bottomPad = 14;

  hud.style.position = "absolute";
  hud.style.left = sidePad + "px";
  hud.style.right = sidePad + "px";
  hud.style.bottom = bottomPad + "px";
  hud.style.height = safeH + "px";
  hud.style.pointerEvents = "none";
  hud.style.display = "flex";
  hud.style.flexDirection = "column";
  hud.style.justifyContent = "flex-end";
  hud.style.gap = "10px";
  hud.style.color = "#fff";

  uiQuestion.style.whiteSpace = "pre-wrap";
  uiQuestion.style.wordBreak = "break-word";
  uiQuestion.style.overflow = "hidden";
  uiQuestion.style.maxHeight = "100%";

  const metaH = uiMeta ? Math.ceil(uiMeta.getBoundingClientRect().height) : 0;
  const controls = document.getElementById("controls");
  const controlsH = controls ? Math.ceil(controls.getBoundingClientRect().height) : 0;
  const reserve = metaH + controlsH + 16;

  const qMax = Math.max(72, safeH - reserve);
  uiQuestion.style.maxHeight = qMax + "px";
}

function fitQuestionFont() {
  if (!uiQuestion) return;
  applyHudSafeZone();

  const el = uiQuestion;
  const MAX_PX = 30;
  const MIN_PX = 15;

  let size = MAX_PX;
  el.style.fontSize = size + "px";
  el.style.lineHeight = "1.18";

  for (let i = 0; i < 40; i++) {
    if (el.scrollHeight <= el.clientHeight + 1) break;
    size -= 1;
    if (size <= MIN_PX) { size = MIN_PX; el.style.fontSize = size + "px"; break; }
    el.style.fontSize = size + "px";
  }
}

/* Prevent double/overlapping async nextRound calls */
let _reqSeq = 0;
let _inFlight = false;

/* =========================
   PUBLIC STATS (Histogram)
   ========================= */
let publicStats = null; // { total, buckets[] }

async function submitResultAndFetchStats() {
  const pct = Math.round((askCount / totalRounds) * 100);

  try {
    await fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rate: pct })
    });
  } catch {}

  try {
    const r = await fetch("/api/stats", { cache: "no-store" });
    publicStats = await r.json();
  } catch {
    publicStats = null;
  }
}

/* =========================
   COVER STATS BOX (NEW)
   ========================= */
function formatBandLabel(i) {
  const lo = i * 10;
  const hi = (i === 9) ? 100 : (i * 10 + 9);
  return `${lo}–${hi}%`;
}

async function updateCoverStats() {
  const elMost = document.getElementById("cover-most");
  const elTotal = document.getElementById("cover-total");
  const elHint = document.getElementById("cover-hint");

  // 如果你 index.html 还没加这些 id，也不会报错
  if (!elMost && !elTotal && !elHint) return;

  if (elMost) elMost.textContent = "Loading…";
  if (elTotal) elTotal.textContent = "Loading…";
  if (elHint) elHint.textContent = "Pulling the latest public summary…";

  try {
    const r = await fetch("/api/stats", { cache: "no-store" });
    const data = await r.json();

    const total = Number(data?.total || 0);
    const buckets = Array.isArray(data?.buckets) ? data.buckets : new Array(10).fill(0);

    let bestIdx = 0;
    let bestVal = -1;
    for (let i = 0; i < 10; i++) {
      const v = Number(buckets[i] || 0);
      if (v > bestVal) { bestVal = v; bestIdx = i; }
    }

    const band = formatBandLabel(bestIdx);

    if (elMost) elMost.textContent = total > 0 ? band : "—";
    if (elTotal) elTotal.textContent = String(total);

    if (elHint) {
      elHint.textContent = total > 0
        ? "This reflects aggregated, anonymous runs."
        : "No public runs yet — be the first.";
    }
  } catch {
    if (elMost) elMost.textContent = "—";
    if (elTotal) elTotal.textContent = "—";
    if (elHint) elHint.textContent = "Couldn’t load public summary (server not responding).";
  }
}

/* =========================
   COVER wiring
   ========================= */
function showCover() {
  MODE = "cover";
  finished = false;

  const cover = document.getElementById("cover");
  const hud = document.getElementById("hud");
  if (cover) cover.style.display = "flex";
  if (hud) hud.style.display = "none";

  // stop quiz buttons
  if (btnThink) btnThink.disabled = true;
  if (btnAI) btnAI.disabled = true;
  if (btnRestart) btnRestart.style.display = "none";

  // reset stats cache
  publicStats = null;

  // ✅ refresh cover stats box
  updateCoverStats();

  // word background only
  initCoverWordPool();
  reseedNetWords();
  netDirty = true;
}

function startQuiz() {
  MODE = "quiz";

  const cover = document.getElementById("cover");
  const hud = document.getElementById("hud");
  if (cover) cover.style.display = "none";
  if (hud) hud.style.display = "flex";

  // init brain only now (prevents cover lag)
  if (!brain) {
    brain = new BrainShape(
      width * 0.5,
      height * 0.5,
      Math.min(width * 0.52, 760),
      Math.min(height * 0.55, 540)
    );
    liquid = new LiquidBrain(brain);

    liquidLayer = createGraphics(windowWidth, windowHeight);
    liquidLayer.pixelDensity(1);
  } else {
    brain.relocate(
      width * 0.5,
      height * 0.5,
      Math.min(width * 0.52, 760),
      Math.min(height * 0.55, 540)
    );
    liquid.relocate(brain);
  }

  restartSession();
}

/* =========================
   COVER word pool (local, fast)
   ========================= */
function initCoverWordPool() {
  const base = [
    "ask","think","choose","prompt","rewrite","summarize","translate","outline","debug",
    "tone","clarify","evidence","structure","draft","revise","concept","design","hierarchy",
    "method","argument","counter","examples","thesis","notes","email","poster","critique",
    "polish","refine","focus","iterate","evaluate","compose","improve","constraints","format"
  ];

  const merged = [];
  for (let i = 0; i < 60; i++) merged.push(base[i % base.length]);
  wordPool = merged;
}

/* =========================
   SETUP
   ========================= */
function setup() {
  createCanvas(windowWidth, windowHeight);
  frameRate(60);
  textFont("ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace");

  uiQuestion = document.getElementById("question");
  uiMeta = document.getElementById("meta");
  btnThink = document.getElementById("btn-think");
  btnAI = document.getElementById("btn-ai");
  btnRestart = document.getElementById("btn-restart");

  btnThink.onclick = () => choose(false);
  btnAI.onclick = () => choose(true);
  btnRestart.onclick = () => {
    // restart should go back to cover (as you requested)
    showCover();
  };

  // Start button on cover
  const btnStart = document.getElementById("btn-start");
  if (btnStart) btnStart.onclick = () => startQuiz();

  // word net graphics
  netLayer = createGraphics(windowWidth, windowHeight);
  netLayer.pixelDensity(1);

  // start in cover mode
  showCover();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);

  netLayer = createGraphics(windowWidth, windowHeight);
  netLayer.pixelDensity(1);
  netDirty = true;

  if (brain && liquid) {
    brain.relocate(
      width * 0.5,
      height * 0.5,
      Math.min(width * 0.52, 760),
      Math.min(height * 0.55, 540)
    );
    liquid.relocate(brain);

    liquidLayer = createGraphics(windowWidth, windowHeight);
    liquidLayer.pixelDensity(1);
  }

  if (MODE === "quiz") fitQuestionFont();
}

/* =========================
   DRAW
   ========================= */
function draw() {
  background(0);

  // always draw interactive word background
  netTick++;
  if (netDirty || netTick % 2 === 0) {
    renderWordNetToLayer(netLayer);
    netDirty = false;
  }
  image(netLayer, 0, 0);

  // quiz visuals only in quiz/done
  if (MODE !== "cover" && brain && liquid) {
    brain.updateDebris();
    liquid.update();

    let sx = 0, sy = 0;
    const amp = shakeAmp + shakePulse;
    if (amp > 0.001) {
      sx = (noise(frameCount * 0.08) - 0.5) * amp;
      sy = (noise(999 + frameCount * 0.08) - 0.5) * amp;
    }
    shakePulse *= 0.88;
    shakeAmp *= 0.995;
    vapor *= 0.99;

    liquid.renderToLayer(liquidLayer);

    push();
    translate(sx, sy);

    image(liquidLayer, 0, 0);
    liquid.drawOutlineOnMain();

    blendMode(BLEND);
    noTint();
    drawingContext.globalAlpha = 1;
    brain.drawFill();

    blendMode(BLEND);
    drawGlitchOverlay();
    pop();

    brain.drawDebris();

    if (finished) {
      drawEndOverlayFixed();
      drawPublicHistogramPanel();
    }
  }
}

/* =========================
   QUIZ FLOW
   ========================= */
function restartSession() {
  round = 0;
  askCount = 0;
  shakeAmp = 0;
  shakePulse = 0;
  vapor = 0;
  finished = false;

  recentQuestions = [];
  _reqSeq = 0;
  _inFlight = false;

  publicStats = null;

  brain.reset();
  liquid.reset();

  btnRestart.style.display = "none";
  btnThink.disabled = true;
  btnAI.disabled = true;

  uiQuestion.innerText = "Starting…";
  uiMeta.innerText = "";
  fitQuestionFont();

  nextRound();
}

async function nextRound() {
  if (finished) return;
  if (_inFlight) return;
  _inFlight = true;

  const mySeq = ++_reqSeq;
  round++;

  if (round > totalRounds) {
    finished = true;
    MODE = "done";

    btnThink.disabled = true;
    btnAI.disabled = true;
    btnRestart.style.display = "inline-block";

    uiMeta.innerText = `Round ${totalRounds}/${totalRounds} — AskAI: ${askCount}`;

    await submitResultAndFetchStats();

    _inFlight = false;
    return;
  }

  uiQuestion.innerText = `Round ${round}:\nGenerating…`;
  uiMeta.innerText = `Round ${round}/${totalRounds} — AskAI: ${askCount}`;
  btnThink.disabled = true;
  btnAI.disabled = true;
  fitQuestionFont();

  let q = "";
  try {
    const avoid = encodeURIComponent(recentQuestions.slice(-10).join(" || "));
    const qRes = await fetch(
      `/api/question?round=${round}&avoid=${avoid}&session=${SESSION_ID}&rand=${Math.random()}`,
      { cache: "no-store" }
    );
    const qData = await qRes.json();
    if (mySeq !== _reqSeq) { _inFlight = false; return; }
    if (qData && qData.question) q = sanitizePrompt(qData.question);
  } catch {}

  if (!q || q.length < 20) q = sanitizePrompt(pick(FALLBACK_PROMPTS));
  if (isTooSimilar(q)) q = sanitizePrompt(pick(FALLBACK_PROMPTS));

  questionText = q;
  uiQuestion.innerText = `Round ${round}:\n${questionText}`;

  recentQuestions.push(questionText);
  if (recentQuestions.length > RECENT_Q_MAX) recentQuestions.shift();

  refreshWordPoolLocalFromQuestion(questionText);
  reseedNetWords();
  netDirty = true;

  uiMeta.innerText = `Round ${round}/${totalRounds} — AskAI: ${askCount}`;
  fitQuestionFont();

  btnThink.disabled = false;
  btnAI.disabled = false;
  _inFlight = false;
}

function choose(useAI) {
  if (finished) return;
  if (_inFlight) return;

  if (useAI) {
    askCount++;

    shakePulse = 18 + askCount * 2.5;
    shakeAmp += 6 + askCount * 1.3;
    vapor += 0.35;

    brain.addDose(1);

    const base = 80 + askCount * 14;
    const jitter = (Math.random() * 40) | 0;
    const n = Math.max(80, Math.min(160, base + jitter));
    brain.dropFromBrain(n);

    const level = askCount / totalRounds;
    liquid.setLevelTarget(level);
    liquid.kickStorm(1.2 + askCount * 0.16);
    liquid.splash();
    liquid.shiftColor();
  }

  nextRound();
}

/* =========================
   WORD POOL (fast local)
   ========================= */
function refreshWordPoolLocalFromQuestion(fromQuestionText) {
  const qWords = String(fromQuestionText || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter(w => w.length >= 3 && w.length <= 14);

  const base = [
    "rewrite","summarize","translate","plan","explain","debug","outline","polish","clarify",
    "academic","evidence","argument","method","critique","examples","structure","ethics",
    "limitations","counterargument","definition","hypothesis","design","poster","email","notes"
  ];

  const seen = new Set();
  const merged = [];

  for (const w of qWords) {
    if (!w || seen.has(w)) continue;
    seen.add(w);
    merged.push(w);
  }

  for (let i = 0; i < base.length; i++) {
    const w = base[i];
    if (seen.has(w)) continue;
    seen.add(w);
    merged.push(w);
  }

  wordPool = merged;

  const need = net.cols * net.rows;
  while (wordPool.length < need) {
    wordPool = wordPool.concat(merged);
  }
}

function reseedNetWords() {
  const totalCells = net.cols * net.rows;
  const pool = wordPool.slice();
  shuffleInPlace(pool);

  netWords = new Array(totalCells);
  for (let i = 0; i < totalCells; i++) {
    if (i >= pool.length) {
      const extra = wordPool.slice();
      shuffleInPlace(extra);
      pool.push(...extra);
    }
    const w = pool[i] || "";
    netWords[i] = (w.length > 12) ? w.slice(0, 12) : w;
  }
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
}

/* =========================
   WORD NET RENDER
   ========================= */
function renderWordNetToLayer(g) {
  g.clear();
  if (!netWords || netWords.length === 0) return;

  const x0 = net.marginX;
  const y0 = net.marginY;
  const x1 = g.width - net.marginX;
  const y1 = g.height - net.marginY;

  const cellW = (x1 - x0) / (net.cols - 1);
  const cellH = (y1 - y0) / (net.rows - 1);

  const pts = [];

  const baseAmp = 2.4;
  const addAmp = (vapor * 3.2 + shakePulse * 0.03);
  const amp = baseAmp + addAmp;

  const driftSpeed = 0.014;
  const rotSpeed = 0.010;
  const pulseSpeed = 0.020;

  const tt = frameCount * 0.02;
  const waveA = 10 + vapor * 12;
  const waveB = 8 + vapor * 10;

  for (let r = 0; r < net.rows; r++) {
    for (let c = 0; c < net.cols; c++) {
      const idx = r * net.cols + c;

      const bx = x0 + c * cellW;
      const by = y0 + r * cellH;

      const n1 = noise(idx * 0.17, frameCount * driftSpeed);
      const n2 = noise(999 + idx * 0.17, frameCount * driftSpeed);

      const dxLocal = (n1 - 0.5) * amp * 6.0;
      const dyLocal = (n2 - 0.5) * amp * 5.2;

      const phase = c * 0.30 + r * 0.22;
      const dxWave = sin(tt + phase) * waveA;
      const dyWave = cos(tt * 0.9 + phase) * waveB;

      const rot = (noise(222 + idx * 0.11, frameCount * rotSpeed) - 0.5) * 0.16 * (0.6 + vapor);

      pts.push({ x: bx + dxLocal + dxWave, y: by + dyLocal + dyWave, word: netWords[idx] || "", rot, idx });
    }
  }

  g.stroke(255, net.lineAlpha + vapor * 55);
  g.strokeWeight(1);

  for (let r = 0; r < net.rows; r++) {
    for (let c = 0; c < net.cols; c++) {
      const idx = r * net.cols + c;
      const p = pts[idx];
      if (c < net.cols - 1) g.line(p.x, p.y, pts[idx + 1].x, pts[idx + 1].y);
      if (r < net.rows - 1) g.line(p.x, p.y, pts[idx + net.cols].x, pts[idx + net.cols].y);
    }
  }

  if (net.diagonals) {
    g.stroke(255, 10 + vapor * 22);
    for (let r = 0; r < net.rows - 1; r++) {
      for (let c = 0; c < net.cols - 1; c++) {
        const idx = r * net.cols + c;
        g.line(pts[idx].x, pts[idx].y, pts[idx + net.cols + 1].x, pts[idx + net.cols + 1].y);
      }
    }
  }

  g.textSize(net.fontSize);
  g.textAlign(CENTER, CENTER);
  g.noStroke();

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const pulse = 0.65 + 0.35 * sin(frameCount * pulseSpeed + p.idx * 0.35);
    const a = net.wordAlpha * pulse;

    g.push();
    g.translate(p.x, p.y);
    g.rotate(p.rot);
    g.fill(255, a);
    g.text(p.word, 0, 0);
    g.pop();
  }
}

/* =========================
   Overlays + Result + Chart
   ========================= */
function drawGlitchOverlay() {
  if (askCount <= 0) return;
  const strength = constrain(askCount / totalRounds, 0, 1);
  const lines = floor(3 + strength * 14);

  noStroke();
  for (let i = 0; i < lines; i++) {
    const y = random(height);
    const h = random(2, 6);
    const a = 8 + strength * 20;
    fill(255, a);
    rect(0, y, width, h);
  }
}

function drawEndOverlayFixed() {
  const rate = askCount / totalRounds;
  const pct = Math.round(rate * 100);

  const pad = 22;
  const boxW = Math.min(520, width - pad * 2);
  const boxH = 118;

  push();
  noStroke();
  fill(0, 220);
  rect(pad, pad, boxW, boxH, 18);

  fill(255);
  textAlign(LEFT, TOP);
  textSize(34);
  text(`AI Addiction Rate: ${pct}%`, pad + 18, pad + 14);

  textSize(14);
  fill(255, 200);
  text(`Ask AI ${askCount}/${totalRounds}`, pad + 18, pad + 62);

  textSize(12);
  fill(255, 160);
  text(`Restart returns to cover`, pad + 18, pad + 84);

  pop();
}

function drawPublicHistogramPanel() {
  if (!publicStats || !publicStats.buckets) return;

  const pad = 22;
  const panelW = Math.min(320, Math.max(240, width * 0.18));
  const panelH = Math.min(320, Math.max(220, height * 0.32));
  const x = pad;
  const y = height * 0.22;
  const r = 16;

  push();
  noStroke();
  fill(0, 200);
  rect(x, y, panelW, panelH, r);

  fill(255);
  textAlign(LEFT, TOP);
  textSize(14);
  text("Public Addiction Distribution", x + 14, y + 12);

  textSize(11);
  fill(255, 160);
  text(`Samples: ${publicStats.total || 0}`, x + 14, y + 30);

  const buckets = publicStats.buckets.slice(0, 10);
  const maxV = Math.max(1, ...buckets);

  const chartX = x + 14;
  const chartY = y + 56;
  const chartW = panelW - 28;
  const chartH = panelH - 70;

  stroke(255, 80);
  strokeWeight(1);
  line(chartX, chartY + chartH, chartX + chartW, chartY + chartH);

  noStroke();
  const barGap = 6;
  const barW = (chartW - barGap * 9) / 10;

  for (let i = 0; i < 10; i++) {
    const v = buckets[i];
    const h = (v / maxV) * (chartH - 6);
    const bx = chartX + i * (barW + barGap);
    const by = chartY + chartH - h;

    fill(255, 190);
    rect(bx, by, barW, h, 6);

    if (i % 2 === 0) {
      fill(255, 120);
      textSize(9);
      textAlign(CENTER, TOP);
      text(`${i * 10}`, bx + barW / 2, chartY + chartH + 4);
    }
  }

  pop();
}

/* =========================
   LIQUID + BRAIN
   ========================= */
class LiquidBrain {
  constructor(brainRef) {
    this.brain = brainRef;

    this.cols = 220;
    this.h = new Array(this.cols).fill(0);
    this.v = new Array(this.cols).fill(0);

    this.level = 0.0;
    this.levelTarget = 0.0;

    this.storm = 0.0;
    this.stormTarget = 0.0;

    this.t = 0;
    this.hue = 200;
    this.hueTarget = 200;

    this._rebuildBounds();
  }

  relocate(brainRef) { this.brain = brainRef; this._rebuildBounds(); }

  reset() {
    this.h.fill(0);
    this.v.fill(0);
    this.level = 0;
    this.levelTarget = 0;
    this.storm = 0;
    this.stormTarget = 0;
    this.t = 0;
    this.hue = 200;
    this.hueTarget = 200;
    this._rebuildBounds();
  }

  _rebuildBounds() {
    const pts = this.brain.outlinePts;

    if (!pts || pts.length === 0) {
      this.left = this.brain.cx - this.brain.w * 0.55;
      this.right = this.brain.cx + this.brain.w * 0.55;
      this.top = this.brain.cy - this.brain.h * 0.52;
      this.bottom = this.brain.cy + this.brain.h * 0.55;
    } else {
      let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
      for (const p of pts) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
      const s = this.brain.getBreathScale();
      this.left = this.brain.cx + minX * s;
      this.right = this.brain.cx + maxX * s;
      this.top = this.brain.cy + minY * s;
      this.bottom = this.brain.cy + maxY * s;
    }

    this.width = this.right - this.left;
    this.height = this.bottom - this.top;
  }

  setLevelTarget(x01) { this.levelTarget = constrain(x01, 0, 1); }
  kickStorm(amount) { this.stormTarget = min(5.0, this.stormTarget + amount); }

  splash() {
    const idx = (Math.random() * this.cols) | 0;
    const amp = 18 + this.stormTarget * 10;
    this.v[idx] -= amp;
    if (idx > 0) this.v[idx - 1] -= amp * 0.6;
    if (idx < this.cols - 1) this.v[idx + 1] -= amp * 0.6;
  }

  shiftColor() {
    const jump = 60 + Math.random() * 220;
    this.hueTarget = (this.hueTarget + jump) % 360;
  }

  update() {
    this._rebuildBounds();

    this.level = lerp(this.level, this.levelTarget, 0.03);

    this.stormTarget *= 0.935;
    this.storm = lerp(this.storm, this.stormTarget, 0.07);

    this.hue = lerpHue(this.hue, this.hueTarget, 0.05);

    const k = 0.022 + this.storm * 0.014;
    const damp = 0.90 - this.storm * 0.03;
    const spread = 0.18 + this.storm * 0.10;

    for (let i = 0; i < this.cols; i++) {
      this.v[i] += (-this.h[i]) * k;
      const n = noise(i * 0.07, this.t * 0.016);
      this.v[i] += (n - 0.5) * (0.85 + this.storm * 1.0);
      this.v[i] *= damp;
      this.h[i] += this.v[i];
    }

    for (let iter = 0; iter < 2; iter++) {
      for (let i = 0; i < this.cols; i++) {
        const left = i > 0 ? this.h[i - 1] : this.h[i];
        const right = i < this.cols - 1 ? this.h[i + 1] : this.h[i];
        this.v[i] += (left + right - 2 * this.h[i]) * spread * 0.14;
      }
    }

    this.t++;
  }

  renderToLayer(g) {
    g.clear();
    this._rebuildBounds();

    const waterTopBase = this.bottom - this.level * this.height;
    const dx = this.width / (this.cols - 1);

    g.push();
    g.colorMode(HSB, 360, 100, 100, 255);
    g.noStroke();

    const sat = 78;
    const bri = 88;
    const alphaBody = 170;

    for (let i = 0; i < this.cols; i++) {
      const x = this.left + i * dx;
      const wave = this.h[i];
      const yTop = waterTopBase + wave;

      const depth = constrain((this.bottom - yTop) / max(1, this.height), 0, 1);
      const hue = (this.hue + depth * 35 + noise(i * 0.08, this.t * 0.01) * 18) % 360;
      const a = alphaBody + depth * 25;

      g.fill(hue, sat, bri, a);
      g.rect(x - dx * 0.55, yTop, dx * 1.1, this.bottom - yTop);
    }

    g.noFill();
    g.stroke((this.hue + 20) % 360, 35, 98, 190);
    g.strokeWeight(2);

    g.beginShape();
    for (let i = 0; i < this.cols; i++) {
      const x = this.left + i * dx;
      const y = waterTopBase + this.h[i];
      g.vertex(x, y);
    }
    g.endShape();

    g.pop();

    const ctx = g.drawingContext;
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";

    g.push();
    g.noStroke();
    g.fill(255, 255, 255, 255);

    const s = this.brain.getBreathScale();
    g.translate(this.brain.cx, this.brain.cy);
    g.scale(s);

    g.beginShape();
    for (const p of this.brain.outlinePts) g.vertex(p.x, p.y);
    g.endShape(CLOSE);

    g.pop();
    ctx.restore();
  }

  drawOutlineOnMain() {
    const s = this.brain.getBreathScale();
    push();
    translate(this.brain.cx, this.brain.cy);
    scale(s);

    noFill();

    stroke(255, 150);
    strokeWeight(2);
    beginShape();
    for (const p of this.brain.outlinePts) vertex(p.x * 0.996, p.y * 0.996);
    endShape(CLOSE);

    stroke(255, 70);
    strokeWeight(1);
    beginShape();
    for (const p of this.brain.outlinePts) vertex(p.x * 0.985, p.y * 0.985);
    endShape(CLOSE);

    pop();
  }
}

function lerpHue(a, b, t) {
  let d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

class BrainShape {
  constructor(cx, cy, w, h) {
    this.cx = cx; this.cy = cy;
    this.w = w; this.h = h;

    this.fillLevel = 0;
    this.targetFill = 0;
    this.doses = 0;

    this.brainTex = null;
    this.brainMaskTex = null;

    this.dynTex = null;
    this.dynMask = null;
    this.dynBase = null;

    this.glyphPoints = [];
    this.alive = [];

    this.debris = [];
    this.maxDebris = 900;

    this.cutScale = 4.2;
    this.outlinePts = [];

    this.buildBrainTexture();
    this.resetDynamicLayers();
    this.buildOutline();
  }

  relocate(cx, cy, w, h) {
    this.cx = cx; this.cy = cy;
    this.w = w; this.h = h;
    this.buildBrainTexture();
    this.resetDynamicLayers();
    this.buildOutline();
  }

  reset() {
    this.fillLevel = 0;
    this.targetFill = 0;
    this.doses = 0;
    this.debris = [];
    this.resetDynamicLayers();
  }

  addDose(n) {
    this.doses += n;
    this.targetFill = constrain(this.doses / totalRounds, 0, 1);
  }

  getBreathScale() {
    const rate = constrain(askCount / totalRounds, 0, 1);
    const breathAmp = 0.010 + rate * 0.004;
    const breathSpeed = 0.017 + rate * 0.008;
    const b = 0.5 + 0.5 * sin(frameCount * breathSpeed);
    return 1.0 + (b - 0.5) * 2.0 * breathAmp;
  }

  dropFromBrain(n) {
    const candidates = [];
    for (let i = 0; i < this.alive.length; i++) if (this.alive[i]) candidates.push(i);
    if (!candidates.length) return;

    const s = this.getBreathScale();
    const rate = constrain(askCount / totalRounds, 0, 1);

    for (let k = 0; k < n; k++) {
      if (!candidates.length) break;

      const pickIdx = (Math.random() * candidates.length) | 0;
      const gi = candidates[pickIdx];
      candidates[pickIdx] = candidates[candidates.length - 1];
      candidates.pop();

      this.alive[gi] = false;
      const gp = this.glyphPoints[gi];

      const cut = gp.tile * this.cutScale;

      const img = this.getMaskedPatch(gp.gx, gp.gy, cut);
      if (!img) continue;

      this.punchHole(gp.gx, gp.gy, cut);

      const x = this.cx + gp.dx * s;
      const y = this.cy + gp.dy * s;

      this.debris.push({
        x, y,
        vx: random(-2.4, 2.4),
        vy: random(1.0, 2.9) + rate * 0.8,
        a: random(TWO_PI),
        av: random(-0.12, 0.12),
        img,
        w: cut,
        h: cut,
        rest: 0.58 + random(0, 0.12),
        sleep: false,
        sleepCount: 0
      });
    }

    if (this.debris.length > this.maxDebris) {
      this.debris.splice(0, this.debris.length - this.maxDebris);
    }
  }

  getMaskedPatch(gx, gy, size) {
    const x = Math.floor(gx - size * 0.5);
    const y = Math.floor(gy - size * 0.5);

    const sx = Math.max(0, Math.min(this.dynTex.width - size, x));
    const sy = Math.max(0, Math.min(this.dynTex.height - size, y));

    const patch = this.dynTex.get(sx, sy, size, size);
    const mask = this.dynMask.get(sx, sy, size, size);
    patch.mask(mask);
    return patch;
  }

  punchHole(gx, gy, cut) {
    const x = gx - cut * 0.5;
    const y = gy - cut * 0.5;

    const ctx1 = this.dynTex.drawingContext;
    ctx1.save();
    ctx1.globalCompositeOperation = "destination-out";
    this.dynTex.noStroke();
    this.dynTex.fill(0, 255);
    this.dynTex.rect(x, y, cut, cut);
    ctx1.restore();

    const ctx2 = this.dynMask.drawingContext;
    ctx2.save();
    ctx2.globalCompositeOperation = "destination-out";
    this.dynMask.noStroke();
    this.dynMask.fill(0, 255);
    this.dynMask.rect(x, y, cut, cut);
    ctx2.restore();

    const ctx3 = this.dynBase.drawingContext;
    ctx3.save();
    ctx3.globalCompositeOperation = "destination-out";
    this.dynBase.noStroke();
    this.dynBase.fill(0, 255);
    this.dynBase.rect(x, y, cut, cut);
    ctx3.restore();
  }

  updateDebris() {
    const g = 0.42;
    const air = 0.992;
    const floorFric = 0.82;

    for (const d of this.debris) {
      if (d.sleep) continue;

      d.vy += g;
      d.vx *= air;
      d.vy *= air;

      d.x += d.vx;
      d.y += d.vy;
      d.a += d.av;

      const r = Math.max(d.w, d.h) * 0.5;

      if (d.x < r) { d.x = r; d.vx = Math.abs(d.vx) * d.rest; d.av *= 0.75; }
      if (d.x > width - r) { d.x = width - r; d.vx = -Math.abs(d.vx) * d.rest; d.av *= 0.75; }

      if (d.y < r) { d.y = r; d.vy = Math.abs(d.vy) * d.rest; d.av *= 0.75; }
      if (d.y > height - r) {
        d.y = height - r;
        d.vy = -Math.abs(d.vy) * d.rest;
        d.vx *= floorFric;
        d.av *= 0.65;
      }

      const speed = Math.abs(d.vx) + Math.abs(d.vy) + Math.abs(d.av) * 10;
      if (d.y > height - r - 2 && speed < 0.18) {
        d.sleepCount++;
        if (d.sleepCount > 40) {
          d.sleep = true;
          d.vx = d.vy = d.av = 0;
        }
      } else d.sleepCount = 0;
    }
  }

  drawDebris() {
    if (!this.debris.length) return;

    push();
    imageMode(CENTER);

    for (const d of this.debris) {
      push();
      translate(d.x, d.y);
      rotate(d.a);
      image(d.img, 0, 0, d.w, d.h);
      pop();
    }
    pop();
  }

  resetDynamicLayers() {
    const bw = this.brainTex.width;
    const bh = this.brainTex.height;

    this.dynTex = createGraphics(bw, bh);
    this.dynTex.pixelDensity(1);
    this.dynTex.clear();
    this.dynTex.image(this.brainTex, 0, 0);

    this.dynMask = createGraphics(bw, bh);
    this.dynMask.pixelDensity(1);
    this.dynMask.clear();
    this.dynMask.image(this.brainMaskTex, 0, 0);

    this.dynBase = createGraphics(bw, bh);
    this.dynBase.pixelDensity(1);
    this.dynBase.clear();

    this.dynBase.noStroke();
    this.dynBase.fill(0, 255);
    this.dynBase.rect(0, 0, bw, bh);

    const ctx = this.dynBase.drawingContext;
    ctx.save();
    ctx.globalCompositeOperation = "destination-in";
    this.dynBase.image(this.brainMaskTex, 0, 0);
    ctx.restore();

    this.alive = new Array(this.glyphPoints.length).fill(true);
  }

  drawFill() {
    this.fillLevel = lerp(this.fillLevel, this.targetFill, 0.06);

    push();
    translate(this.cx, this.cy);
    scale(this.getBreathScale());
    imageMode(CENTER);

    blendMode(BLEND);
    image(this.dynBase, 0, 0);
    image(this.dynTex, 0, 0);

    blendMode(ADD);
    tint(255, 25);
    image(this.dynTex, 0, 0);
    noTint();
    blendMode(BLEND);

    pop();
  }

  isInsideBrainLocal(dx, dy) {
    const x = dx / (this.w * 0.55);
    const y = dy / (this.h * 0.55);

    const base = (x*x) / (1.05*1.05) + (y*y) / (0.82*0.82);

    const xl = x + 0.55;
    const xr = x - 0.55;
    const lobeL = (xl*xl)/(0.65*0.65) + (y*y)/(0.95*0.95);
    const lobeR = (xr*xr)/(0.65*0.65) + (y*y)/(0.95*0.95);

    const topWaves = 0.10 * (1.0 - constrain((y + 0.2) / 1.2, 0, 1));
    const bumps = sin((x + 1.0) * 6.2) * topWaves + sin((x + 0.3) * 11.0) * (topWaves * 0.6);
    const threshold = 1.0 + bumps * (y < 0 ? 1 : 0);

    const bottomCut = (y > 0.95);

    const inside = (base < threshold) || (lobeL < 1.0) || (lobeR < 1.0);
    return inside && !bottomCut;
  }

  isInsideBrain(px, py) { return this.isInsideBrainLocal(px - this.cx, py - this.cy); }

  buildOutline() {
    this.outlinePts = [];
    const steps = 220;
    const rMax = Math.max(this.w, this.h) * 0.9;

    for (let i = 0; i < steps; i++) {
      const ang = (TWO_PI * i) / steps;
      let lo = 0;
      let hi = rMax;

      for (let it = 0; it < 18; it++) {
        const mid = (lo + hi) * 0.5;
        const dx = Math.cos(ang) * mid;
        const dy = Math.sin(ang) * mid;
        if (this.isInsideBrainLocal(dx, dy)) lo = mid;
        else hi = mid;
      }

      const r = lo;
      this.outlinePts.push({ x: Math.cos(ang) * r, y: Math.sin(ang) * r });
    }
  }

  buildBrainTexture() {
    const bw = Math.floor(this.w * 1.35);
    const bh = Math.floor(this.h * 1.25);

    this.brainTex = createGraphics(bw, bh);
    this.brainTex.pixelDensity(1);
    this.brainTex.clear();
    this.brainTex.textAlign(CENTER, CENTER);
    this.brainTex.textSize(10);

    this.brainMaskTex = createGraphics(bw, bh);
    this.brainMaskTex.pixelDensity(1);
    this.brainMaskTex.clear();

    const cx = bw / 2;
    const cy = bh / 2;

    this.brainMaskTex.noStroke();
    this.brainMaskTex.fill(0, 255);
    const maskStep = 6;

    for (let yy = -bh * 0.5; yy <= bh * 0.5; yy += maskStep) {
      for (let xx = -bw * 0.5; xx <= bw * 0.5; xx += maskStep) {
        const px = this.cx + xx;
        const py = this.cy + yy;
        if (!this.isInsideBrain(px, py)) continue;
        this.brainMaskTex.rect(cx + xx, cy + yy, maskStep + 1, maskStep + 1);
      }
    }

    this.glyphPoints = [];
    this.brainTex.blendMode(ADD);

    const step = 7;
    const tile = 7;

    for (let yy = -bh * 0.5; yy <= bh * 0.5; yy += step) {
      for (let xx = -bw * 0.5; xx <= bw * 0.5; xx += step) {
        const px = this.cx + xx;
        const py = this.cy + yy;
        if (!this.isInsideBrain(px, py)) continue;

        const nx = xx / (bw * 0.5);
        const ny = yy / (bh * 0.5);
        const ff = faceField(nx * 1.05, ny * 1.05);

        const baseHue = (noise(xx * 0.012, yy * 0.012) * 360 + (xx + yy) * 0.08) % 360;
        const hue = (baseHue + ff * 70) % 360;

        this.brainTex.colorMode(HSB, 360, 100, 100, 100);
        this.brainTex.fill(hue, 100, 100, 92 + ff * 8);
        this.brainTex.fill((hue + 18) % 360, 100, 100, 55);
        this.brainTex.colorMode(RGB, 255);

        const gch = ff > 0.35 ? pickFaceGlyph(xx, yy) : pickGlyph(xx, yy);
        const rot = (noise(xx * 0.03, yy * 0.03) - 0.5) * 0.5;

        const gx = cx + xx;
        const gy = cy + yy;

        this.brainTex.push();
        this.brainTex.translate(gx, gy);
        this.brainTex.rotate(rot);
        this.brainTex.text(gch, 0, 0);
        this.brainTex.pop();

        this.glyphPoints.push({ dx: xx, dy: yy, gx, gy, tile });
      }
    }

    this.brainTex.blendMode(BLEND);
  }
}

// helper glyph/field
function pickGlyph(x, y) {
  const v = noise(x * 0.03, y * 0.03);
  if (v < 0.18) return "•";
  if (v < 0.36) return "+";
  if (v < 0.54) return "×";
  if (v < 0.72) return "✶";
  return "✳";
}

function pickFaceGlyph(x, y) {
  const v = noise(x * 0.02, y * 0.02);
  if (v < 0.33) return "✶";
  if (v < 0.66) return "✳";
  return "✺";
}

function faceField(nx, ny) {
  const x = nx;
  const y = ny + 0.08;

  const eyeL = ellipseSDF(x + 0.28, y - 0.10, 0.16, 0.10);
  const eyeR = ellipseSDF(x - 0.28, y - 0.10, 0.16, 0.10);
  const nose = ellipseSDF(x, y + 0.10, 0.10, 0.34);
  const mouth = ellipseSDF(x, y + 0.33, 0.34, 0.14);

  const hornL = ellipseSDF(x + 0.22, y - 0.34, 0.18, 0.20);
  const hornR = ellipseSDF(x - 0.22, y - 0.34, 0.18, 0.20);

  const e = smoothInside(-eyeL, 0.00, 0.08) + smoothInside(-eyeR, 0.00, 0.08);
  const n = smoothInside(-nose, 0.00, 0.10);
  const m = smoothInside(-mouth, 0.00, 0.12);
  const h = smoothInside(-hornL, 0.00, 0.12) + smoothInside(-hornR, 0.00, 0.12);

  const face = smoothInside(-ellipseSDF(x, y + 0.12, 0.55, 0.75), 0.00, 0.18) * 0.35;
  return constrain(face + e * 0.9 + n * 0.55 + m * 0.70 + h * 0.45, 0, 1);
}

function ellipseSDF(x, y, rx, ry) {
  const dx = x / rx;
  const dy = y / ry;
  return Math.sqrt(dx * dx + dy * dy) - 1.0;
}

function smoothInside(v, edge0, edge1) {
  return smoothstep(edge0, edge1, v);
}

function smoothstep(a, b, x) {
  const t = constrain((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}