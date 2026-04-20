let round = 0;
const totalRounds = 10;

let askCount = 0;
let shakeAmp = 0;
let shakePulse = 0;
let vapor = 0;

let questionText = "Loading...";
let tags = { type: "general", difficulty: 2, uncertainty: 2 };

let uiQuestion, uiMeta, btnThink, btnAI, btnRestart;

let injector;
let brain;

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

function setup() {
  createCanvas(windowWidth, windowHeight);
  frameRate(60);
  textFont("ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace");
  textAlign(CENTER, CENTER);

  uiQuestion = document.getElementById("question");
  uiMeta = document.getElementById("meta");
  btnThink = document.getElementById("btn-think");
  btnAI = document.getElementById("btn-ai");
  btnRestart = document.getElementById("btn-restart");

  btnThink.onclick = () => choose(false);
  btnAI.onclick = () => choose(true);
  btnRestart.onclick = () => restartSession();

  brain = new BrainShape(width * 0.50, height * 0.50, Math.min(width * 0.52, 760), Math.min(height * 0.55, 540));
  injector = new Syringe(brain);

  restartSession();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  // keep brain centered and proportional to new screen
  brain.relocate(width * 0.50, height * 0.50, Math.min(width * 0.52, 760), Math.min(height * 0.55, 540));
  injector.relocate();
}

function draw() {
  brain.updateDebris();

  let sx = 0, sy = 0;
  const amp = shakeAmp + shakePulse;
  if (amp > 0.001) {
    sx = (noise(frameCount * 0.08) - 0.5) * amp;
    sy = (noise(999 + frameCount * 0.08) - 0.5) * amp;
  }
  shakePulse *= 0.88;
  shakeAmp *= 0.995;
  vapor *= 0.99;

  background(0);

  push();
  translate(sx, sy);

  drawWordNet();

  blendMode(BLEND);
  noTint();
  drawingContext.globalAlpha = 1;

  brain.drawFill();
  injector.draw();
  brain.drawInjectionBlobs();

  if (finished) drawEndOverlay();
  drawGlitchOverlay();

  pop();

  // debris drawn outside shake, so the visual boundary matches physics boundary
  brain.drawDebris();
}

function restartSession() {
  round = 0;
  askCount = 0;
  shakeAmp = 0;
  shakePulse = 0;
  vapor = 0;
  finished = false;

  brain.reset();
  injector.plunger = 0;

  btnRestart.style.display = "none";
  btnThink.disabled = true;
  btnAI.disabled = true;

  uiQuestion.innerText = "Starting…";
  uiMeta.innerText = "";

  nextRound();
}

async function nextRound() {
  if (finished) return;

  round++;

  if (round > totalRounds) {
    finished = true;
    btnThink.disabled = true;
    btnAI.disabled = true;
    btnRestart.style.display = "inline-block";
    uiMeta.innerText = `Completed ${totalRounds}/${totalRounds}.`;
    return;
  }

  uiQuestion.innerText = "Generating...";
  uiMeta.innerText = `Round ${round}/${totalRounds} — AskAI: ${askCount}`;
  btnThink.disabled = true;
  btnAI.disabled = true;

  try {
    const qRes = await fetch(`/api/question?round=${round}`);
    const qData = await qRes.json();
    questionText = qData.question || "Write a short email to my professor.";
    tags = qData.tags || tags;
    uiQuestion.innerText = questionText;
    uiMeta.innerText = `Round ${round}/${totalRounds} — type: ${tags.type}, diff: ${tags.difficulty}, unc: ${tags.uncertainty} — AskAI: ${askCount}`;
  } catch {
    questionText = "Write a short email to my professor.";
    uiQuestion.innerText = questionText;
  }

  await refreshWordPool();
  reseedNetWords();

  btnThink.disabled = false;
  btnAI.disabled = false;
}

function choose(useAI) {
  if (finished) return;

  if (useAI) {
    askCount++;
    injector.injectBurst();

    shakePulse = 18 + askCount * 2.5;
    shakeAmp += 6 + askCount * 1.3;
    vapor += 0.35;

    brain.addDose(1);

    const base = 90 + askCount * 10;
    const jitter = (Math.random() * 50) | 0;
    const n = Math.max(90, Math.min(180, base + jitter));
    brain.dropFromBrain(n);
  }

  reseedNetWords();
  nextRound();
}

