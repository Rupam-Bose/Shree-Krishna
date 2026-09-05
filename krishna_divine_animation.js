// ═══════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════
const PI2 = Math.PI * 2, D2R = Math.PI / 180;
const rnd = (a, b) => Math.random() * (b - a) + a;
const rndI = (a, b) => Math.floor(rnd(a, b + 1));

// ── Instant cursor tracking (no CSS transition, uses RAF) ──
const curEl = document.getElementById('cursor');
let mx = innerWidth / 2, my = innerHeight / 2;
document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });
(function moveCur() { curEl.style.left = mx + 'px'; curEl.style.top = my + 'px'; requestAnimationFrame(moveCur); })();

function mkC(id) {
  const c = document.getElementById(id), ctx = c.getContext('2d');
  const rs = () => { c.width = innerWidth; c.height = innerHeight };
  rs(); window.addEventListener('resize', rs);
  return { c, ctx };
}

// ═══════════════════════════════════════════════════════════
// 1. BACKGROUND
// ═══════════════════════════════════════════════════════════
const BG = mkC('bgC');
function drawBG() {
  const { ctx, c } = BG, W = c.width, H = c.height;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const g = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.min(W, H) * 0.62);
  g.addColorStop(0, 'rgba(12,0,45,0.95)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 200; i++) {
    const sx = rnd(0, W), sy = rnd(0, H), sr = rnd(0.25, 1.4), sa = rnd(0.18, 0.88);
    ctx.beginPath(); ctx.arc(sx, sy, sr, 0, PI2);
    ctx.fillStyle = 'rgba(255,255,255,' + sa + ')'; ctx.fill();
  }
}
drawBG(); window.addEventListener('resize', drawBG);

// ═══════════════════════════════════════════════════════════
// 2. MANDALA (optimised: skips frames)
// ═══════════════════════════════════════════════════════════
const MD = mkC('mndC');
let mndFrame = 0;
function drawMandala(t) {
  if (mndFrame++ % 2 !== 0) return; // draw every other frame for speed
  const { ctx, c } = MD, W = c.width, H = c.height;
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2, a = t * 0.00035;
  [[70, 8, 'rgba(255,215,0,0.15)', 1.0, 1], [110, 12, 'rgba(255,140,0,0.1)', 0.75, -0.68],
  [155, 16, 'rgba(255,215,0,0.07)', 0.55, 0.5], [205, 20, 'rgba(0,200,220,0.05)', 0.45, -0.35]].forEach(([r, n, col, lw, spd]) => {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(a * spd);
    ctx.strokeStyle = col; ctx.lineWidth = lw;
    for (let i = 0; i < n; i++) {
      const ang = (PI2 / n) * i; ctx.save(); ctx.rotate(ang);
      ctx.beginPath(); ctx.ellipse(r * 0.56, 0, r * 0.44, r * 0.13, 0, 0, PI2); ctx.stroke(); ctx.restore();
    }
    ctx.restore();
  });
  const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 58);
  cg.addColorStop(0, 'rgba(255,215,0,0.16)'); cg.addColorStop(1, 'transparent');
  ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(cx, cy, 58, 0, PI2); ctx.fill();
}

// ═══════════════════════════════════════════════════════════
// 3. BATCH TURTLE – THE CORE SYSTEM
// Groups consecutive same-color/pensize segments into
// polylines → ~100× fewer ctx.stroke() calls than v1
// ═══════════════════════════════════════════════════════════
function makeBT() {
  let tx = 0, ty = 0, th = 0, isDown = false, col = 'white', ps = 1;
  const batches = [];
  let cur = null;

  const flush = () => {
    if (isDown) { cur = { color: col, pensize: ps, pts: [[tx, ty]] }; batches.push(cur); }
    else cur = null;
  };

  return {
    up() { isDown = false; cur = null; },
    down() { if (!isDown) { isDown = true; flush(); } },
    color(c) { col = c; if (isDown) flush(); },
    pensize(s) { ps = s; if (isDown) flush(); },
    seth(d) { th = d; },
    goto(x, y) { tx = x; ty = y; if (isDown) flush(); else cur = null; },
    fd(d) {
      const r = th * D2R, nx = tx + Math.cos(r) * d, ny = ty + Math.sin(r) * d;
      if (isDown) { if (!cur) flush(); cur.pts.push([nx, ny]); }
      tx = nx; ty = ny;
    },
    circle(radius, extent) {
      if (extent === undefined) extent = 360;
      const absR = Math.abs(radius);
      const steps = Math.max(8, Math.ceil(Math.abs(extent) / 3));
      const se = extent / steps;
      const sd = (PI2 * absR) * (Math.abs(se) / 360);
      for (let i = 0; i < steps; i++) { this.fd(sd); th += radius > 0 ? se : -se; }
    },
    batches,
    get tx() { return tx }, get ty() { return ty }
  };
}

