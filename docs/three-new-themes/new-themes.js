/* New theme renderers for the v2 pitch deck:
 *  - atari:    8-bit pixel art, 8-color palette, blocky halos
 *  - lost:     non-celestial — astronauts, ships, asteroids per "star type"
 *  - bio:      bioluminescent botanical — watercolor + ink + glow
 */
(function () {
  'use strict';
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
  function fitCanvas(canvas, dpr) {
    const cssW = canvas.clientWidth || canvas.width;
    const cssH = canvas.clientHeight || canvas.height;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: cssW, h: cssH };
  }

  // ============================================================
  //  ATARI LOW-RES — 8-bit pixel art
  // ============================================================
  // 8-color Atari-ish palette
  const ATARI = {
    bg: '#1a1a2e', dark: '#0a0a1a', white: '#fff8d8', yellow: '#ffd23f',
    orange: '#ff7f3f', red: '#e63946', cyan: '#7fdbff', green: '#7be3a8',
    purple: '#a06cd5', magenta: '#ff5fb4',
  };
  function atariPx(ctx, x, y, sz, color) {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x), Math.round(y), sz, sz);
  }
  function atariBg(ctx, w, h, seed) {
    ctx.fillStyle = ATARI.bg;
    ctx.fillRect(0, 0, w, h);
    const r = rng32(seed ^ 0xA7A7);
    // Pixel stars on bg
    const px = Math.max(2, Math.round(Math.min(w, h) / 200));
    for (let i = 0; i < 80; i++) {
      const x = Math.round(r() * w / px) * px;
      const y = Math.round(r() * h / px) * px;
      const c = pick(r, [ATARI.white, ATARI.yellow, ATARI.cyan]);
      atariPx(ctx, x, y, px, c);
    }
  }
  function atariStar(canvas, type, seed) {
    const { ctx, w, h } = fitCanvas(canvas, window.devicePixelRatio || 2);
    ctx.imageSmoothingEnabled = false;
    atariBg(ctx, w, h, seed);
    drawAtariStar(ctx, w / 2, h / 2, Math.min(w, h) * 0.22, rng32(seed), type);
  }
  function drawAtariStar(ctx, cx, cy, R, rng, type) {
    // Pixel size scales with star size; cap so detail stays chunky.
    const px = Math.max(3, Math.round(R / 16));
    function disc(rad, color) {
      const rr = Math.round(rad / px);
      for (let dy = -rr; dy <= rr; dy++) {
        for (let dx = -rr; dx <= rr; dx++) {
          if (dx * dx + dy * dy <= rr * rr) {
            atariPx(ctx, cx + dx * px, cy + dy * px, px, color);
          }
        }
      }
    }
    function ring(rad, color, dither) {
      const rr = Math.round(rad / px);
      for (let dy = -rr; dy <= rr; dy++) {
        for (let dx = -rr; dx <= rr; dx++) {
          const d = dx * dx + dy * dy;
          if (d <= rr * rr && d >= (rr - 1) * (rr - 1)) {
            if (!dither || (dx + dy) % 2 === 0) {
              atariPx(ctx, cx + dx * px, cy + dy * px, px, color);
            }
          }
        }
      }
    }
    function spike(ang, len, color) {
      const steps = Math.round(len / px);
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        const r = len * t;
        if (rng() > t * 0.5) {
          atariPx(ctx, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r, px, color);
        }
      }
    }
    switch (type) {
      case 'main-sequence': {
        // Bullseye: red→orange→yellow→white
        disc(R, ATARI.red);
        disc(R * 0.75, ATARI.orange);
        disc(R * 0.5, ATARI.yellow);
        disc(R * 0.22, ATARI.white);
        for (let i = 0; i < 4; i++) spike((i / 4) * Math.PI, R * 1.6, ATARI.yellow);
        break;
      }
      case 'red-giant': {
        disc(R * 1.2, ATARI.red);
        ring(R * 1.05, ATARI.orange, true);
        disc(R * 0.7, ATARI.orange);
        disc(R * 0.4, ATARI.yellow);
        // Mottled pixels for convection
        for (let i = 0; i < 24; i++) {
          const ang = rng() * Math.PI * 2;
          const rad = rng() * R * 0.9;
          atariPx(ctx, cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad, px,
            pick(rng, [ATARI.yellow, ATARI.white, ATARI.red]));
        }
        break;
      }
      case 'blue-supergiant': {
        disc(R * 1.1, ATARI.purple);
        disc(R * 0.85, ATARI.cyan);
        disc(R * 0.45, ATARI.white);
        for (let i = 0; i < 4; i++) spike((i / 4) * Math.PI, R * 2, ATARI.cyan);
        for (let i = 0; i < 4; i++) spike((i / 4) * Math.PI + Math.PI / 4, R * 1.4, ATARI.white);
        break;
      }
      case 'white-dwarf': {
        disc(R * 0.55, ATARI.cyan);
        disc(R * 0.35, ATARI.white);
        ring(R * 0.9, ATARI.cyan, true);
        for (let i = 0; i < 6; i++) spike((i / 6) * Math.PI * 2, R * 1.3, ATARI.white);
        break;
      }
      case 'neutron-star': {
        // Pixel field of red+white dots in a disc
        for (let dy = -16; dy <= 16; dy++) {
          for (let dx = -16; dx <= 16; dx++) {
            if (dx * dx + dy * dy <= 16 * 16 && rng() > 0.55) {
              const c = rng() < 0.6 ? ATARI.red : ATARI.white;
              atariPx(ctx, cx + dx * px, cy + dy * px, px, c);
            }
          }
        }
        break;
      }
      case 'pulsar': {
        const tilt = rng() * Math.PI;
        disc(R * 0.5, ATARI.cyan);
        disc(R * 0.28, ATARI.white);
        for (const sign of [1, -1]) {
          const ang = tilt + (sign < 0 ? Math.PI : 0);
          const len = R * 2.5;
          const steps = Math.round(len / px);
          for (let i = 0; i < steps; i++) {
            const t = i / steps;
            const w = (1 - t) * 3;
            for (let k = -Math.floor(w); k <= Math.floor(w); k++) {
              const px2 = cx + Math.cos(ang) * t * len + Math.cos(ang + Math.PI/2) * k * px;
              const py2 = cy + Math.sin(ang) * t * len + Math.sin(ang + Math.PI/2) * k * px;
              if (rng() > t * 0.4) atariPx(ctx, px2, py2, px,
                pick(rng, [ATARI.cyan, ATARI.white, ATARI.purple]));
            }
          }
        }
        break;
      }
      case 'binary': {
        const sep = R * 0.7;
        const ang = rng() * Math.PI;
        const x1 = cx - Math.cos(ang) * sep, y1 = cy - Math.sin(ang) * sep;
        const x2 = cx + Math.cos(ang) * sep, y2 = cy + Math.sin(ang) * sep;
        const oldCx = cx, oldCy = cy;
        cx = x1; cy = y1; disc(R * 0.55, ATARI.orange); disc(R * 0.3, ATARI.yellow);
        cx = x2; cy = y2; disc(R * 0.4, ATARI.cyan); disc(R * 0.22, ATARI.white);
        cx = oldCx; cy = oldCy;
        break;
      }
      case 'quasar': {
        const tilt = rng() * Math.PI;
        // Edge-on disc as wide ellipse rendered pixel-ily
        const a = Math.round(R * 1.4 / px), b = Math.round(R * 0.4 / px);
        for (let dy = -b; dy <= b; dy++) {
          for (let dx = -a; dx <= a; dx++) {
            if ((dx * dx) / (a * a) + (dy * dy) / (b * b) <= 1) {
              const t = Math.abs(dx) / a;
              const c = t < 0.4 ? ATARI.white : t < 0.7 ? ATARI.yellow : ATARI.magenta;
              const wx = cx + (dx * Math.cos(tilt) - dy * Math.sin(tilt)) * px;
              const wy = cy + (dx * Math.sin(tilt) + dy * Math.cos(tilt)) * px;
              atariPx(ctx, wx, wy, px, c);
            }
          }
        }
        // Jets perpendicular
        const jetAng = tilt + Math.PI / 2;
        for (const sign of [1, -1]) {
          const len = R * 2;
          const steps = Math.round(len / px);
          for (let i = 0; i < steps; i++) {
            const t = i / steps;
            atariPx(ctx, cx + Math.cos(jetAng) * sign * t * len,
              cy + Math.sin(jetAng) * sign * t * len, px, ATARI.green);
          }
        }
        break;
      }
      case 'black-hole': {
        // Ring + dark center
        ring(R * 1.0, ATARI.orange, false);
        ring(R * 0.95, ATARI.yellow, true);
        ring(R * 0.85, ATARI.orange, false);
        disc(R * 0.7, ATARI.dark);
        // Swirl pixels around
        for (let i = 0; i < 30; i++) {
          const a = rng() * Math.PI * 2;
          const rad = R * (0.95 + rng() * 0.4);
          atariPx(ctx, cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, px,
            pick(rng, [ATARI.orange, ATARI.red, ATARI.magenta]));
        }
        break;
      }
      case 'nebula': {
        // Cloud of magenta+cyan+green pixels w/ density falloff
        const colors = [ATARI.magenta, ATARI.cyan, ATARI.purple, ATARI.green, ATARI.yellow];
        for (let i = 0; i < 220; i++) {
          const a = rng() * Math.PI * 2;
          const rad = Math.pow(rng(), 0.7) * R * 1.4;
          const c = pick(rng, colors);
          atariPx(ctx, cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, px, c);
        }
        // Bright center pinpoints
        for (let i = 0; i < 5; i++) {
          const a = rng() * Math.PI * 2;
          const rad = rng() * R * 0.5;
          atariPx(ctx, cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, px, ATARI.white);
        }
        break;
      }
    }
  }

  // ============================================================
  //  LOST IN SPACE — non-celestial sprites
  // ============================================================
  // Each "star type" maps to a different object. Drawn as flat vector
  // illustrations with thick ink strokes and a limited cosmic palette.
  const LOST = {
    bg: '#0d1224', deep: '#080b18', white: '#f2f4ff',
    visor: '#7ec8ff', helmet: '#e8e8ee', suit: '#d4d8e2',
    rust: '#c47a3a', rock: '#6b5a4a', shadow: '#2b3148',
    red: '#e85c5c', orange: '#ffb15c', cyan: '#60d8d8',
    pink: '#ff8fb1', purple: '#a585d8', yellow: '#ffd35c',
  };
  function lostBg(ctx, w, h, seed) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, LOST.deep);
    g.addColorStop(1, LOST.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const r = rng32(seed ^ 0xCAFE);
    for (let i = 0; i < 50; i++) {
      ctx.fillStyle = `rgba(242,244,255,${0.3 + r() * 0.5})`;
      ctx.beginPath(); ctx.arc(r() * w, r() * h, 0.5 + r() * 1.2, 0, Math.PI * 2); ctx.fill();
    }
  }
  function lostStar(canvas, type, seed) {
    const { ctx, w, h } = fitCanvas(canvas, window.devicePixelRatio || 2);
    ctx.imageSmoothingEnabled = true;
    lostBg(ctx, w, h, seed);
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.32;
    const rng = rng32(seed);
    drawLostObject(ctx, cx, cy, R, rng, type);
  }
  function inkStroke(ctx, color, lw) { ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; }
  function drawLostObject(ctx, cx, cy, R, rng, type) {
    ctx.save();
    ctx.translate(cx, cy);
    const tilt = (rng() - 0.5) * 0.8;
    ctx.rotate(tilt);
    switch (type) {
      case 'main-sequence': drawAstronaut(ctx, R, rng); break;
      case 'red-giant': drawRustyShip(ctx, R, rng); break;
      case 'blue-supergiant': drawRocket(ctx, R, rng); break;
      case 'white-dwarf': drawSatellite(ctx, R, rng); break;
      case 'neutron-star': drawAsteroidCluster(ctx, R, rng); break;
      case 'pulsar': drawSpaceLighthouse(ctx, R, rng); break;
      case 'binary': drawTwoAstronauts(ctx, R, rng); break;
      case 'quasar': drawSpaceJellyfish(ctx, R, rng); break;
      case 'black-hole': drawWormhole(ctx, R, rng); break;
      case 'nebula': drawDebrisField(ctx, R, rng); break;
    }
    ctx.restore();
  }
  // Tiny astronaut
  function drawAstronaut(ctx, R, rng) {
    // tether
    inkStroke(ctx, LOST.cyan, 1.5);
    ctx.beginPath(); ctx.moveTo(R * 0.4, R * 0.3);
    ctx.bezierCurveTo(R, R, R * 1.4, R * 0.3, R * 1.6, -R * 0.2);
    ctx.stroke();
    // body
    ctx.fillStyle = LOST.suit;
    ctx.beginPath();
    ctx.ellipse(0, R * 0.15, R * 0.32, R * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    // arms
    inkStroke(ctx, LOST.suit, R * 0.18);
    ctx.beginPath();
    ctx.moveTo(-R * 0.25, R * 0.1); ctx.lineTo(-R * 0.55, R * 0.35);
    ctx.moveTo(R * 0.25, R * 0.1); ctx.lineTo(R * 0.5, R * 0.35);
    ctx.stroke();
    inkStroke(ctx, LOST.suit, R * 0.16);
    ctx.beginPath();
    ctx.moveTo(-R * 0.15, R * 0.45); ctx.lineTo(-R * 0.25, R * 0.75);
    ctx.moveTo(R * 0.15, R * 0.45); ctx.lineTo(R * 0.22, R * 0.78);
    ctx.stroke();
    // helmet
    ctx.fillStyle = LOST.helmet;
    ctx.beginPath(); ctx.arc(0, -R * 0.25, R * 0.32, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = LOST.visor;
    ctx.beginPath(); ctx.arc(0, -R * 0.25, R * 0.22, 0, Math.PI * 2); ctx.fill();
    // visor reflection
    ctx.fillStyle = LOST.white;
    ctx.beginPath(); ctx.arc(-R * 0.1, -R * 0.32, R * 0.06, 0, Math.PI * 2); ctx.fill();
    // chestplate
    ctx.fillStyle = LOST.shadow;
    ctx.fillRect(-R * 0.12, R * 0.05, R * 0.24, R * 0.14);
    ctx.fillStyle = LOST.red;
    ctx.beginPath(); ctx.arc(-R * 0.05, R * 0.12, R * 0.025, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = LOST.cyan;
    ctx.beginPath(); ctx.arc(R * 0.05, R * 0.12, R * 0.025, 0, Math.PI * 2); ctx.fill();
  }
  function drawRustyShip(ctx, R, rng) {
    // squat hull
    ctx.fillStyle = LOST.rust;
    ctx.beginPath();
    ctx.ellipse(0, 0, R, R * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
    // dome
    ctx.fillStyle = LOST.cyan;
    ctx.beginPath();
    ctx.arc(0, -R * 0.15, R * 0.4, Math.PI, 0);
    ctx.fill();
    // window highlights
    ctx.fillStyle = LOST.white;
    ctx.beginPath(); ctx.arc(-R * 0.12, -R * 0.25, R * 0.05, 0, Math.PI * 2); ctx.fill();
    // stripe
    ctx.fillStyle = LOST.shadow;
    ctx.fillRect(-R, -R * 0.05, R * 2, R * 0.1);
    // landing legs
    inkStroke(ctx, LOST.shadow, 3);
    ctx.beginPath();
    for (const x of [-R * 0.6, 0, R * 0.6]) {
      ctx.moveTo(x, R * 0.35); ctx.lineTo(x * 1.2, R * 0.7);
    }
    ctx.stroke();
    // rust patches
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc((rng() - 0.5) * R * 1.6, (rng() - 0.5) * R * 0.5, R * 0.04 + rng() * R * 0.05, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  function drawRocket(ctx, R, rng) {
    ctx.rotate(-Math.PI / 6);
    // body
    ctx.fillStyle = LOST.helmet;
    ctx.beginPath();
    ctx.moveTo(0, -R);
    ctx.bezierCurveTo(R * 0.4, -R * 0.6, R * 0.4, R * 0.5, R * 0.25, R * 0.7);
    ctx.lineTo(-R * 0.25, R * 0.7);
    ctx.bezierCurveTo(-R * 0.4, R * 0.5, -R * 0.4, -R * 0.6, 0, -R);
    ctx.fill();
    // window
    ctx.fillStyle = LOST.cyan;
    ctx.beginPath(); ctx.arc(0, -R * 0.15, R * 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = LOST.white;
    ctx.beginPath(); ctx.arc(-R * 0.06, -R * 0.2, R * 0.05, 0, Math.PI * 2); ctx.fill();
    // fins
    ctx.fillStyle = LOST.red;
    ctx.beginPath();
    ctx.moveTo(R * 0.25, R * 0.4); ctx.lineTo(R * 0.55, R * 0.85); ctx.lineTo(R * 0.25, R * 0.7); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-R * 0.25, R * 0.4); ctx.lineTo(-R * 0.55, R * 0.85); ctx.lineTo(-R * 0.25, R * 0.7); ctx.fill();
    // flame
    ctx.fillStyle = LOST.orange;
    ctx.beginPath();
    ctx.moveTo(-R * 0.18, R * 0.7);
    ctx.bezierCurveTo(-R * 0.1, R * 1.2, R * 0.1, R * 1.2, R * 0.18, R * 0.7);
    ctx.fill();
    ctx.fillStyle = LOST.yellow;
    ctx.beginPath();
    ctx.moveTo(-R * 0.10, R * 0.7);
    ctx.bezierCurveTo(-R * 0.05, R * 1.0, R * 0.05, R * 1.0, R * 0.10, R * 0.7);
    ctx.fill();
  }
  function drawSatellite(ctx, R, rng) {
    // body
    ctx.fillStyle = LOST.helmet;
    ctx.fillRect(-R * 0.2, -R * 0.25, R * 0.4, R * 0.5);
    // dish
    ctx.fillStyle = LOST.cyan;
    ctx.beginPath();
    ctx.arc(0, -R * 0.45, R * 0.3, Math.PI, 0); ctx.fill();
    inkStroke(ctx, LOST.shadow, 2);
    ctx.beginPath(); ctx.moveTo(0, -R * 0.45); ctx.lineTo(0, -R * 0.75); ctx.stroke();
    // solar panels
    ctx.fillStyle = LOST.shadow;
    ctx.fillRect(-R * 0.95, -R * 0.15, R * 0.7, R * 0.3);
    ctx.fillRect(R * 0.25, -R * 0.15, R * 0.7, R * 0.3);
    ctx.fillStyle = LOST.purple;
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(-R * 0.92 + i * R * 0.23, -R * 0.13, R * 0.18, R * 0.26);
      ctx.fillRect(R * 0.28 + i * R * 0.23, -R * 0.13, R * 0.18, R * 0.26);
    }
  }
  function drawAsteroidCluster(ctx, R, rng) {
    const n = 7;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + rng() * 0.3;
      const rad = R * (0.4 + rng() * 0.6);
      const x = Math.cos(ang) * rad;
      const y = Math.sin(ang) * rad;
      const sz = R * (0.15 + rng() * 0.2);
      ctx.fillStyle = LOST.rock;
      ctx.beginPath();
      const sides = 6 + Math.floor(rng() * 3);
      for (let k = 0; k < sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        const rr = sz * (0.7 + rng() * 0.6);
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath(); ctx.fill();
      // crater
      ctx.fillStyle = LOST.shadow;
      ctx.beginPath(); ctx.arc(x - sz * 0.2, y - sz * 0.1, sz * 0.18, 0, Math.PI * 2); ctx.fill();
    }
  }
  function drawSpaceLighthouse(ctx, R, rng) {
    // Octagonal beacon
    ctx.fillStyle = LOST.helmet;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const px = Math.cos(a) * R * 0.35, py = Math.sin(a) * R * 0.35;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = LOST.shadow;
    ctx.fillRect(-R * 0.04, -R * 0.35, R * 0.08, R * 0.7);
    // Beam
    const beamAng = rng() * Math.PI * 2;
    for (const sign of [1, -1]) {
      const a = beamAng + (sign < 0 ? Math.PI : 0);
      ctx.save();
      ctx.rotate(a);
      const grad = ctx.createLinearGradient(0, 0, R * 1.6, 0);
      grad.addColorStop(0, 'rgba(255,180,90,0.9)');
      grad.addColorStop(1, 'rgba(255,180,90,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(R * 1.6, R * 0.3); ctx.lineTo(R * 1.6, -R * 0.3); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = LOST.yellow;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.18, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = LOST.white;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.08, 0, Math.PI * 2); ctx.fill();
  }
  function drawTwoAstronauts(ctx, R, rng) {
    ctx.save(); ctx.translate(-R * 0.5, R * 0.1); ctx.scale(0.7, 0.7); drawAstronaut(ctx, R, rng); ctx.restore();
    ctx.save(); ctx.translate(R * 0.55, -R * 0.1); ctx.rotate(0.5); ctx.scale(0.6, 0.6); drawAstronaut(ctx, R, rng); ctx.restore();
    inkStroke(ctx, LOST.cyan, 2);
    ctx.beginPath();
    ctx.moveTo(-R * 0.25, R * 0.1);
    ctx.bezierCurveTo(0, -R * 0.5, R * 0.2, -R * 0.4, R * 0.3, -R * 0.1);
    ctx.stroke();
  }
  function drawSpaceJellyfish(ctx, R, rng) {
    // A bioluminescent space jelly — translucent purple bell with a tiny
    // astronaut piloting from inside, neon trails for tentacles.
    const bellGrad = ctx.createRadialGradient(0, -R * 0.15, 0, 0, -R * 0.15, R * 0.85);
    bellGrad.addColorStop(0, 'rgba(212,196,240,0.95)');
    bellGrad.addColorStop(0.55, 'rgba(155,124,216,0.75)');
    bellGrad.addColorStop(1, 'rgba(155,124,216,0)');
    ctx.fillStyle = bellGrad;
    ctx.beginPath();
    ctx.ellipse(0, -R * 0.2, R * 0.85, R * 0.6, 0, Math.PI, 0);
    ctx.lineTo(R * 0.7, R * 0.05);
    ctx.bezierCurveTo(R * 0.4, R * 0.18, -R * 0.4, R * 0.18, -R * 0.7, R * 0.05);
    ctx.closePath();
    ctx.fill();
    // Bell rim — bright cyan accent
    ctx.strokeStyle = 'rgba(126,200,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(0, -R * 0.2, R * 0.85, R * 0.6, 0, Math.PI + 0.15, -0.15);
    ctx.stroke();
    // Bioluminescent dot ring along bell underside
    for (let i = 0; i < 14; i++) {
      const t = i / 13;
      const x = -R * 0.7 + t * R * 1.4;
      const y = R * 0.05 + Math.sin(t * Math.PI) * (-R * 0.08);
      const c = i % 3 === 0 ? 'rgba(202,255,112,1)' : 'rgba(126,200,255,0.95)';
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
    }
    // Inner cabin glow
    const cabinGrad = ctx.createRadialGradient(0, -R * 0.25, 0, 0, -R * 0.25, R * 0.3);
    cabinGrad.addColorStop(0, 'rgba(255,213,145,0.9)');
    cabinGrad.addColorStop(1, 'rgba(255,213,145,0)');
    ctx.fillStyle = cabinGrad;
    ctx.beginPath(); ctx.arc(0, -R * 0.25, R * 0.3, 0, Math.PI * 2); ctx.fill();
    // Tiny astronaut silhouette inside
    ctx.fillStyle = 'rgba(232,232,238,0.9)';
    ctx.beginPath(); ctx.arc(0, -R * 0.32, R * 0.11, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(126,200,255,0.95)';
    ctx.beginPath(); ctx.arc(0, -R * 0.32, R * 0.075, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(232,232,238,0.9)';
    ctx.beginPath();
    ctx.ellipse(0, -R * 0.18, R * 0.09, R * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    // Tentacles — long wavy neon trails
    const tents = 11;
    for (let i = 0; i < tents; i++) {
      const xs = -R * 0.6 + (i / (tents - 1)) * R * 1.2;
      const len = R * (0.85 + rng() * 0.7);
      const phase = rng() * 6;
      const isAccent = i % 2 === 0;
      const c1 = isAccent ? 'rgba(126,200,255,0.85)' : 'rgba(212,196,240,0.7)';
      const c2 = isAccent ? 'rgba(202,255,112,0)' : 'rgba(155,124,216,0)';
      const grad = ctx.createLinearGradient(xs, R * 0.05, xs, R * 0.05 + len);
      grad.addColorStop(0, c1);
      grad.addColorStop(1, c2);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.8 + rng() * 1.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(xs, R * 0.05);
      const cp1x = xs + Math.sin(phase) * R * 0.18;
      const cp2x = xs + Math.sin(phase + 1.5) * R * 0.25;
      const ex = xs + (rng() - 0.5) * R * 0.3;
      ctx.bezierCurveTo(cp1x, R * 0.05 + len * 0.4, cp2x, R * 0.05 + len * 0.75, ex, R * 0.05 + len);
      ctx.stroke();
      ctx.fillStyle = isAccent ? 'rgba(202,255,112,0.95)' : 'rgba(126,200,255,0.85)';
      ctx.beginPath(); ctx.arc(ex, R * 0.05 + len, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    // Outer ambient glow halo
    const halo = ctx.createRadialGradient(0, -R * 0.1, R * 0.4, 0, -R * 0.1, R * 1.4);
    halo.addColorStop(0, 'rgba(155,124,216,0.18)');
    halo.addColorStop(1, 'rgba(155,124,216,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, -R * 0.1, R * 1.4, 0, Math.PI * 2); ctx.fill();
  }

  function drawSpaceStation(ctx, R, rng) {
    // Central hub
    ctx.fillStyle = LOST.helmet;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.25, 0, Math.PI * 2); ctx.fill();
    // Outer ring
    inkStroke(ctx, LOST.helmet, R * 0.12);
    ctx.beginPath(); ctx.arc(0, 0, R * 0.85, 0, Math.PI * 2); ctx.stroke();
    inkStroke(ctx, LOST.shadow, 2);
    ctx.beginPath(); ctx.arc(0, 0, R * 0.85, 0, Math.PI * 2); ctx.stroke();
    // Spokes
    inkStroke(ctx, LOST.helmet, R * 0.05);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * R * 0.25, Math.sin(a) * R * 0.25);
      ctx.lineTo(Math.cos(a) * R * 0.78, Math.sin(a) * R * 0.78);
      ctx.stroke();
    }
    // Lit windows around ring
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      ctx.fillStyle = i % 3 === 0 ? LOST.yellow : 'rgba(255,255,255,0.4)';
      ctx.beginPath(); ctx.arc(Math.cos(a) * R * 0.85, Math.sin(a) * R * 0.85, R * 0.025, 0, Math.PI * 2); ctx.fill();
    }
  }
  function drawWormhole(ctx, R, rng) {
    // Concentric rings spiraling inward
    for (let i = 0; i < 8; i++) {
      const t = i / 8;
      const rr = R * (1 - t * 0.85);
      ctx.strokeStyle = `rgba(${Math.round(150 - t*100)}, ${Math.round(120 + t*60)}, ${Math.round(220 - t*40)}, ${0.4 + t * 0.5})`;
      ctx.lineWidth = R * 0.06;
      ctx.beginPath();
      ctx.ellipse(t * R * 0.05, 0, rr, rr * (0.95 - t * 0.3), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = LOST.deep;
    ctx.beginPath(); ctx.arc(R * 0.4, 0, R * 0.15, 0, Math.PI * 2); ctx.fill();
  }
  function drawDebrisField(ctx, R, rng) {
    const items = [
      { kind: 'gear', x: -R * 0.5, y: -R * 0.3, sz: R * 0.25 },
      { kind: 'glove', x: R * 0.4, y: -R * 0.4, sz: R * 0.2 },
      { kind: 'panel', x: -R * 0.3, y: R * 0.45, sz: R * 0.35 },
      { kind: 'bolt', x: R * 0.5, y: R * 0.3, sz: R * 0.12 },
      { kind: 'helmet', x: 0, y: 0, sz: R * 0.3 },
    ];
    for (const it of items) {
      ctx.save();
      ctx.translate(it.x, it.y);
      ctx.rotate(rng() * Math.PI * 2);
      if (it.kind === 'gear') {
        ctx.fillStyle = LOST.rust;
        ctx.beginPath();
        const teeth = 10;
        for (let i = 0; i < teeth * 2; i++) {
          const a = (i / (teeth * 2)) * Math.PI * 2;
          const rr = i % 2 ? it.sz : it.sz * 0.78;
          if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
          else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath(); ctx.fill();
        ctx.fillStyle = LOST.deep;
        ctx.beginPath(); ctx.arc(0, 0, it.sz * 0.3, 0, Math.PI * 2); ctx.fill();
      } else if (it.kind === 'glove') {
        ctx.fillStyle = LOST.suit;
        ctx.beginPath();
        ctx.ellipse(0, 0, it.sz, it.sz * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = LOST.shadow;
        ctx.fillRect(-it.sz, it.sz * 0.55, it.sz * 2, it.sz * 0.2);
      } else if (it.kind === 'panel') {
        ctx.fillStyle = LOST.shadow;
        ctx.fillRect(-it.sz, -it.sz * 0.5, it.sz * 2, it.sz);
        ctx.fillStyle = LOST.purple;
        for (let i = 0; i < 4; i++) ctx.fillRect(-it.sz * 0.95 + i * it.sz * 0.5, -it.sz * 0.45, it.sz * 0.45, it.sz * 0.9);
      } else if (it.kind === 'bolt') {
        ctx.fillStyle = LOST.helmet;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          if (i === 0) ctx.moveTo(Math.cos(a) * it.sz, Math.sin(a) * it.sz);
          else ctx.lineTo(Math.cos(a) * it.sz, Math.sin(a) * it.sz);
        }
        ctx.closePath(); ctx.fill();
      } else if (it.kind === 'helmet') {
        ctx.fillStyle = LOST.helmet;
        ctx.beginPath(); ctx.arc(0, 0, it.sz, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = LOST.visor;
        ctx.beginPath(); ctx.arc(0, 0, it.sz * 0.7, 0, Math.PI * 2); ctx.fill();
        // crack
        inkStroke(ctx, LOST.shadow, 2);
        ctx.beginPath();
        ctx.moveTo(-it.sz * 0.5, -it.sz * 0.2);
        ctx.lineTo(it.sz * 0.1, it.sz * 0.1);
        ctx.lineTo(it.sz * 0.4, -it.sz * 0.1);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  // ============================================================
  //  BIO — bioluminescent botanical
  // ============================================================
  // Watercolor washes, ink filaments, glowing centers. Inspired by
  // tide-pool creatures and forest fungi.
  const BIO = {
    bg1: '#0a1420', bg2: '#1a2a3a',
    teal: '#5fd2c0', mint: '#a8f0c8',
    coral: '#ff9a8b', pink: '#ffc1d1', amber: '#ffd591',
    violet: '#9b7cd8', lavender: '#d4c4f0',
    chartreuse: '#caff70', white: '#fdfffe',
    ink: '#0a1420',
  };
  function bioBg(ctx, w, h, seed) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, BIO.bg1);
    g.addColorStop(1, BIO.bg2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    const r = rng32(seed ^ 0xB10);
    // Washes — large translucent ovals to give paper feel
    for (let i = 0; i < 5; i++) {
      const c = pick(r, ['rgba(95,210,192,0.05)', 'rgba(255,154,139,0.04)', 'rgba(155,124,216,0.04)']);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.ellipse(r() * w, r() * h, w * 0.3, h * 0.3, r() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    // Sparkles
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = `rgba(168,240,200,${0.3 + r() * 0.4})`;
      ctx.beginPath(); ctx.arc(r() * w, r() * h, 0.6, 0, Math.PI * 2); ctx.fill();
    }
  }
  function bioStar(canvas, type, seed) {
    const { ctx, w, h } = fitCanvas(canvas, window.devicePixelRatio || 2);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    bioBg(ctx, w, h, seed);
    drawBioCreature(ctx, w / 2, h / 2, Math.min(w, h) * 0.32, rng32(seed), type);
  }
  function softBlob(ctx, x, y, r, color, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, color.replace(')', `,${alpha})`).replace('rgb', 'rgba'));
    g.addColorStop(1, color.replace(')', ',0)').replace('rgb', 'rgba'));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  function drawBioCreature(ctx, cx, cy, R, rng, type) {
    ctx.save();
    ctx.translate(cx, cy);
    switch (type) {
      case 'main-sequence': drawAnemone(ctx, R, rng); break;
      case 'red-giant': drawCoralBloom(ctx, R, rng); break;
      case 'blue-supergiant': drawJellyfish(ctx, R, rng); break;
      case 'white-dwarf': drawSeaUrchin(ctx, R, rng); break;
      case 'neutron-star': drawSpores(ctx, R, rng); break;
      case 'pulsar': drawAnglerLight(ctx, R, rng); break;
      case 'binary': drawTwinFlowers(ctx, R, rng); break;
      case 'quasar': drawMantaray(ctx, R, rng); break;
      case 'black-hole': drawCarnivorous(ctx, R, rng); break;
      case 'nebula': drawMossPatch(ctx, R, rng); break;
    }
    ctx.restore();
  }
  // helper: petal/tendril stroke
  function tendril(ctx, x1, y1, x2, y2, color, lw) {
    const g = ctx.createLinearGradient(x1, y1, x2, y2);
    g.addColorStop(0, color);
    g.addColorStop(1, color.replace(/,1\)/, ',0)').replace(/rgba?\(([^,]+,[^,]+,[^,]+)\)/, 'rgba($1,0)'));
    ctx.strokeStyle = g;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
  }
  function drawAnemone(ctx, R, rng) {
    // Watercolor wash
    const wash = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.3);
    wash.addColorStop(0, 'rgba(255,213,145,0.45)');
    wash.addColorStop(0.6, 'rgba(255,154,139,0.18)');
    wash.addColorStop(1, 'rgba(255,154,139,0)');
    ctx.fillStyle = wash;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.3, 0, Math.PI * 2); ctx.fill();
    // Tendrils
    const arms = 16;
    for (let i = 0; i < arms; i++) {
      const a = (i / arms) * Math.PI * 2 + rng() * 0.05;
      const len = R * (0.85 + rng() * 0.4);
      const wave = (rng() - 0.5) * 0.8;
      ctx.strokeStyle = `rgba(255,193,209,${0.6 + rng() * 0.3})`;
      ctx.lineWidth = R * 0.04;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(
        Math.cos(a + wave * 0.3) * len * 0.4, Math.sin(a + wave * 0.3) * len * 0.4,
        Math.cos(a + wave) * len * 0.7, Math.sin(a + wave) * len * 0.7,
        Math.cos(a) * len, Math.sin(a) * len
      );
      ctx.stroke();
      // Glowing tip
      const tipX = Math.cos(a) * len, tipY = Math.sin(a) * len;
      const tg = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY, R * 0.1);
      tg.addColorStop(0, 'rgba(253,255,254,1)');
      tg.addColorStop(0.5, 'rgba(255,213,145,0.9)');
      tg.addColorStop(1, 'rgba(255,154,139,0)');
      ctx.fillStyle = tg;
      ctx.beginPath(); ctx.arc(tipX, tipY, R * 0.1, 0, Math.PI * 2); ctx.fill();
    }
    // Hot center
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.35);
    core.addColorStop(0, 'rgba(253,255,254,1)');
    core.addColorStop(0.5, 'rgba(255,213,145,0.95)');
    core.addColorStop(1, 'rgba(255,154,139,0)');
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.35, 0, Math.PI * 2); ctx.fill();
  }
  function drawCoralBloom(ctx, R, rng) {
    // Multiple overlapping coral branches
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + rng() * 0.3;
      ctx.strokeStyle = `rgba(255,154,139,0.85)`;
      ctx.lineWidth = R * (0.08 + rng() * 0.05);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      // Recursive-ish: 2 segments
      const mx = Math.cos(a) * R * 0.5, my = Math.sin(a) * R * 0.5;
      const ex = Math.cos(a + (rng()-0.5)*0.6) * R, ey = Math.sin(a + (rng()-0.5)*0.6) * R;
      ctx.bezierCurveTo(mx * 0.5, my * 0.5, mx, my, ex, ey);
      ctx.stroke();
      // Bud at tip
      ctx.fillStyle = 'rgba(255,154,139,0.95)';
      ctx.beginPath(); ctx.arc(ex, ey, R * 0.08, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,213,145,1)';
      ctx.beginPath(); ctx.arc(ex - R * 0.02, ey - R * 0.02, R * 0.04, 0, Math.PI * 2); ctx.fill();
    }
    // Center mass
    softBlob(ctx, 0, 0, R * 0.4, 'rgb(255,154,139)', 0.7);
    softBlob(ctx, 0, 0, R * 0.18, 'rgb(255,213,145)', 1);
  }
  function drawJellyfish(ctx, R, rng) {
    // Bell
    const bellGrad = ctx.createRadialGradient(0, -R * 0.1, 0, 0, -R * 0.1, R * 0.7);
    bellGrad.addColorStop(0, 'rgba(168,240,200,0.95)');
    bellGrad.addColorStop(0.6, 'rgba(95,210,192,0.7)');
    bellGrad.addColorStop(1, 'rgba(95,210,192,0)');
    ctx.fillStyle = bellGrad;
    ctx.beginPath();
    ctx.ellipse(0, -R * 0.15, R * 0.7, R * 0.5, 0, Math.PI, 0);
    ctx.lineTo(R * 0.55, R * 0.05);
    ctx.bezierCurveTo(R * 0.3, R * 0.15, -R * 0.3, R * 0.15, -R * 0.55, R * 0.05);
    ctx.closePath();
    ctx.fill();
    // Bell rim highlight
    ctx.strokeStyle = 'rgba(253,255,254,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(0, -R * 0.15, R * 0.7, R * 0.5, 0, Math.PI + 0.2, -0.2);
    ctx.stroke();
    // Inner bioluminescence
    softBlob(ctx, 0, -R * 0.2, R * 0.25, 'rgb(202,255,112)', 0.9);
    // Tentacles — long wavy
    const tents = 12;
    for (let i = 0; i < tents; i++) {
      const xs = -R * 0.5 + (i / (tents - 1)) * R;
      const len = R * (0.8 + rng() * 0.6);
      const g = ctx.createLinearGradient(xs, R * 0.05, xs + (rng() - 0.5) * R * 0.3, R * 0.05 + len);
      g.addColorStop(0, 'rgba(168,240,200,0.7)');
      g.addColorStop(1, 'rgba(95,210,192,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.5 + rng();
      ctx.beginPath();
      ctx.moveTo(xs, R * 0.05);
      const cp1x = xs + Math.sin(rng() * 6) * R * 0.1;
      const cp2x = xs + Math.sin(rng() * 6) * R * 0.2;
      ctx.bezierCurveTo(cp1x, R * 0.05 + len * 0.4, cp2x, R * 0.05 + len * 0.7,
        xs + (rng() - 0.5) * R * 0.3, R * 0.05 + len);
      ctx.stroke();
    }
    // Stinger glow dots
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = 'rgba(202,255,112,0.9)';
      ctx.beginPath(); ctx.arc((rng() - 0.5) * R, R * 0.4 + rng() * R * 0.4, 1.2, 0, Math.PI * 2); ctx.fill();
    }
  }
  function drawSeaUrchin(ctx, R, rng) {
    // Spines
    const spines = 32;
    for (let i = 0; i < spines; i++) {
      const a = (i / spines) * Math.PI * 2;
      const len = R * (0.7 + rng() * 0.5);
      const g = ctx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
      g.addColorStop(0, 'rgba(155,124,216,0.95)');
      g.addColorStop(1, 'rgba(212,196,240,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = R * 0.025;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.stroke();
    }
    // Body
    softBlob(ctx, 0, 0, R * 0.4, 'rgb(155,124,216)', 0.8);
    ctx.fillStyle = 'rgba(253,255,254,1)';
    ctx.beginPath(); ctx.arc(0, 0, R * 0.12, 0, Math.PI * 2); ctx.fill();
  }
  function drawSpores(ctx, R, rng) {
    const n = 24;
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const rad = Math.pow(rng(), 0.6) * R;
      const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
      const sz = R * (0.04 + rng() * 0.06);
      const c = pick(rng, ['rgb(168,240,200)', 'rgb(255,193,209)', 'rgb(212,196,240)']);
      softBlob(ctx, x, y, sz * 2.5, c, 0.4);
      ctx.fillStyle = c.replace(')', ',1)').replace('rgb', 'rgba');
      ctx.beginPath(); ctx.arc(x, y, sz, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(253,255,254,0.95)';
      ctx.beginPath(); ctx.arc(x, y, sz * 0.4, 0, Math.PI * 2); ctx.fill();
    }
  }
  function drawAnglerLight(ctx, R, rng) {
    // A glowing lure with stalk and tendrils
    softBlob(ctx, 0, -R * 0.4, R * 0.3, 'rgb(202,255,112)', 0.9);
    ctx.fillStyle = 'rgba(253,255,254,1)';
    ctx.beginPath(); ctx.arc(0, -R * 0.4, R * 0.08, 0, Math.PI * 2); ctx.fill();
    // Stalk
    ctx.strokeStyle = 'rgba(155,124,216,0.85)';
    ctx.lineWidth = R * 0.05;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, -R * 0.3);
    ctx.bezierCurveTo(R * 0.1, -R * 0.1, -R * 0.1, R * 0.2, 0, R * 0.5);
    ctx.stroke();
    // Body suggestion
    ctx.fillStyle = 'rgba(95,210,192,0.4)';
    ctx.beginPath();
    ctx.ellipse(0, R * 0.55, R * 0.5, R * 0.25, 0, 0, Math.PI * 2);
    ctx.fill();
    // Eye
    ctx.fillStyle = 'rgba(255,213,145,0.95)';
    ctx.beginPath(); ctx.arc(R * 0.15, R * 0.55, R * 0.05, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(10,20,32,1)';
    ctx.beginPath(); ctx.arc(R * 0.15, R * 0.55, R * 0.025, 0, Math.PI * 2); ctx.fill();
  }
  function drawTwinFlowers(ctx, R, rng) {
    function flower(cx_, cy_, rr, c1, c2) {
      const petals = 8;
      ctx.fillStyle = c1;
      for (let i = 0; i < petals; i++) {
        const a = (i / petals) * Math.PI * 2;
        ctx.save(); ctx.translate(cx_, cy_); ctx.rotate(a);
        ctx.beginPath();
        ctx.ellipse(rr * 0.5, 0, rr * 0.45, rr * 0.18, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = c2;
      ctx.beginPath(); ctx.arc(cx_, cy_, rr * 0.25, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(253,255,254,1)';
      ctx.beginPath(); ctx.arc(cx_, cy_, rr * 0.1, 0, Math.PI * 2); ctx.fill();
    }
    flower(-R * 0.4, R * 0.05, R * 0.55, 'rgba(255,154,139,0.9)', 'rgba(255,213,145,1)');
    flower(R * 0.45, -R * 0.1, R * 0.42, 'rgba(168,240,200,0.9)', 'rgba(202,255,112,1)');
    // connecting tendril
    ctx.strokeStyle = 'rgba(212,196,240,0.7)';
    ctx.lineWidth = R * 0.03;
    ctx.beginPath();
    ctx.moveTo(-R * 0.2, R * 0.05);
    ctx.bezierCurveTo(0, -R * 0.3, R * 0.2, -R * 0.3, R * 0.3, -R * 0.1);
    ctx.stroke();
  }
  function drawMantaray(ctx, R, rng) {
    // Cosmic ray-fish — gracefully arching wings with bioluminescent
    // trailing veils, glowing dotted edge, flowing tail.
    // Soft ambient glow underneath
    const ambient = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.4);
    ambient.addColorStop(0, 'rgba(155,124,216,0.18)');
    ambient.addColorStop(1, 'rgba(155,124,216,0)');
    ctx.fillStyle = ambient;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.4, 0, Math.PI * 2); ctx.fill();

    // Trailing translucent veils (under wings) — subtle motion lines
    for (let i = 0; i < 4; i++) {
      const off = (i - 1.5) * R * 0.04;
      ctx.strokeStyle = `rgba(212,196,240,${0.18 - i * 0.03})`;
      ctx.lineWidth = R * 0.05;
      ctx.beginPath();
      ctx.moveTo(-R * 0.95, off);
      ctx.bezierCurveTo(-R * 0.4, R * 0.4 + off, R * 0.4, R * 0.4 + off, R * 0.95, off);
      ctx.stroke();
    }

    // Body — elegant arching wing shape with two-tone gradient
    const wingGrad = ctx.createLinearGradient(0, -R * 0.45, 0, R * 0.3);
    wingGrad.addColorStop(0, 'rgba(155,124,216,0.95)');
    wingGrad.addColorStop(0.6, 'rgba(123,152,210,0.9)');
    wingGrad.addColorStop(1, 'rgba(95,210,192,0.7)');
    ctx.fillStyle = wingGrad;
    ctx.beginPath();
    // Top arc — graceful sweep
    ctx.moveTo(-R, R * 0.05);
    ctx.bezierCurveTo(-R * 0.85, -R * 0.45, -R * 0.3, -R * 0.55, 0, -R * 0.5);
    ctx.bezierCurveTo(R * 0.3, -R * 0.55, R * 0.85, -R * 0.45, R, R * 0.05);
    // Bottom curve — body taper
    ctx.bezierCurveTo(R * 0.6, R * 0.22, R * 0.2, R * 0.28, 0, R * 0.18);
    ctx.bezierCurveTo(-R * 0.2, R * 0.28, -R * 0.6, R * 0.22, -R, R * 0.05);
    ctx.closePath();
    ctx.fill();

    // Subtle inner shading — darker spine band
    const spineGrad = ctx.createLinearGradient(0, -R * 0.4, 0, R * 0.1);
    spineGrad.addColorStop(0, 'rgba(95,80,160,0)');
    spineGrad.addColorStop(0.5, 'rgba(95,80,160,0.35)');
    spineGrad.addColorStop(1, 'rgba(95,80,160,0)');
    ctx.fillStyle = spineGrad;
    ctx.beginPath();
    ctx.ellipse(0, -R * 0.2, R * 0.1, R * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();

    // Bioluminescent dotted edges along the wing trailing edge
    const edgePoints = 18;
    for (let i = 0; i < edgePoints; i++) {
      const t = i / (edgePoints - 1);
      const x = -R * 0.95 + t * R * 1.9;
      // Follow the top-arc curve
      const arch = Math.sin(t * Math.PI);
      const y = -R * 0.5 + arch * -R * 0.05 + (1 - arch) * R * 0.05;
      const c = i % 4 === 0 ? 'rgba(202,255,112,1)' : 'rgba(168,240,200,0.9)';
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, y - arch * R * 0.03, 2 + (1 - Math.abs(t - 0.5) * 2) * 1.5, 0, Math.PI * 2); ctx.fill();
    }

    // Constellation of softer glow dots scattered on the wings
    for (let i = 0; i < 14; i++) {
      const x = (rng() - 0.5) * R * 1.6;
      const y = -R * 0.3 + rng() * R * 0.4;
      // skip if outside body
      const inBody = Math.abs(x) < R * 0.95 - Math.abs(y * 0.8);
      if (!inBody) continue;
      ctx.fillStyle = 'rgba(202,255,112,0.85)';
      ctx.beginPath(); ctx.arc(x, y, 1.4, 0, Math.PI * 2); ctx.fill();
      const halo = ctx.createRadialGradient(x, y, 0, x, y, R * 0.06);
      halo.addColorStop(0, 'rgba(202,255,112,0.4)');
      halo.addColorStop(1, 'rgba(202,255,112,0)');
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(x, y, R * 0.06, 0, Math.PI * 2); ctx.fill();
    }

    // Twin eye glow — small warm dots near front of body
    ctx.fillStyle = 'rgba(255,213,145,0.95)';
    ctx.beginPath(); ctx.arc(-R * 0.18, -R * 0.32, R * 0.025, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(R * 0.18, -R * 0.32, R * 0.025, 0, Math.PI * 2); ctx.fill();

    // Flowing tail — long wavy bezier with fading gradient
    const tailGrad = ctx.createLinearGradient(0, R * 0.18, 0, R * 1.1);
    tailGrad.addColorStop(0, 'rgba(155,124,216,0.85)');
    tailGrad.addColorStop(0.7, 'rgba(126,200,255,0.55)');
    tailGrad.addColorStop(1, 'rgba(126,200,255,0)');
    ctx.strokeStyle = tailGrad;
    ctx.lineWidth = R * 0.045;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, R * 0.18);
    ctx.bezierCurveTo(R * 0.14, R * 0.45, -R * 0.14, R * 0.7, R * 0.05, R * 1.0);
    ctx.stroke();
    // Tail glow tip
    const tipGlow = ctx.createRadialGradient(R * 0.05, R * 1.0, 0, R * 0.05, R * 1.0, R * 0.12);
    tipGlow.addColorStop(0, 'rgba(202,255,112,0.95)');
    tipGlow.addColorStop(1, 'rgba(202,255,112,0)');
    ctx.fillStyle = tipGlow;
    ctx.beginPath(); ctx.arc(R * 0.05, R * 1.0, R * 0.12, 0, Math.PI * 2); ctx.fill();
  }
  function drawCarnivorous(ctx, R, rng) {
    // An elegant carnivorous flower — translucent jaws, glowing pearl,
    // delicate filaments. Beauty + lurking menace.
    // Outer glow halo (softer than the anemone's)
    const halo = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 1.3);
    halo.addColorStop(0, 'rgba(255,154,139,0.18)');
    halo.addColorStop(0.6, 'rgba(155,124,216,0.10)');
    halo.addColorStop(1, 'rgba(155,124,216,0)');
    ctx.fillStyle = halo;
    ctx.beginPath(); ctx.arc(0, 0, R * 1.3, 0, Math.PI * 2); ctx.fill();

    // Wispy filaments radiating out from the body — feathery tendrils
    const filaments = 22;
    for (let i = 0; i < filaments; i++) {
      const a = (i / filaments) * Math.PI * 2 + rng() * 0.05;
      const len = R * (0.85 + rng() * 0.45);
      const grad = ctx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
      grad.addColorStop(0, 'rgba(212,196,240,0)');
      grad.addColorStop(0.4, 'rgba(212,196,240,0.5)');
      grad.addColorStop(1, 'rgba(255,193,209,0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1 + rng() * 0.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * R * 0.45, Math.sin(a) * R * 0.45);
      // gentle curve outward
      const wob = (rng() - 0.5) * 0.3;
      const cx = Math.cos(a + wob) * len * 0.7;
      const cy = Math.sin(a + wob) * len * 0.7;
      ctx.quadraticCurveTo(cx, cy, Math.cos(a) * len, Math.sin(a) * len);
      ctx.stroke();
    }

    // Two opposing curved jaws (top & bottom) — translucent petal shapes
    function jaw(rotate) {
      ctx.save();
      ctx.rotate(rotate);
      const jawGrad = ctx.createLinearGradient(0, -R * 0.85, 0, 0);
      jawGrad.addColorStop(0, 'rgba(255,154,139,0.95)');
      jawGrad.addColorStop(0.5, 'rgba(255,193,209,0.85)');
      jawGrad.addColorStop(1, 'rgba(255,193,209,0.4)');
      ctx.fillStyle = jawGrad;
      ctx.beginPath();
      // Petal/jaw silhouette — curls inward at edges
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(-R * 0.55, -R * 0.2, -R * 0.55, -R * 0.7, -R * 0.05, -R * 0.85);
      ctx.bezierCurveTo(0, -R * 0.95, 0, -R * 0.95, R * 0.05, -R * 0.85);
      ctx.bezierCurveTo(R * 0.55, -R * 0.7, R * 0.55, -R * 0.2, 0, 0);
      ctx.closePath();
      ctx.fill();
      // Inner darker shading
      const inner = ctx.createLinearGradient(0, -R * 0.85, 0, 0);
      inner.addColorStop(0, 'rgba(120,40,90,0)');
      inner.addColorStop(1, 'rgba(80,20,60,0.7)');
      ctx.fillStyle = inner;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(-R * 0.4, -R * 0.15, -R * 0.4, -R * 0.5, -R * 0.04, -R * 0.65);
      ctx.bezierCurveTo(0, -R * 0.7, 0, -R * 0.7, R * 0.04, -R * 0.65);
      ctx.bezierCurveTo(R * 0.4, -R * 0.5, R * 0.4, -R * 0.15, 0, 0);
      ctx.closePath();
      ctx.fill();
      // Tiny luminescent teeth-cilia along the inner edge
      ctx.fillStyle = 'rgba(253,255,254,0.9)';
      const teeth = 8;
      for (let i = 0; i < teeth; i++) {
        const t = i / (teeth - 1);
        // path goes from (-R*0.55,-R*0.2)→ tip → (R*0.55,-R*0.2) along the inner curve
        const ang = Math.PI + t * Math.PI; // sample across half the body
        const x = Math.sin(ang) * R * 0.32;
        const y = -R * 0.45 + Math.cos(ang) * -R * 0.25;
        ctx.beginPath(); ctx.arc(x, y, 1.4, 0, Math.PI * 2); ctx.fill();
      }
      // Rim highlight
      ctx.strokeStyle = 'rgba(253,255,254,0.6)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-R * 0.5, -R * 0.18);
      ctx.bezierCurveTo(-R * 0.52, -R * 0.65, -R * 0.04, -R * 0.85, 0, -R * 0.92);
      ctx.bezierCurveTo(R * 0.04, -R * 0.85, R * 0.52, -R * 0.65, R * 0.5, -R * 0.18);
      ctx.stroke();
      ctx.restore();
    }
    // Open at a slight angle so we see the lure inside
    jaw(-0.18);
    jaw(Math.PI + 0.18);

    // The lure — a glowing pearl at the center, this is the menace
    const pearlBase = ctx.createRadialGradient(-R * 0.04, -R * 0.04, 0, 0, 0, R * 0.18);
    pearlBase.addColorStop(0, 'rgba(255,255,210,1)');
    pearlBase.addColorStop(0.5, 'rgba(255,213,145,0.95)');
    pearlBase.addColorStop(1, 'rgba(255,154,139,0)');
    ctx.fillStyle = pearlBase;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.18, 0, Math.PI * 2); ctx.fill();
    // Hot core
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, R * 0.07);
    core.addColorStop(0, 'rgba(253,255,254,1)');
    core.addColorStop(1, 'rgba(255,213,145,0)');
    ctx.fillStyle = core;
    ctx.beginPath(); ctx.arc(0, 0, R * 0.07, 0, Math.PI * 2); ctx.fill();
    // Specular highlight on pearl
    ctx.fillStyle = 'rgba(253,255,254,0.9)';
    ctx.beginPath(); ctx.arc(-R * 0.025, -R * 0.025, R * 0.018, 0, Math.PI * 2); ctx.fill();

    // Slim stem connecting pearl to the body — barely visible
    ctx.strokeStyle = 'rgba(155,124,216,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, R * 0.05);
    ctx.lineTo(R * 0.02, R * 0.4);
    ctx.stroke();
  }
  function drawMossPatch(ctx, R, rng) {
    // Big watercolor wash
    softBlob(ctx, 0, 0, R * 1.2, 'rgb(95,210,192)', 0.35);
    softBlob(ctx, R * 0.3, -R * 0.2, R * 0.7, 'rgb(155,124,216)', 0.25);
    softBlob(ctx, -R * 0.4, R * 0.3, R * 0.6, 'rgb(255,154,139)', 0.20);
    // Mushroom dots
    for (let i = 0; i < 18; i++) {
      const a = rng() * Math.PI * 2;
      const rad = Math.pow(rng(), 0.6) * R;
      const x = Math.cos(a) * rad, y = Math.sin(a) * rad;
      const sz = R * (0.04 + rng() * 0.04);
      const c = pick(rng, ['rgba(255,213,145,1)', 'rgba(202,255,112,1)', 'rgba(255,193,209,1)']);
      // cap
      ctx.fillStyle = c;
      ctx.beginPath(); ctx.arc(x, y, sz, Math.PI, 0); ctx.fill();
      // stem
      ctx.fillStyle = 'rgba(253,255,254,0.85)';
      ctx.fillRect(x - sz * 0.25, y, sz * 0.5, sz * 0.6);
      // glow
      softBlob(ctx, x, y, sz * 3, c.replace('rgba', 'rgb').replace(/,1\)$/, ')'), 0.4);
    }
  }

  // Transparent-bg variants — skip background paint, just draw the object/star.
  // Used for compositing onto a shared hero canvas.
  function atariStarOnly(canvas, type, seed) {
    const { ctx, w, h } = fitCanvas(canvas, window.devicePixelRatio || 2);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = false;
    drawAtariStar(ctx, w / 2, h / 2, Math.min(w, h) * 0.22, rng32(seed), type);
  }
  function lostStarOnly(canvas, type, seed) {
    const { ctx, w, h } = fitCanvas(canvas, window.devicePixelRatio || 2);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.32;
    drawLostObject(ctx, cx, cy, R, rng32(seed), type);
  }
  function bioStarOnly(canvas, type, seed) {
    const { ctx, w, h } = fitCanvas(canvas, window.devicePixelRatio || 2);
    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    drawBioCreature(ctx, w / 2, h / 2, Math.min(w, h) * 0.32, rng32(seed), type);
  }

  // Public API
  window.NewThemes = { atariStar, lostStar, bioStar, atariStarOnly, lostStarOnly, bioStarOnly };
})();