async function refreshWordPool() {
  try {
    const res = await fetch(`/api/wordpool?round=${round}&count=1200`);
    const data = await res.json();
    wordPool = Array.isArray(data.items) ? data.items : [];
  } catch {
    wordPool = [];
  }

  if (!wordPool.length) {
    wordPool = ["rewrite","summarize","translate","plan","explain","debug","outline","polish","clarify","concise","academic tone","step by step","examples"];
  }

  const seen = new Set();
  wordPool = wordPool
    .map(w => String(w).trim().toLowerCase())
    .filter(w => w.length > 0)
    .map(w => w.replace(/\s+/g, " "))
    .map(w => (w.length > 18 ? w.slice(0, 18) : w))
    .filter(w => {
      if (seen.has(w)) return false;
      seen.add(w);
      return true;
    });

  const need = net.cols * net.rows;
  if (wordPool.length < need) {
    const copy = wordPool.slice();
    shuffleInPlace(copy);
    wordPool = wordPool.concat(copy);
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

function drawWordNet() {
  if (!netWords || netWords.length === 0) return;

  const x0 = net.marginX;
  const y0 = net.marginY;
  const x1 = width - net.marginX;
  const y1 = height - net.marginY;

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

  stroke(255, net.lineAlpha + vapor * 55);
  strokeWeight(1);

  for (let r = 0; r < net.rows; r++) {
    for (let c = 0; c < net.cols; c++) {
      const idx = r * net.cols + c;
      const p = pts[idx];
      if (c < net.cols - 1) line(p.x, p.y, pts[idx + 1].x, pts[idx + 1].y);
      if (r < net.rows - 1) line(p.x, p.y, pts[idx + net.cols].x, pts[idx + net.cols].y);
    }
  }

  if (net.diagonals) {
    stroke(255, 10 + vapor * 22);
    for (let r = 0; r < net.rows - 1; r++) {
      for (let c = 0; c < net.cols - 1; c++) {
        const idx = r * net.cols + c;
        line(pts[idx].x, pts[idx].y, pts[idx + net.cols + 1].x, pts[idx + net.cols + 1].y);
      }
    }
  }

  textSize(net.fontSize);
  textAlign(CENTER, CENTER);
  noStroke();

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const pulse = 0.65 + 0.35 * sin(frameCount * pulseSpeed + p.idx * 0.35);
    const a = net.wordAlpha * pulse;

    push();
    translate(p.x, p.y);
    rotate(p.rot);
    fill(255, a);
    text(p.word, 0, 0);
    pop();
  }
}

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

function drawEndOverlay() {
  const rate = askCount / totalRounds;
  const pct = Math.round(rate * 100);

  push();
  noStroke();
  fill(0, 220);
  rect(width * 0.06, height * 0.06, width * 0.44, 150, 18);

  fill(255);
  textSize(30);
  text(`AI Addiction Rate: ${pct}%`, width * 0.08, height * 0.115);

  textSize(14);
  fill(255, 200);
  text(`Ask AI ${askCount}/${totalRounds}`, width * 0.08, height * 0.155);
  pop();
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

    this.glyphPoints = [];
    this.alive = [];
    this.debris = [];

    this.buildBrainTexture();
    this.resetDynamicLayers();
  }

  relocate(cx, cy, w, h) {
    this.cx = cx; this.cy = cy;
    this.w = w; this.h = h;
    // rebuild textures so holes + mapping stay correct
    this.buildBrainTexture();
    this.resetDynamicLayers();
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
    const breathAmp = 0.012 + rate * 0.006;
    const breathSpeed = 0.018 + rate * 0.010;
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

      this.punchHole(gp.gx, gp.gy, gp.tile);

      const x = this.cx + gp.dx * s;
      const y = this.cy + gp.dy * s;

      this.debris.push({
        x, y,
        vx: random(-2.6, 2.6),
        vy: random(0.8, 2.6) + rate * 0.8,
        a: random(TWO_PI),
        av: random(-0.14, 0.14),
        g: gp.g,
        size: gp.tile * 1.7,
        hue: gp.hue,
        rest: 0.62 + random(0, 0.10),
        sleep: false,
        sleepCount: 0
      });
    }
  }

  punchHole(gx, gy, tile) {
    const cut = tile * 1.45;

    const ctx1 = this.dynTex.drawingContext;
    ctx1.save();
    ctx1.globalCompositeOperation = "destination-out";
    this.dynTex.noStroke();
    this.dynTex.fill(0, 255);
    this.dynTex.rect(gx - cut * 0.5, gy - cut * 0.5, cut, cut);
    ctx1.restore();

    const ctx2 = this.dynMask.drawingContext;
    ctx2.save();
    ctx2.globalCompositeOperation = "destination-out";
    this.dynMask.noStroke();
    this.dynMask.fill(0, 255);
    this.dynMask.rect(gx - cut * 0.5, gy - cut * 0.5, cut, cut);
    ctx2.restore();
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

      const r = d.size * 0.55;

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
      if (d.y > height - r - 2 && speed < 0.22) {
        d.sleepCount++;
        if (d.sleepCount > 35) { d.sleep = true; d.vx = d.vy = d.av = 0; }
      } else d.sleepCount = 0;
    }
  }

  drawDebris() {
    if (!this.debris.length) return;

    push();
    noStroke();
    textAlign(CENTER, CENTER);
    colorMode(HSB, 360, 100, 100, 255);

    for (const d of this.debris) {
      push();
      translate(d.x, d.y);
      rotate(d.a);
      fill(d.hue, 100, 100, 245);
      textSize(d.size);
      text(d.g, 0, 0);
      pop();
    }

    colorMode(RGB, 255);
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

    this.alive = new Array(this.glyphPoints.length).fill(true);
  }

  isInsideBrain(px, py) {
    const x = (px - this.cx) / (this.w * 0.55);
    const y = (py - this.cy) / (this.h * 0.55);
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

        const g = ff > 0.35 ? pickFaceGlyph(xx, yy) : pickGlyph(xx, yy);
        const rot = (noise(xx * 0.03, yy * 0.03) - 0.5) * 0.5;

        const gx = cx + xx;
        const gy = cy + yy;

        this.brainTex.push();
        this.brainTex.translate(gx, gy);
        this.brainTex.rotate(rot);
        this.brainTex.text(g, 0, 0);
        this.brainTex.pop();

        this.glyphPoints.push({ dx: xx, dy: yy, gx, gy, g, hue, tile });
      }
    }

    this.brainTex.blendMode(BLEND);
  }

  drawFill() {
    this.fillLevel = lerp(this.fillLevel, this.targetFill, 0.06);
    const s = this.getBreathScale();

    push();
    imageMode(CENTER);

    push();
    translate(this.cx, this.cy);
    scale(s);
    image(this.dynMask, 0, 0);
    pop();

    const a = 235 + this.fillLevel * 20;
    push();
    translate(this.cx, this.cy);
    scale(s);
    tint(255, a);
    image(this.dynTex, 0, 0);
    noTint();
    pop();

    pop();
  }

  drawInjectionBlobs() {}
}

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