// ═══════════════════════════════════════════════════════════
// 4. BUILD ALL BATCHES (same turtle commands as the
//    beautiful version 2, now fast via BatchTurtle)
// ═══════════════════════════════════════════════════════════
let BATCHES = null, offCan = null, offCtxR = null;
let renderedN = 0;
let krishnaOX = 0, krishnaOY = 0, krishnaS = 1;
let drawProgress = 0;

function buildAndInit(W, H) {
  const bt = makeBT();
  const SCALE = 0.5;   // 50% of original size

  const { up, down, color, pensize, seth, fd, circle, goto } = {
    up: () => bt.up(),
    down: () => bt.down(),
    color: c => bt.color(c),
    pensize: s => bt.pensize(s * SCALE),
    seth: d => bt.seth(d),
    fd: d => bt.fd(d * SCALE),
    circle: (r, e) => bt.circle(r * SCALE, e),
    goto: (x, y) => bt.goto(x * SCALE, y * SCALE)
  };

  // ──────────── FACE & BODY (turtle simulation) ────────────

  // Initial move
  up(); seth(166); fd(200); down();

  // ── EYE 1 – upper lid (blue) ──
  color('blue'); pensize(1);
  pensize(4); seth(150); circle(70, 13);
  pensize(5); circle(70, 10); pensize(6); circle(70, 10);
  pensize(7); circle(70, 15); pensize(5); circle(70, 8);
  pensize(3); circle(70, 7); pensize(2); circle(70, 5);

  up(); seth(-19.5); fd(104); down();

  // ── EYE 1 – lower lid ──
  pensize(5); seth(137); fd(8); pensize(4); fd(5);
  circle(8, 92); circle(-37, 26); pensize(5); circle(-37, 20);
  pensize(6); circle(-37, 10); pensize(7); circle(-37, 10);
  pensize(6); circle(-37, 10); pensize(4); circle(-37, 10);
  pensize(3); fd(8); pensize(2); fd(7); pensize(1); fd(5);

  up(); seth(17.5); fd(123); down();

  // ── EYE 2 – upper lid ──
  pensize(5); seth(58); circle(-80, 5); pensize(6); circle(-80, 10);
  pensize(7); circle(-80, 15); pensize(8); circle(-80, 15);
  pensize(7); circle(-80, 10); pensize(6); circle(-80, 8);
  pensize(4); circle(-80, 7); pensize(3); circle(-80, 5);
  pensize(2); circle(-80, 3); pensize(1); circle(-80, 2);

  up(); seth(-139); fd(118); down();

  // ── EYE 2 – lower lid ──
  pensize(5); seth(68); fd(6); pensize(4); fd(3); pensize(3); fd(6);
  circle(-12, 57); pensize(4); circle(-12, 20); pensize(5); circle(-12, 10);
  pensize(6); circle(45, 30); pensize(7); circle(45, 20);
  pensize(6); circle(45, 15); pensize(4); circle(45, 8);
  pensize(3); circle(45, 7); fd(17); pensize(2); fd(10);

  up(); seth(163); fd(165); down();

  // ── TILAK (bisque) ──
  color('bisque'); seth(-10);
  pensize(4); fd(5); seth(-45); circle(-50, 30);
  pensize(5); circle(-50, 10); pensize(6); fd(15);
  circle(45, 39); circle(7, 138);
  pensize(7); fd(30); pensize(6); fd(20); pensize(5); fd(10);
  pensize(4); fd(5); circle(-18, 35); pensize(3); circle(-18, 20);

  up(); seth(-89.5); fd(167); down();

  // ── NOSE (blue) ──
  color('blue'); circle(45, 40);
  up(); seth(-120); fd(31); down();

  // ── LIPS (deeppink) ──
  color('deeppink');
  seth(27); fd(18); circle(-9, 85); seth(78); circle(-10, 98);
  circle(25, 80); seth(-127); circle(-67, 68);
  up(); seth(-35); fd(13); down();
  seth(-30); circle(37, 85);

  pensize(1); up(); seth(151.5); fd(270); down();

  // ── CROWN / MUKUT (darkorange) ──
  color('darkorange'); pensize(4);
  seth(127); circle(-90, 43);
  seth(45.5); fd(118); circle(-1, 165); fd(74);
  circle(25, 45); seth(-111); fd(50);
  seth(-40); fd(10); seth(61); fd(100);
  circle(-185, 32); circle(1, 175); circle(200, 37);
  circle(-2.5, 180); fd(48);
  seth(60); circle(-180, 58); seth(173); circle(150, 60);
  seth(-155); circle(238, 33); seth(-92); circle(95, 43);

  up(); seth(23); fd(55); down();
  seth(52); circle(-400, 24); seth(-165); circle(200, 50);

  up(); seth(38); fd(150); down();
  seth(2); circle(-180, 20); seth(133); circle(55, 70);

  up(); seth(9); fd(152); down();
  seth(-20); circle(-50, 98); seth(80); circle(70, 65);
  up(); seth(-91); fd(80); down();

  // ── HAIR CURLS – left side (grey) ──
  color('grey'); pensize(3);
  seth(-35);
  pensize(3); circle(-25, 45); pensize(4); circle(-25, 50);
  pensize(5); circle(-10, 70); pensize(5); circle(-18, 80);
  circle(-11, 150); pensize(4); circle(-11, 60);
  pensize(3); circle(-11, 30); pensize(2); circle(-11, 20); pensize(1); circle(-11, 10);
  up(); seth(32); fd(29); down();

  seth(24);
  pensize(3); circle(-25, 45); pensize(4); circle(-25, 50);
  pensize(5); circle(-11, 70); pensize(5); circle(-19, 80);
  circle(-12, 150); pensize(4); circle(-12, 60);
  pensize(3); circle(-12, 30); pensize(2); circle(-12, 20); pensize(1); circle(-12, 10);
  up(); seth(170); fd(31); down();

  seth(-33);
  pensize(3); circle(-48, 45); pensize(4); circle(-48, 50);
  pensize(5); circle(-22, 90); pensize(6); circle(-30, 95);
  pensize(6); circle(-20, 150); pensize(5); circle(-20, 60);
  pensize(4); circle(-20, 30); pensize(3); circle(-20, 20); pensize(2); circle(-20, 10);
  up(); seth(169); fd(245); down();

  // ── HAIR CURLS – right side ──
  seth(-155);
  pensize(3); circle(25, 45); pensize(4); circle(25, 50);
  pensize(5); circle(10, 85); pensize(6); circle(16, 70);
  circle(10, 150); pensize(4); circle(10, 60);
  pensize(3); circle(10, 30); pensize(2); circle(10, 20); pensize(1); circle(10, 10);
  up(); seth(167); fd(23); down();

  seth(168);
  pensize(3); circle(25, 45); pensize(4); circle(25, 50);
  pensize(5); circle(12, 85); pensize(6); circle(19, 70);
  circle(11, 150); pensize(4); circle(11, 60);
  pensize(3); circle(11, 30); pensize(2); circle(11, 20); pensize(1); circle(11, 10);
  up(); seth(21); fd(30); down();

  seth(-148);
  pensize(3); circle(48, 40); pensize(5); circle(48, 50);
  pensize(6); circle(22, 90); pensize(7); circle(30, 95);
  pensize(6); circle(20, 150); pensize(5); circle(20, 60);
  pensize(4); circle(20, 30); pensize(3); circle(20, 20); pensize(2); circle(20, 10);
  up(); seth(33); fd(258); down();

  // ── PEACOCK FEATHER ──
  color('green'); pensize(3);
  seth(85); circle(150, 25); pensize(1);
  up(); seth(-88); fd(42); down();

  color('blue'); pensize(2);
  seth(131); circle(-75, 45); circle(-12, 150); circle(-85, 35);
  seth(88); circle(75, 34); circle(5, 137); circle(75, 40);
  up(); seth(135); fd(15); down();

  color('orange'); pensize(2);
  seth(140); circle(-65, 77); circle(-20, 125); circle(-85, 45);
  seth(84); circle(75, 32); circle(15, 140); circle(65, 47);
  up(); seth(-110); fd(4); down();

  color('lime'); pensize(2);
  seth(140); circle(-70, 70); circle(-28, 145); circle(-85, 27);
  seth(54); circle(50, 50); circle(-30, 60); seth(-140); circle(50, 35);
  seth(74); circle(100, 36); seth(-82); circle(-70, 35);
  seth(92); circle(55, 50); circle(-35, 65);
  seth(-135); circle(125, 70); seth(140); circle(-80, 50);
  seth(-94); circle(100, 70);

  // ── FLUTE – positioned explicitly below the figure ──
  color('goldenrod'); pensize(3);
  up();
  seth(-90); fd(285);   // go mostly down
  seth(-178); fd(160);  // go left to start of flute
  down();

  // Flute rectangle (top rail, cap, right, bottom rail, left)
  pensize(3);
  seth(-90); fd(16);    // down (flute thickness)
  seth(-179); fd(18);   // left cap
  seth(90); fd(16);     // up
  seth(1); fd(18);      // right cap back
  fd(420);             // TOP rail across flute
  seth(-90); fd(16);    // down
  seth(-179); fd(420);  // BOTTOM rail back
  seth(90); fd(16);     // up
  pensize(1); seth(1); fd(110);

  // Flute finger holes (6 rings)
  seth(-50); circle(16, 103);
  seth(1); fd(76); seth(-50); circle(16, 103);
  seth(1); fd(34); seth(-50); circle(16, 103);
  seth(1); fd(34); seth(-50); circle(16, 103);
  seth(1); fd(34); seth(-50); circle(16, 100);
  seth(1); fd(90);
  seth(-90); fd(16); seth(-179); fd(420);
  seth(90); fd(16); seth(1); fd(420);

  // Flute tassel
  color('yellow'); pensize(5);
  up(); seth(-90); fd(1); seth(-179); fd(44); down();
  seth(-110); circle(-120, 90);
  circle(480, 50); seth(20); circle(-380, 46); circle(200, 101);

  // ═══════════════════════════════════════════════════════
  // AUTO-CENTER: compute face centroid (blue strokes)
  // so Krishna is perfectly centred on screen
  // ═══════════════════════════════════════════════════════
  let fxSum = 0, fySum = 0, fN = 0;
  bt.batches.forEach(b => {
    if (b.color === 'blue' || b.color === 'deeppink' || b.color === 'bisque') {
      b.pts.forEach(([x, y]) => { fxSum += x; fySum += y; fN++; });
    }
  });
  const faceCX = fxSum / fN, faceCY = fySum / fN;

  // Bounding box of WHOLE figure
  let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;
  bt.batches.forEach(b => b.pts.forEach(([x, y]) => {
    mnX = Math.min(mnX, x); mxX = Math.max(mxX, x);
    mnY = Math.min(mnY, y); mxY = Math.max(mxY, y);
  }));
  const figW = mxX - mnX, figH = mxY - mnY;

  // Scale so figure fits in canvas with padding
  const availW = W - 20, availH = H - 110; // leave room for top/bottom bars
  const s = Math.min(availW / figW, availH / figH) * 0.66;

  // Canvas origin: face goes to visual center of available area
  const availMidY = 60 + (H - 170) / 2;
  const OX = W / 2 - faceCX * s;
  const OY = availMidY + faceCY * s -65;

  krishnaOX = OX; krishnaOY = OY; krishnaS = s;
  BATCHES = bt.batches;

  // Create / resize offscreen canvas
  offCan = document.createElement('canvas');
  offCan.width = W; offCan.height = H;
  offCtxR = offCan.getContext('2d');
  renderedN = 0;
}

