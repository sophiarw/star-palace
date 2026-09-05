/* Star renderers — minimal self-contained ports of the in-app drawers
 * plus the proposed "crisp" replacements. Each renderer accepts a
 * canvas, a star-type id, and a seed; everything is procedural so we
 * don't need any image assets. The point is to demonstrate the visual
 * delta between what ships today and what we're proposing.
 *
 * Two render passes per star: CURRENT (mirrors the in-app drawer at the
 * resolution the in-app sprite cache happens to bake at) and PROPOSED
 * (renders crisply at full DPR, with the fixes outlined in the deck).
 */
(function () {
  'use strict';

  // ----- seeded RNG (mulberry32) ---------------------------------------
  function rng32(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function range(rng, a, b) { return a + rng() * (b - a); }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }

  // ----- DPR-aware canvas sizing ---------------------------------------
  // CRITICAL FIX vs current app: bake the sprite at full devicePixelRatio
  // so it stays crisp when the renderer scales the cached canvas up by
  // 2× / 3× during high-zoom passes.
  function fitCanvas(canvas, dpr) {
    const cssW = canvas.clientWidth || canvas.width;
    const cssH = canvas.clientHeight || canvas.height;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: cssW, h: cssH };
  }

  // ====================================================================
  //  JWST — CURRENT (degraded preview)
  //
  // Mimics the in-app failure modes: low-DPR baked sprite, broad halo
  // mid-stops that look translucent, image smoothing OFF so upsampling
  // shows blockiness. Output is intentionally a bit muddy.
  // ====================================================================
  function jwstCurrent(canvas, type, seed) {
    // Bake at fixed 1× then upscale — same trick the symptom reproduces.
    const { ctx, w, h } = fitCanvas(canvas, 1);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    ctx.fillStyle = '#0a0d1a';
    ctx.fillRect(0, 0, w, h);
    drawJwstStar(ctx, w / 2, h / 2, Math.min(w, h) * 0.18, rng32(seed), type, /*crisp=*/false);
  }

  // ====================================================================
  //  JWST — PROPOSED (crisp)
  //
  // Renders at devicePixelRatio with high-quality smoothing. Halo grading
  // tightened: more energy in the inner 20%, gentler tail. Diffraction
  // spikes use sub-pixel anti-aliased strokes with 6-arm + 2-short-arm
  // signature for big stars only (per current procedural variation rule).
  // Color temperature varies per star (cool / warm / neutral).
  // ====================================================================
  function jwstProposed(canvas, type, seed) {
    const { ctx, w, h } = fitCanvas(canvas, window.devicePixelRatio || 2);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    drawDeepFieldBackground(ctx, w, h, seed);
    drawJwstStar(ctx, w / 2, h / 2, Math.min(w, h) * 0.18, rng32(seed), type, /*crisp=*/true);
  }

  // Subtle background nebula + micro-stars for the deep-field feeling
  function drawDeepFieldBackground(ctx, w, h, seed) {
    ctx.fillStyle = '#05060f';
    ctx.fillRect(0, 0, w, h);
    const r = rng32(seed ^ 0xBEEF);
    // Layered nebulosity using the same cloud engine, but at very low
    // alpha and oversize so it reads as background dust, not a feature.
    const big = Math.max(w, h);
    paintNebulaCloud(ctx, w * 0.30, h * 0.65, big * 0.55, rng32(seed ^ 0x111), {
      bands: [[40, 70, 100], [70, 140, 160], [180, 110, 90], [200, 90, 120]],
      hot: [[255, 230, 200]],
      dustAlpha: 0.10,
      filaments: 0,
      intensity: 0.35,
      skipKnots: true,
      shape: { ax: 1.0, ay: 0.7, rot: 0.4 },
      crisp: true,
    });
    paintNebulaCloud(ctx, w * 0.78, h * 0.30, big * 0.45, rng32(seed ^ 0x222), {
      bands: [[80, 50, 80], [180, 100, 130], [120, 80, 140]],
      hot: [[255, 200, 220]],
      dustAlpha: 0.06,
      filaments: 0,
      intensity: 0.30,
      skipKnots: true,
      shape: { ax: 1.1, ay: 0.6, rot: -0.3 },
      crisp: true,
    });
    paintNebulaCloud(ctx, w * 0.78, h * 0.30, big * 0.45, rng32(seed ^ 0x222), {
      bands: [[80, 50, 80], [180, 100, 130], [120, 80, 140]],
      hot: [[255, 200, 220]],
      dustAlpha: 0.06,
      filaments: 0,
      intensity: 0.30,
      skipKnots: true,
      shape: { ax: 1.1, ay: 0.6, rot: -0.3 },
      crisp: true,
    });
    // Background stars — pinpoints with color-temp variation
    ctx.save();
    for (let i = 0; i < 180; i++) {
      const x = r() * w, y = r() * h;
      const mag = Math.pow(r(), 2.5);
      const sz = 0.4 + mag * 1.4;
      const t = r();
      const col = t < 0.55 ? '255,250,235' : t < 0.85 ? '180,210,255' : '255,180,150';
      ctx.fillStyle = `rgba(${col},${0.35 + mag * 0.6})`;
      ctx.beginPath();
      ctx.arc(x, y, sz, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawJwstStar(ctx, cx, cy, r, rng, type, crisp) {
    switch (type) {
      case 'main-sequence': return jwstMainSequence(ctx, cx, cy, r, rng, crisp);
      case 'red-giant': return jwstRedGiant(ctx, cx, cy, r, rng, crisp);
      case 'blue-supergiant': return jwstBlueSupergiant(ctx, cx, cy, r, rng, crisp);
      case 'white-dwarf': return jwstWhiteDwarf(ctx, cx, cy, r, rng, crisp);
      case 'neutron-star': return jwstNeutronStar(ctx, cx, cy, r, rng, crisp);
      case 'pulsar': return jwstPulsar(ctx, cx, cy, r, rng, crisp);
      case 'binary': return jwstBinary(ctx, cx, cy, r, rng, crisp);
      case 'quasar': return jwstQuasar(ctx, cx, cy, r, rng, crisp);
      case 'black-hole': return jwstBlackHole(ctx, cx, cy, r, rng, crisp);
      case 'nebula': return jwstNebula(ctx, cx, cy, r, rng, crisp);
      default: return jwstMainSequence(ctx, cx, cy, r, rng, crisp);
    }
  }

  // ---- Main sequence: warm yellow, 6+2 spike on crisp ------------------
  function jwstMainSequence(ctx, cx, cy, r, rng, crisp) {
    // Single continuous radial gradient — no hard arc edges, no rect
    // corners. Halo + core + falloff are all stops in one paint.
    const reach = r * 3.4;
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
    if (crisp) {
      halo.addColorStop(0.00, 'rgba(255,253,240,1)');
      halo.addColorStop(0.05, 'rgba(255,245,210,1)');
      halo.addColorStop(0.12, 'rgba(255,225,160,0.85)');
      halo.addColorStop(0.20, 'rgba(255,200,120,0.45)');
      halo.addColorStop(0.35, 'rgba(255,160,80,0.18)');
      halo.addColorStop(0.55, 'rgba(220,110,50,0.06)');
      halo.addColorStop(1.00, 'rgba(120,40,20,0)');
    } else {
      halo.addColorStop(0.00, 'rgba(255,253,240,0.95)');
      halo.addColorStop(0.10, 'rgba(255,235,180,0.75)');
      halo.addColorStop(0.30, 'rgba(255,180,100,0.40)');
      halo.addColorStop(0.60, 'rgba(200,90,50,0.15)');
      halo.addColorStop(1.00, 'rgba(80,40,20,0)');
    }
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, reach, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = halo;
    ctx.fillRect(cx - reach, cy - reach, reach * 2, reach * 2);
    ctx.restore();

    if (crisp) drawJwstSpikes(ctx, cx, cy, r, '255,250,230', 6, true);
  }

  // 6 long spikes + 2 short horizontals (JWST signature). When `signature`
  // is false, draws the current procedural 4/6/8 variation.
  function drawJwstSpikes(ctx, cx, cy, r, rgb, count, signature) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const reach = r * 3.6;
    const longCount = signature ? 6 : count;
    for (let i = 0; i < longCount; i++) {
      const ang = (i / longCount) * Math.PI;
      drawSpike(ctx, cx, cy, ang, reach, rgb, 1.1);
    }
    if (signature) {
      // Two short horizontal spikes at half reach
      drawSpike(ctx, cx, cy, 0, reach * 0.55, rgb, 0.85);
    }
    ctx.restore();
  }
  function drawSpike(ctx, cx, cy, ang, reach, rgb, lw) {
    const dx = Math.cos(ang) * reach, dy = Math.sin(ang) * reach;
    const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    g.addColorStop(0.00, `rgba(${rgb},0)`);
    g.addColorStop(0.45, `rgba(${rgb},0.55)`);
    g.addColorStop(0.50, `rgba(${rgb},1)`);
    g.addColorStop(0.55, `rgba(${rgb},0.55)`);
    g.addColorStop(1.00, `rgba(${rgb},0)`);
    ctx.strokeStyle = g;
    ctx.lineWidth = lw;
    ctx.beginPath();
    ctx.moveTo(cx - dx, cy - dy);
    ctx.lineTo(cx + dx, cy + dy);
    ctx.stroke();
  }

  // ---- Red giant -------------------------------------------------------
  function jwstRedGiant(ctx, cx, cy, r, rng, crisp) {
    const reach = r * 3.2;
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
    if (crisp) {
      halo.addColorStop(0.0, 'rgba(255,210,160,0.7)');
      halo.addColorStop(0.18, 'rgba(255,150,90,0.45)');
      halo.addColorStop(0.4, 'rgba(220,90,50,0.22)');
      halo.addColorStop(0.7, 'rgba(160,40,30,0.08)');
      halo.addColorStop(1, 'rgba(110,20,10,0)');
    } else {
      halo.addColorStop(0, 'rgba(255,210,160,0.55)');
      halo.addColorStop(0.5, 'rgba(220,90,50,0.30)');
      halo.addColorStop(1, 'rgba(110,20,10,0)');
    }
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, reach, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = halo;
    ctx.fillRect(cx - reach, cy - reach, reach * 2, reach * 2);
    ctx.restore();

    // Convection mottling
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const blobs = 10;
    for (let i = 0; i < blobs; i++) {
      const ang = rng() * Math.PI * 2;
      const rad = rng() * 0.7;
      const px = cx + Math.cos(ang) * rad * r;
      const py = cy + Math.sin(ang) * rad * r;
      const sz = range(rng, 0.15, 0.35) * r;
      const a = crisp ? range(rng, 0.3, 0.55) : range(rng, 0.15, 0.30);
      const g = ctx.createRadialGradient(px, py, 0, px, py, sz);
      g.addColorStop(0, `rgba(255,235,200,${a})`);
      g.addColorStop(0.5, `rgba(255,170,90,${a * 0.6})`);
      g.addColorStop(1, 'rgba(255,120,40,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px, py, sz, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    // Limb darkening
    if (crisp) {
      const limb = ctx.createRadialGradient(cx, cy, r * 0.85, cx, cy, r * 1.05);
      limb.addColorStop(0, 'rgba(0,0,0,0)');
      limb.addColorStop(0.92, 'rgba(60,15,5,0.5)');
      limb.addColorStop(1, 'rgba(20,5,0,0)');
      ctx.fillStyle = limb;
      ctx.beginPath(); ctx.arc(cx, cy, r * 1.05, 0, Math.PI * 2); ctx.fill();
    }

    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 0.9);
    core.addColorStop(0, 'rgba(255,235,210,0.9)');
    core.addColorStop(0.6, 'rgba(255,170,100,0.35)');
    core.addColorStop(1, 'rgba(255,140,80,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.9, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  // ---- Blue supergiant -------------------------------------------------
  function jwstBlueSupergiant(ctx, cx, cy, r, rng, crisp) {
    const reach = r * 3.4;
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
    halo.addColorStop(0, 'rgba(255,250,235,1)');
    halo.addColorStop(0.06, 'rgba(220,235,255,0.95)');
    halo.addColorStop(0.18, 'rgba(160,200,255,0.55)');
    halo.addColorStop(0.4, 'rgba(80,130,230,0.22)');
    halo.addColorStop(0.7, 'rgba(40,70,180,0.08)');
    halo.addColorStop(1, 'rgba(0,10,80,0)');
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, reach, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = halo;
    ctx.fillRect(cx - reach, cy - reach, reach * 2, reach * 2);
    ctx.restore();

    if (crisp) drawJwstSpikes(ctx, cx, cy, r, '220,235,255', 6, true);
    else drawJwstSpikes(ctx, cx, cy, r, '220,235,255', 4, false);

    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.4);
    core.addColorStop(0, 'rgba(255,250,235,1)');
    core.addColorStop(0.3, 'rgba(220,230,255,0.95)');
    core.addColorStop(0.65, 'rgba(150,180,255,0.5)');
    core.addColorStop(1, 'rgba(60,120,220,0)');
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.4, 0, Math.PI * 2); ctx.fill();
  }

  // ---- White dwarf -----------------------------------------------------
  function jwstWhiteDwarf(ctx, cx, cy, r, rng, crisp) {
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.6);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.35, 'rgba(240,245,255,0.85)');
    grad.addColorStop(0.65, 'rgba(200,220,255,0.30)');
    grad.addColorStop(1, 'rgba(160,190,240,0)');
    ctx.fillStyle = grad;
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.6, 0, Math.PI * 2); ctx.fill();

    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    const wisps = 6;
    for (let i = 0; i < wisps; i++) {
      const ang = rng() * Math.PI * 2;
      const len = range(rng, 1.6, 2.4) * r;
      const ix = cx + Math.cos(ang) * r * 1.05;
      const iy = cy + Math.sin(ang) * r * 1.05;
      const ox = cx + Math.cos(ang) * len;
      const oy = cy + Math.sin(ang) * len;
      const g = ctx.createLinearGradient(ix, iy, ox, oy);
      g.addColorStop(0, `rgba(220,235,255,${crisp ? 0.6 : 0.4})`);
      g.addColorStop(1, 'rgba(160,200,255,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = crisp ? 0.9 : 1.4;
      ctx.beginPath(); ctx.moveTo(ix, iy); ctx.lineTo(ox, oy); ctx.stroke();
    }
    ctx.restore();
  }

  // ---- Neutron star ----------------------------------------------------
  function jwstNeutronStar(ctx, cx, cy, r, rng, crisp) {
    const reach = r * 2.4;
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
    halo.addColorStop(0, 'rgba(255,180,170,0.25)');
    halo.addColorStop(0.5, 'rgba(160,90,110,0.10)');
    halo.addColorStop(1, 'rgba(80,40,60,0)');
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, reach, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = halo;
    ctx.fillRect(cx - reach, cy - reach, reach * 2, reach * 2);
    ctx.restore();

    const dots = crisp ? 38 : 26;
    for (let i = 0; i < dots; i++) {
      const u = rng() * 2 - 1, v = rng() * 2 - 1;
      if (u * u + v * v > 0.85) { i--; continue; }
      const px = cx + u * r * 0.85, py = cy + v * r * 0.85;
      const dr = range(rng, 0.10, 0.18) * r;
      const isRed = rng() < 0.6;
      const col = isRed ? '255,90,80' : '220,225,235';
      const glow = isRed ? '255,150,120' : '180,190,210';
      const g = ctx.createRadialGradient(px, py, 0, px, py, dr * 2.2);
      g.addColorStop(0, `rgba(${glow},${crisp ? 0.55 : 0.35})`);
      g.addColorStop(1, `rgba(${glow},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px, py, dr * 2.2, 0, Math.PI * 2); ctx.fill();
      const cg = ctx.createRadialGradient(px, py, 0, px, py, dr);
      cg.addColorStop(0, 'rgba(255,255,255,0.95)');
      cg.addColorStop(0.4, `rgba(${col},0.95)`);
      cg.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = cg;
      ctx.beginPath(); ctx.arc(px, py, dr, 0, Math.PI * 2); ctx.fill();
    }
  }

  // ---- Pulsar ----------------------------------------------------------
  function jwstPulsar(ctx, cx, cy, r, rng, crisp) {
    const tilt = rng() * Math.PI;
    const reach = r * 2.5;
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
    halo.addColorStop(0, 'rgba(210,235,255,0.55)');
    halo.addColorStop(0.4, 'rgba(130,185,250,0.20)');
    halo.addColorStop(1, 'rgba(40,80,170,0)');
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, reach, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = halo;
    ctx.fillRect(cx - reach, cy - reach, reach * 2, reach * 2);
    ctx.restore();

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const sign of [1, -1]) {
      const ang = tilt + (sign < 0 ? Math.PI : 0);
      const tx = cx + Math.cos(ang) * r * 4.5;
      const ty = cy + Math.sin(ang) * r * 4.5;
      const px = -Math.sin(ang), py = Math.cos(ang);
      const w = r * 0.55;
      const g = ctx.createLinearGradient(cx, cy, tx, ty);
      g.addColorStop(0, `rgba(220,240,255,${crisp ? 0.95 : 0.7})`);
      g.addColorStop(0.4, `rgba(160,210,255,${crisp ? 0.5 : 0.3})`);
      g.addColorStop(1, 'rgba(80,140,220,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx + px * w * 0.25, cy + py * w * 0.25);
      ctx.lineTo(tx + px * w, ty + py * w);
      ctx.lineTo(tx - px * w, ty - py * w);
      ctx.lineTo(cx - px * w * 0.25, cy - py * w * 0.25);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(0.5, 'rgba(220,240,255,0.7)');
    core.addColorStop(1, 'rgba(120,170,240,0)');
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();
  }

  // ---- Binary ----------------------------------------------------------
  function jwstBinary(ctx, cx, cy, r, rng, crisp) {
    const sep = r * 1.1;
    const ang = rng() * Math.PI;
    const ux = Math.cos(ang), uy = Math.sin(ang);
    const x1 = cx - ux * sep, y1 = cy - uy * sep;
    const x2 = cx + ux * sep, y2 = cy + uy * sep;
    const reach = r * 3;
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
    halo.addColorStop(0, 'rgba(255,220,180,0.4)');
    halo.addColorStop(0.5, 'rgba(220,90,60,0.15)');
    halo.addColorStop(1, 'rgba(120,40,30,0)');
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, reach, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = halo;
    ctx.fillRect(cx - reach, cy - reach, reach * 2, reach * 2);
    ctx.restore();
    function star(x, y, rr, palette) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, rr * 1.4);
      palette.forEach(([t, c]) => g.addColorStop(t, c));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, rr * 1.4, 0, Math.PI * 2); ctx.fill();
    }
    star(x1, y1, r * 0.9, [[0, 'rgba(255,245,215,1)'], [0.4, 'rgba(255,200,140,0.9)'], [1, 'rgba(220,90,40,0)']]);
    star(x2, y2, r * 0.7, [[0, 'rgba(255,235,200,1)'], [0.4, 'rgba(255,170,110,0.9)'], [1, 'rgba(180,60,40,0)']]);
  }

  // ---- Quasar ----------------------------------------------------------
  function jwstQuasar(ctx, cx, cy, r, rng, crisp) {
    const tilt = rng() * Math.PI;
    const reach = r * 2.4;
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, reach);
    halo.addColorStop(0, 'rgba(255,220,255,0.6)');
    halo.addColorStop(0.6, 'rgba(160,80,220,0.15)');
    halo.addColorStop(1, 'rgba(80,30,160,0)');
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, reach, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = halo;
    ctx.fillRect(cx - reach, cy - reach, reach * 2, reach * 2);
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.scale(1, 0.32);
    const disc = ctx.createRadialGradient(0, 0, r * 0.4, 0, 0, r * 1.8);
    disc.addColorStop(0, 'rgba(255,210,140,0)');
    disc.addColorStop(0.55, 'rgba(255,210,160,0.85)');
    disc.addColorStop(1, 'rgba(120,40,30,0)');
    ctx.fillStyle = disc;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt + Math.PI / 2);
    ctx.globalCompositeOperation = 'lighter';
    for (const sign of [1, -1]) {
      const ty = sign * r * 4;
      const g = ctx.createLinearGradient(0, 0, 0, ty);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.5, 'rgba(255,210,255,0.4)');
      g.addColorStop(1, 'rgba(180,80,220,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-r * 0.12, 0); ctx.lineTo(-r * 0.4, ty);
      ctx.lineTo(r * 0.4, ty); ctx.lineTo(r * 0.12, 0);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();

    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.4);
    core.addColorStop(0, 'rgba(255,255,255,1)');
    core.addColorStop(0.4, 'rgba(255,225,255,0.95)');
    core.addColorStop(1, 'rgba(160,60,220,0)');
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.4, 0, Math.PI * 2); ctx.fill();
  }

  // ---- Black hole ------------------------------------------------------
  function jwstBlackHole(ctx, cx, cy, r, rng, crisp) {
    const tilt = rng() * Math.PI;
    const inner = r * 0.95;
    const ringW = r * 0.5;
    const reach = r * 3.5;
    const warp = ctx.createRadialGradient(cx, cy, r * 1.3, cx, cy, reach);
    warp.addColorStop(0, 'rgba(80,40,100,0.4)');
    warp.addColorStop(0.6, 'rgba(50,25,80,0.2)');
    warp.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, reach, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = warp;
    ctx.fillRect(cx - reach, cy - reach, reach * 2, reach * 2);
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.globalCompositeOperation = 'lighter';
    const outer = inner + ringW;
    const ring = ctx.createRadialGradient(0, 0, inner, 0, 0, outer);
    ring.addColorStop(0, 'rgba(255,140,40,0)');
    ring.addColorStop(0.5, 'rgba(255,210,130,0.95)');
    ring.addColorStop(1, 'rgba(255,140,40,0)');
    ctx.fillStyle = ring;
    ctx.beginPath(); ctx.arc(0, 0, outer, 0, Math.PI * 2); ctx.fill();
    ctx.scale(1, 0.55);
    ctx.strokeStyle = 'rgba(255,220,140,0.7)';
    ctx.lineWidth = ringW * 0.2;
    ctx.beginPath(); ctx.arc(0, 0, (inner + outer) / 2 / 0.55, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.beginPath(); ctx.arc(cx, cy, inner * 0.92, 0, Math.PI * 2); ctx.fill();
  }

  // ---- Nebula (cloud) --------------------------------------------------
  // Procedural nebula via stacked turbulent blobs:
  //  1. Many small additive blobs in 3 color bands (octave-like)
  //  2. Filament strokes (curved Bezier glows)
  //  3. Dark dust lane via destination-out blobs
  //  4. Bright Hα emission knots
  function paintNebulaCloud(ctx, cx, cy, R, rng, opts) {
    const {
      bands,         // [[r,g,b], ...] base palette (warm + cool)
      hot,           // [[r,g,b], ...] emission knots
      dustAlpha,     // 0..1 amount of dark lanes
      filaments,     // count of filament strokes
      shape,         // {ax, ay, rot} elliptical bias
      crisp,
    } = opts;
    const ax = (shape && shape.ax) || 1;
    const ay = (shape && shape.ay) || 0.7;
    const rot = (shape && shape.rot) || 0;
    const cosR = Math.cos(rot), sinR = Math.sin(rot);
    function place() {
      // Sample within an ellipse, biased toward center
      const t = Math.pow(rng(), 1.6);   // bias: more density near center
      const a = rng() * Math.PI * 2;
      const lx = Math.cos(a) * t * R * ax;
      const ly = Math.sin(a) * t * R * ay;
      return { x: cx + lx * cosR - ly * sinR, y: cy + lx * sinR + ly * cosR };
    }

    ctx.save();
    // Soft circular clip so the cloud has no rectangular edge
    ctx.beginPath(); ctx.arc(cx, cy, R * 1.05, 0, Math.PI * 2); ctx.clip();

    // -------- Pass 1: large dim diffuse base in band[0] (cool) ---------
    ctx.globalCompositeOperation = 'lighter';
    const intensity = opts.intensity || 1;
    const baseLayers = crisp ? 14 : 8;
    for (let i = 0; i < baseLayers; i++) {
      const p = place();
      const sz = range(rng, R * 0.4, R * 0.9);
      const c = bands[0];
      const a = range(rng, 0.05, 0.14) * intensity;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, sz);
      g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${a})`);
      g.addColorStop(0.6, `rgba(${c[0]},${c[1]},${c[2]},${a * 0.35})`);
      g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx.fill();
    }

    // -------- Pass 2: medium accent blobs (warm + magenta) -------------
    const accentLayers = crisp ? 22 : 10;
    for (let i = 0; i < accentLayers; i++) {
      const p = place();
      const sz = range(rng, R * 0.18, R * 0.45);
      const c = pick(rng, bands.slice(1)); // any non-base band
      const a = range(rng, 0.10, 0.28) * intensity;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, sz);
      g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${a})`);
      g.addColorStop(0.55, `rgba(${c[0]},${c[1]},${c[2]},${a * 0.4})`);
      g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx.fill();
    }

    // -------- Pass 3: tiny bright detail blobs (highest octave) --------
    const detailLayers = crisp ? 60 : 25;
    for (let i = 0; i < detailLayers; i++) {
      const p = place();
      const sz = range(rng, R * 0.04, R * 0.16);
      const c = pick(rng, bands);
      const a = range(rng, 0.18, 0.45) * intensity;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, sz);
      g.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},${a})`);
      g.addColorStop(0.5, `rgba(${c[0]},${c[1]},${c[2]},${a * 0.3})`);
      g.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx.fill();
    }

    // -------- Pass 4: filament strokes ---------------------------------
    // Curved 3-segment Beziers, each painted with a soft gradient stroke
    // to read as a wispy ridge of glowing gas.
    for (let i = 0; i < filaments; i++) {
      const p0 = place();
      const len = range(rng, R * 0.3, R * 0.7);
      const dir = rng() * Math.PI * 2;
      const ex = p0.x + Math.cos(dir) * len;
      const ey = p0.y + Math.sin(dir) * len;
      const cp1x = p0.x + Math.cos(dir) * len * 0.33 + range(rng, -R * 0.18, R * 0.18);
      const cp1y = p0.y + Math.sin(dir) * len * 0.33 + range(rng, -R * 0.18, R * 0.18);
      const cp2x = p0.x + Math.cos(dir) * len * 0.66 + range(rng, -R * 0.18, R * 0.18);
      const cp2y = p0.y + Math.sin(dir) * len * 0.66 + range(rng, -R * 0.18, R * 0.18);
      const c = pick(rng, bands);
      const a = range(rng, 0.06, 0.13);
      ctx.strokeStyle = `rgba(${c[0]},${c[1]},${c[2]},${a})`;
      ctx.lineWidth = range(rng, R * 0.05, R * 0.12);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, ex, ey);
      ctx.stroke();
    }

    // -------- Pass 5: dark dust lanes (subtractive) --------------------
    if (dustAlpha > 0) {
      ctx.globalCompositeOperation = 'destination-out';
      const dustCount = crisp ? 18 : 10;
      for (let i = 0; i < dustCount; i++) {
        const p = place();
        const sz = range(rng, R * 0.10, R * 0.32);
        const a = range(rng, dustAlpha * 0.4, dustAlpha);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, sz);
        g.addColorStop(0, `rgba(0,0,0,${a})`);
        g.addColorStop(0.6, `rgba(0,0,0,${a * 0.3})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx.fill();
      }
    }

    // -------- Pass 6: bright Hα emission knots -------------------------
    if (!opts.skipKnots) {
      ctx.globalCompositeOperation = 'lighter';
      const knots = crisp ? 10 : 4;
      for (let i = 0; i < knots; i++) {
        const p = place();
        const sz = range(rng, R * 0.010, R * 0.028);
        const c = pick(rng, hot);
        const bg = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, sz * 4);
        bg.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.30)`);
        bg.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
        ctx.fillStyle = bg;
        ctx.beginPath(); ctx.arc(p.x, p.y, sz * 4, 0, Math.PI * 2); ctx.fill();
        const hc = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, sz);
        hc.addColorStop(0, `rgba(${c[0]},${c[1]},${c[2]},0.7)`);
        hc.addColorStop(1, `rgba(${c[0]},${c[1]},${c[2]},0)`);
        ctx.fillStyle = hc;
        ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx.fill();
      }
    }

    ctx.restore();
  }

  function jwstNebula(ctx, cx, cy, r, rng, crisp) {
    paintNebulaCloud(ctx, cx, cy, r * 2.4, rng, {
      // Carina-inspired: warm peach base, gold highlights, deep teal
      // shadow, magenta accents, hot blue-white knots
      bands: [
        [55, 90, 120],     // deep teal/blue (cool base)
        [180, 130, 90],    // warm tan
        [230, 170, 110],   // gold
        [200, 100, 130],   // dusty magenta
        [120, 200, 200],   // teal highlight
      ],
      hot: [[255, 220, 180], [220, 240, 255], [255, 180, 140]],
      dustAlpha: crisp ? 0.55 : 0.25,
      filaments: crisp ? 9 : 4,
      shape: { ax: 1.0, ay: 0.78, rot: rng() * Math.PI },
      crisp,
    });
  }

  // ====================================================================
  //  VAPOR — CURRENT (degraded) and PROPOSED (CRT-arcade crisp)
  // ====================================================================
  function vaporCurrent(canvas, type, seed) {
    const { ctx, w, h } = fitCanvas(canvas, 1);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    drawVaporBg(ctx, w, h, /*crisp=*/false);
    drawVaporStar(ctx, w / 2, h / 2, Math.min(w, h) * 0.18, rng32(seed), type, false);
  }
  function vaporProposed(canvas, type, seed) {
    const { ctx, w, h } = fitCanvas(canvas, window.devicePixelRatio || 2);
    ctx.imageSmoothingEnabled = false; // crisp pixel-art edges for vapor
    drawVaporBg(ctx, w, h, true);
    drawVaporStar(ctx, w / 2, h / 2, Math.min(w, h) * 0.18, rng32(seed), type, true);
    // Final pass: scanlines + chromatic aberration
    drawScanlines(ctx, w, h);
    if (type !== 'nebula') drawChromaticAberration(ctx, w / 2, h / 2, Math.min(w, h) * 0.18);
  }

  function drawVaporBg(ctx, w, h, crisp) {
    const stops = crisp
      ? [[0, '#0a0028'], [0.45, '#3a0066'], [0.6, '#a01080'], [0.78, '#ff3a8a'], [0.9, '#ff7e1a'], [1, '#100018']]
      : [[0, '#1a0033'], [0.5, '#5a0080'], [0.85, '#ff7e1a'], [1, '#1a0033']];
    const g = ctx.createLinearGradient(0, 0, 0, h);
    stops.forEach(([t, c]) => g.addColorStop(t, c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    if (crisp) {
      // Tron grid horizon — vanishing-point perspective
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 245, 255, 0.55)';
      ctx.lineWidth = 1;
      const horizon = h * 0.58;
      for (let i = 0; i < 8; i++) {
        const y = horizon + (h - horizon) * (i / 8) * (i / 8);
        ctx.globalAlpha = 0.25 + i * 0.08;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }
      const vpx = w / 2;
      ctx.strokeStyle = 'rgba(255, 42, 252, 0.55)';
      for (let i = -7; i <= 7; i++) {
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.moveTo(vpx, horizon);
        ctx.lineTo(vpx + i * (w / 14), h);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawScanlines(ctx, w, h) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
    ctx.restore();
  }
  function drawChromaticAberration(ctx, cx, cy, r) {
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = 'rgba(255, 0, 122, 0.20)';
    ctx.beginPath(); ctx.arc(cx - 2, cy, r * 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(0, 245, 255, 0.20)';
    ctx.beginPath(); ctx.arc(cx + 2, cy, r * 0.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawVaporStar(ctx, cx, cy, r, rng, type, crisp) {
    switch (type) {
      case 'main-sequence': return vaporMainSequence(ctx, cx, cy, r, rng, crisp);
      case 'red-giant': return vaporRedGiant(ctx, cx, cy, r, rng, crisp);
      case 'blue-supergiant': return vaporBlueSupergiant(ctx, cx, cy, r, rng, crisp);
      case 'white-dwarf': return vaporWhiteDwarf(ctx, cx, cy, r, rng, crisp);
      case 'neutron-star': return vaporNeutronStar(ctx, cx, cy, r, rng, crisp);
      case 'pulsar': return vaporPulsar(ctx, cx, cy, r, rng, crisp);
      case 'binary': return vaporBinary(ctx, cx, cy, r, rng, crisp);
      case 'quasar': return vaporQuasar(ctx, cx, cy, r, rng, crisp);
      case 'black-hole': return vaporBlackHole(ctx, cx, cy, r, rng, crisp);
      case 'nebula': return vaporNebula(ctx, cx, cy, r, rng, crisp);
      default: return vaporMainSequence(ctx, cx, cy, r, rng, crisp);
    }
  }

  function postDisc(ctx, cx, cy, R, bands) {
    const ordered = [...bands].sort((a, b) => b[0] - a[0]);
    for (const [t, col] of ordered) {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(cx, cy, R * t, 0, Math.PI * 2); ctx.fill();
    }
  }
  function vaporMainSequence(ctx, cx, cy, r, rng, crisp) {
    postDisc(ctx, cx, cy, r * 1.9, [
      [1.0, 'rgba(120,0,100,0)'],
      [0.82, 'rgba(255,0,122,0.55)'],
      [0.62, 'rgba(255,140,40,0.85)'],
      [0.42, 'rgba(255,242,0,0.95)'],
      [0.22, 'rgba(255,255,255,1)'],
    ]);
    if (crisp) {
      ctx.strokeStyle = 'rgba(0,245,255,0.85)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, r * 0.82, 0, Math.PI * 2); ctx.stroke();
    }
  }
  function vaporRedGiant(ctx, cx, cy, r, rng, crisp) {
    postDisc(ctx, cx, cy, r * 3.0, [
      [1.0, 'rgba(40,0,60,0)'],
      [0.85, 'rgba(120,0,100,0.3)'],
      [0.6, 'rgba(255,0,122,0.55)'],
      [0.4, 'rgba(255,42,252,0.95)'],
      [0.22, 'rgba(255,200,240,1)'],
    ]);
    // Pixel mottling
    const blocks = crisp ? 14 : 8;
    for (let i = 0; i < blocks; i++) {
      const ang = rng() * Math.PI * 2;
      const rad = rng() * 0.7;
      const sz = range(rng, 0.10, 0.20) * r;
      const px = cx + Math.cos(ang) * rad * r - sz / 2;
      const py = cy + Math.sin(ang) * rad * r - sz / 2;
      ctx.fillStyle = pick(rng, [
        'rgba(255,0,122,0.9)', 'rgba(255,42,252,1)', 'rgba(255,242,0,0.8)',
      ]);
      ctx.fillRect(px, py, sz, sz);
    }
    // Cyan electric arcs (jagged)
    if (crisp) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0,245,255,1)';
      ctx.lineWidth = 1.5;
      ctx.shadowColor = 'rgba(0,245,255,0.9)';
      ctx.shadowBlur = 6;
      for (let i = 0; i < 3; i++) {
        const ang = rng() * Math.PI * 2;
        const sx = cx + Math.cos(ang) * r;
        const sy = cy + Math.sin(ang) * r;
        const ex = cx + Math.cos(ang) * r * 1.6;
        const ey = cy + Math.sin(ang) * r * 1.6;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        for (let k = 1; k <= 5; k++) {
          const t = k / 5;
          const lx = sx + (ex - sx) * t + range(rng, -3, 3);
          const ly = sy + (ey - sy) * t + range(rng, -3, 3);
          ctx.lineTo(lx, ly);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  function vaporBlueSupergiant(ctx, cx, cy, r, rng, crisp) {
    postDisc(ctx, cx, cy, r * 3.0, [
      [1.0, 'rgba(0,30,80,0)'],
      [0.85, 'rgba(0,60,160,0.3)'],
      [0.55, 'rgba(0,245,255,0.6)'],
      [0.35, 'rgba(140,255,255,0.95)'],
      [0.20, 'rgba(255,255,255,1)'],
    ]);
    // Hyper-yellow X spikes
    ctx.save();
    ctx.translate(cx, cy);
    const reach = r * 3;
    ctx.strokeStyle = 'rgba(255,242,0,1)';
    ctx.lineWidth = crisp ? 2.4 : 1.6;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(-Math.cos(a) * reach, -Math.sin(a) * reach);
      ctx.lineTo(Math.cos(a) * reach, Math.sin(a) * reach);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,1)';
    ctx.lineWidth = crisp ? 1.2 : 0.8;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(-Math.cos(a) * reach, -Math.sin(a) * reach);
      ctx.lineTo(Math.cos(a) * reach, Math.sin(a) * reach);
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(0,245,255,1)';
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,42,252,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.32, 0, Math.PI * 2); ctx.fill();
  }
  function vaporWhiteDwarf(ctx, cx, cy, r, rng, crisp) {
    postDisc(ctx, cx, cy, r * 1.7, [
      [1.0, 'rgba(255,0,122,0)'],
      [0.78, 'rgba(255,0,122,0.45)'],
      [0.62, 'rgba(0,245,255,0.6)'],
      [0.46, 'rgba(57,255,20,0.85)'],
      [0.28, 'rgba(255,255,255,1)'],
    ]);
    if (crisp) {
      ctx.save();
      ctx.strokeStyle = 'rgba(0,245,255,0.95)';
      ctx.lineWidth = 1;
      ctx.shadowColor = 'rgba(0,245,255,0.8)';
      ctx.shadowBlur = 5;
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * r * 1.05, cy + Math.sin(ang) * r * 1.05);
        ctx.lineTo(cx + Math.cos(ang) * r * 2.2, cy + Math.sin(ang) * r * 2.2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  function vaporNeutronStar(ctx, cx, cy, r, rng, crisp) {
    const dots = crisp ? 38 : 25;
    for (let i = 0; i < dots; i++) {
      let u = rng() * 2 - 1, v = rng() * 2 - 1;
      if (u * u + v * v > 0.85) { i--; continue; }
      const px = cx + u * r, py = cy + v * r;
      const sz = range(rng, 1.2, 2.4);
      ctx.fillStyle = pick(rng, [
        'rgba(255,42,252,1)', 'rgba(0,245,255,1)', 'rgba(255,242,0,1)',
      ]);
      ctx.beginPath(); ctx.arc(px, py, sz, 0, Math.PI * 2); ctx.fill();
      if (crisp) {
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 0.6;
        ctx.beginPath(); ctx.arc(px, py, sz + 0.4, 0, Math.PI * 2); ctx.stroke();
      }
    }
  }
  function vaporPulsar(ctx, cx, cy, r, rng, crisp) {
    const tilt = rng() * Math.PI;
    postDisc(ctx, cx, cy, r * 2.5, [
      [1.0, 'rgba(0,0,60,0)'],
      [0.55, 'rgba(0,245,255,0.45)'],
      [0.35, 'rgba(255,42,252,0.7)'],
      [0.18, 'rgba(255,255,255,1)'],
    ]);
    for (const sign of [1, -1]) {
      const ang = tilt + (sign < 0 ? Math.PI : 0);
      const tx = cx + Math.cos(ang) * r * 4;
      const ty = cy + Math.sin(ang) * r * 4;
      const px = -Math.sin(ang), py = Math.cos(ang);
      const w = r * 0.5;
      ctx.fillStyle = 'rgba(0,245,255,0.9)';
      ctx.beginPath();
      ctx.moveTo(cx + px * w * 0.25 - Math.cos(ang) * 3, cy + py * w * 0.25 - Math.sin(ang) * 3);
      ctx.lineTo(tx + px * w - Math.cos(ang) * 3, ty + py * w - Math.sin(ang) * 3);
      ctx.lineTo(tx - px * w - Math.cos(ang) * 3, ty - py * w - Math.sin(ang) * 3);
      ctx.lineTo(cx - px * w * 0.25 - Math.cos(ang) * 3, cy - py * w * 0.25 - Math.sin(ang) * 3);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,42,252,0.9)';
      ctx.beginPath();
      ctx.moveTo(cx + px * w * 0.25 + Math.cos(ang) * 3, cy + py * w * 0.25 + Math.sin(ang) * 3);
      ctx.lineTo(tx + px * w + Math.cos(ang) * 3, ty + py * w + Math.sin(ang) * 3);
      ctx.lineTo(tx - px * w + Math.cos(ang) * 3, ty - py * w + Math.sin(ang) * 3);
      ctx.lineTo(cx - px * w * 0.25 + Math.cos(ang) * 3, cy - py * w * 0.25 + Math.sin(ang) * 3);
      ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2); ctx.fill();
  }
  function vaporBinary(ctx, cx, cy, r, rng, crisp) {
    const sep = r;
    const ang = rng() * Math.PI;
    const x1 = cx - Math.cos(ang) * sep, y1 = cy - Math.sin(ang) * sep;
    const x2 = cx + Math.cos(ang) * sep, y2 = cy + Math.sin(ang) * sep;
    postDisc(ctx, x1, y1, r * 1.3, [
      [1.0, 'rgba(255,0,122,0)'],
      [0.8, 'rgba(255,0,122,0.6)'],
      [0.5, 'rgba(255,42,252,0.9)'],
      [0.25, 'rgba(255,242,0,1)'],
    ]);
    postDisc(ctx, x2, y2, r * 1.0, [
      [1.0, 'rgba(0,60,160,0)'],
      [0.8, 'rgba(0,245,255,0.6)'],
      [0.5, 'rgba(140,255,255,0.9)'],
      [0.25, 'rgba(57,255,20,1)'],
    ]);
  }
  function vaporQuasar(ctx, cx, cy, r, rng, crisp) {
    const tilt = rng() * Math.PI;
    postDisc(ctx, cx, cy, r * 2.4, [
      [1.0, 'rgba(20,0,60,0)'],
      [0.55, 'rgba(255,42,252,0.5)'],
      [0.30, 'rgba(255,200,240,0.9)'],
    ]);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt + Math.PI / 2);
    for (const sign of [1, -1]) {
      const ty = sign * r * 4;
      ctx.fillStyle = 'rgba(57,255,20,0.85)';
      ctx.fillRect(-r * 0.5, 0, r, ty);
      ctx.fillStyle = 'rgba(57,255,20,1)';
      ctx.fillRect(-r * 0.2, 0, r * 0.4, ty);
      ctx.fillStyle = 'rgba(255,255,255,1)';
      ctx.fillRect(-r * 0.06, 0, r * 0.12, ty);
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.beginPath(); ctx.arc(cx, cy, r * 0.85, 0, Math.PI * 2); ctx.fill();
  }
  function vaporBlackHole(ctx, cx, cy, r, rng, crisp) {
    const tilt = rng() * Math.PI;
    const inner = r;
    const outer = r * 1.5;
    postDisc(ctx, cx, cy, r * 3.2, [
      [1.0, 'rgba(0,0,0,0)'],
      [0.55, 'rgba(90,0,255,0.4)'],
      [0.40, 'rgba(255,0,122,0.6)'],
    ]);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(tilt);
    ctx.scale(1, 0.55);
    const bands = [
      [outer, 'rgba(255,42,252,0.9)'],
      [outer * 0.78, 'rgba(255,0,122,0.95)'],
      [outer * 0.62, 'rgba(90,0,255,0.85)'],
    ];
    for (const [rr, c] of bands) {
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,1)';
    ctx.beginPath(); ctx.arc(cx, cy, inner * 0.92, 0, Math.PI * 2); ctx.fill();
  }
  function vaporNebula(ctx, cx, cy, r, rng, crisp) {
    paintNebulaCloud(ctx, cx, cy, r * 2.4, rng, {
      bands: [
        [70, 20, 90],      // deep purple base
        [255, 42, 252],    // magenta
        [0, 245, 255],     // cyan
        [120, 60, 200],    // violet
        [255, 0, 122],     // hot pink
      ],
      hot: [[57, 255, 20], [255, 242, 0], [255, 255, 255]],
      dustAlpha: crisp ? 0.45 : 0.20,
      filaments: crisp ? 8 : 3,
      shape: { ax: 1.0, ay: 0.8, rot: rng() * Math.PI },
      crisp,
    });
  }

  // Transparent-bg star renderer — same crisp star drawer but skips the
  // deep-field background paint, so it can be composited onto an
  // existing scene without leaving a visible tile rectangle.
  function jwstStarOnly(canvas, type, seed) {
    const { ctx, w, h } = fitCanvas(canvas, window.devicePixelRatio || 2);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    drawJwstStar(ctx, w / 2, h / 2, Math.min(w, h) * 0.18, rng32(seed), type, /*crisp=*/true);
  }

  function vaporStarOnly(canvas, type, seed) {
    const { ctx, w, h } = fitCanvas(canvas, window.devicePixelRatio || 2);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    drawVaporStar(ctx, w / 2, h / 2, Math.min(w, h) * 0.18, rng32(seed), type, true);
  }

  // ----- public API -----------------------------------------------------
  window.StarGfx = {
    jwstCurrent, jwstProposed, jwstStarOnly, vaporCurrent, vaporProposed, vaporStarOnly,
    drawDeepFieldBackground, drawVaporBg, drawScanlines,
  };
})();