class Syringe {
  constructor(brain) {
    this.brain = brain;
    this.relocate();
    this.plunger = 0;
  }
  relocate() {
    this.baseX = this.brain.cx + this.brain.w * 0.55;
    this.baseY = this.brain.cy - this.brain.h * 0.05;
    this.tipX = this.brain.cx + this.brain.w * 0.38;
    this.tipY = this.brain.cy - this.brain.h * 0.05;
  }
  injectBurst() {
    this.plunger = 1.0;
  }
  draw() {
    this.relocate();
    this.plunger *= 0.86;
    push();
    noStroke();
    fill(255);
    rect(this.baseX - 140, this.baseY - 22, 160, 44, 10);
    stroke(0, 50);
    strokeWeight(2);
    noFill();
    rect(this.baseX - 140, this.baseY - 22, 160, 44, 10);
    noStroke();
    fill(230);
    const px = this.baseX - 140 - 26 + (1 - this.plunger) * 10;
    rect(px, this.baseY - 14, 26, 28, 8);
    stroke(0, 70);
    strokeWeight(3);
    line(this.baseX + 20, this.baseY, this.tipX, this.tipY);
    stroke(0, 120);
    strokeWeight(2);
    line(this.tipX, this.tipY, this.tipX - 16, this.tipY + 6);
    pop();
  }
}