// ── Render one batch to a context ──
function renderBatch(ctx, b) {
  if (!b || b.pts.length < 2) return;
  const s = krishnaS, OX = krishnaOX, OY = krishnaOY;
  ctx.save();
  ctx.strokeStyle = b.color; ctx.lineWidth = b.pensize * s;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.shadowColor = b.color; ctx.shadowBlur = b.pensize * s * 4.5;
  ctx.beginPath();
  b.pts.forEach(([x, y], i) => {
    const cx2 = OX + x * s, cy2 = OY - y * s;
    i === 0 ? ctx.moveTo(cx2, cy2) : ctx.lineTo(cx2, cy2);
  });
  ctx.stroke();
  ctx.restore();
}

// ═══════════════════════════════════════════════════════════
// 5. PARTICLES (optimised count)
// ═══════════════════════════════════════════════════════════
const PT = mkC('ptC');
const PTS = [];
class Particle {
  constructor() { this.reset(); }
  reset() {
    this.x = rnd(0, innerWidth); this.y = rnd(innerHeight + 8, innerHeight + 70);
    this.t = Math.random() < 0.3 ? 0 : Math.random() < 0.5 ? 1 : 2;
    this.sz = this.t === 0 ? rnd(1, 2.5) : rnd(1.5, 4.5);
    this.vx = rnd(-0.35, 0.35); this.vy = rnd(-0.55, -0.14);
    this.a = rnd(0.2, 0.88); this.ad = 1; this.asp = rnd(0.003, 0.012);
    this.h = this.t === 2 ? rnd(300, 360) : rnd(38, 55);
    this.ang = rnd(0, PI2); this.as2 = rnd(-0.03, 0.03);
    this.lf = 0; this.ml = rnd(200, 600);
  }
  step() {
    this.x += this.vx + Math.sin(this.lf * 0.025) * 0.22; this.y += this.vy;
    this.a += this.ad * this.asp;
    if (this.a > 1) { this.a = 1; this.ad = -1; } if (this.a < 0.05) { this.a = 0.05; this.ad = 1; }
    this.ang += this.as2; this.lf++;
    if (this.lf > this.ml || this.y < -28) this.reset();
  }
  draw(ctx) {
    ctx.save(); ctx.globalAlpha = this.a; ctx.translate(this.x, this.y); ctx.rotate(this.ang);
    if (this.t === 0) {
      ctx.fillStyle = 'hsla(' + this.h + ',100%,78%,1)'; ctx.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 === 0 ? this.sz : this.sz * 0.42, a = (Math.PI / 5) * i - Math.PI / 2; i === 0 ? ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      ctx.closePath(); ctx.fill();
    } else if (this.t === 1) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, this.sz);
      g.addColorStop(0, 'hsla(' + this.h + ',100%,92%,1)'); g.addColorStop(1, 'hsla(' + this.h + ',100%,60%,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, this.sz, 0, PI2); ctx.fill();
    } else {
      ctx.fillStyle = 'hsla(' + this.h + ',80%,78%,0.85)';
      ctx.beginPath(); ctx.ellipse(0, 0, this.sz * 0.32, this.sz, 0, 0, PI2); ctx.fill();
    }
    ctx.restore();
  }
}
for (let i = 0; i < 220; i++) { const p = new Particle(); p.y = rnd(0, innerHeight); p.lf = rndI(0, p.ml); PTS.push(p); }
function drawParticles() {
  const { ctx, c } = PT; ctx.clearRect(0, 0, c.width, c.height);
  PTS.forEach(p => { p.step(); p.draw(ctx); });
}

// ═══════════════════════════════════════════════════════════
// 6. SHOOTING STARS
// ═══════════════════════════════════════════════════════════
function spawnStar() {
  const el = document.createElement('div'); el.className = 'sstar';
  el.style.cssText = 'top:' + rnd(6, 55) + 'vh;left:' + rnd(-5, 28) + 'vw;width:' + rnd(55, 190) + 'px;transform:rotate(' + rnd(-14, 14) + 'deg);';
  document.body.appendChild(el); setTimeout(() => el.remove(), 1600);
}
setInterval(spawnStar, 2800);

// ═══════════════════════════════════════════════════════════
// 7. CLICK BURST
// ═══════════════════════════════════════════════════════════
document.addEventListener('click', e => {
  const ctx = PT.ctx, bs = [];
  for (let i = 0; i < 24; i++) { const a = (PI2 / 24) * i, sp = rnd(2, 7); bs.push({ x: e.clientX, y: e.clientY, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, a: 1, sz: rnd(2, 5), h: rnd(38, 55) }); }
  let fr = 0;
  (function ab() {
    bs.forEach(b => {
      b.x += b.vx; b.y += b.vy; b.vy += 0.12; b.a -= 0.025; b.vx *= 0.97;
      if (b.a > 0) { ctx.save(); ctx.globalAlpha = b.a; ctx.fillStyle = 'hsla(' + b.h + ',100%,75%,1)'; ctx.beginPath(); ctx.arc(b.x, b.y, b.sz, 0, PI2); ctx.fill(); ctx.restore(); }
    });
    if (++fr < 58) requestAnimationFrame(ab);
  })();
});

// ═══════════════════════════════════════════════════════════
// 8. SEQUENCE TIMING
// ═══════════════════════════════════════════════════════════
function showEl(id) { const e = document.getElementById(id); if (e) e.classList.add('show'); }
const SEQ = [
  { at: 0, fn: () => { showEl('topBar'); } },
  { at: 9800, fn: () => { showEl('btmBar'); showEl('div1'); setTimeout(() => showEl('w1'), 80); } },
  { at: 10700, fn: () => { showEl('w2'); } },
  { at: 11600, fn: () => { showEl('w3'); } },
  { at: 12400, fn: () => { showEl('jaiLine'); } },
  { at: 13200, fn: () => { showEl('subWish'); showEl('quoteL'); } },
];
let seqI = 0, startT = null;

// ═══════════════════════════════════════════════════════════
// 9. MAIN LOOP – efficient pre-render + drawImage blit
// ═══════════════════════════════════════════════════════════
const KC = mkC('kC');
let _W = -1, _H = -1;
const BOB_AMP = 6, BOB_SPD = 0.0008;

function loop(ts) {
  if (!startT) startT = ts;
  const el = ts - startT;

  // Sequence events
  while (seqI < SEQ.length && el >= SEQ[seqI].at) { SEQ[seqI].fn(); seqI++; }

  // Initialise / reinit on resize
  const W = KC.c.width, H = KC.c.height;
  if (W !== _W || H !== _H) {
    _W = W; _H = H;
    buildAndInit(W, H);
    drawProgress = 0; renderedN = 0; seqI = 0; startT = ts;
  }

  // Drawing progress: starts at 0.7s, finishes by 9.5s
  if (el > 700) drawProgress = Math.min((el - 700) / 8800, 1);

  // How many batches should be visible now
  const targetN = Math.floor(drawProgress * BATCHES.length);

  // Pre-render new batches to offscreen (up to 6 new per frame for speed)
  const newCount = Math.min(targetN - renderedN, 6);
  for (let i = 0; i < newCount; i++) {
    renderBatch(offCtxR, BATCHES[renderedN]);
    renderedN++;
  }

  // ── Main canvas: clear, bob translate, blit offscreen ──
  const { ctx } = KC;
  ctx.clearRect(0, 0, W, H);
  const bob = Math.sin(ts * BOB_SPD) * BOB_AMP;
  ctx.save(); ctx.translate(0, bob); ctx.drawImage(offCan, 0, 0); ctx.restore();

  // Draw glowing "pen tip" (current turtle position) while drawing
  if (renderedN < BATCHES.length && drawProgress > 0 && drawProgress < 1) {
    const b = BATCHES[renderedN];
    if (b && b.pts.length) {
      const [tx, ty] = b.pts[0];
      const cx2 = krishnaOX + tx * krishnaS + 0, cy2 = krishnaOY - ty * krishnaS + bob;
      ctx.save();
      const gr = ctx.createRadialGradient(cx2, cy2, 0, cx2, cy2, 8);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cx2, cy2, 8, 0, PI2); ctx.fill();
      ctx.restore();
    }
  }

  drawMandala(ts);
  drawParticles();
  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
