// Everything visible is drawn here from code: there are no image files.
// Logical canvas is LOGICAL_W x LOGICAL_H; the Renderer scales it to the window.
(function (root) {
  'use strict';

  const { W, H } = root.PengoCore;
  const CELL = 48;
  const BLOCK_H = 12; // visible front face of an ice block, for the 3/4 view
  const WALL = 22;
  const FIELD_X = WALL + 2;
  const FIELD_Y = 112;
  const FIELD_W = W * CELL;
  const FIELD_H = H * CELL;
  const LOGICAL_W = FIELD_W + FIELD_X * 2;
  const LOGICAL_H = FIELD_Y + FIELD_H + WALL + 58;
  const PAD = 8; // sprite padding, so block glows are not clipped
  // The block in the next row rises BLOCK_H into this one, so the walkable strip
  // sits above the cell centre. Lifting characters keeps their feet in view.
  const CHAR_LIFT = 5;

  const C = {
    sky: '#071C3C',
    lake: '#14568A',
    lakeDeep: '#0E3D6B',
    ice: '#BFF0FF',
    iceDeep: '#2F86BF',
    aurora: '#4DF0B0',
    violet: '#8A5CFF',
    ember: '#FF7A2E',
    gold: '#FFC93C',
    rose: '#FF4D7E',
    ink: '#0A1B38',
    white: '#F4FDFF',
  };

  // ---- 5x7 font: each glyph is seven rows of five bits ---------------------
  const FONT = {
    A: [14, 17, 17, 31, 17, 17, 17], B: [30, 17, 17, 30, 17, 17, 30],
    C: [14, 17, 16, 16, 16, 17, 14], D: [30, 17, 17, 17, 17, 17, 30],
    E: [31, 16, 16, 30, 16, 16, 31], F: [31, 16, 16, 30, 16, 16, 16],
    G: [14, 17, 16, 23, 17, 17, 15], H: [17, 17, 17, 31, 17, 17, 17],
    I: [14, 4, 4, 4, 4, 4, 14], J: [7, 2, 2, 2, 2, 18, 12],
    K: [17, 18, 20, 24, 20, 18, 17], L: [16, 16, 16, 16, 16, 16, 31],
    M: [17, 27, 21, 21, 17, 17, 17], N: [17, 25, 21, 19, 17, 17, 17],
    O: [14, 17, 17, 17, 17, 17, 14], P: [30, 17, 17, 30, 16, 16, 16],
    Q: [14, 17, 17, 17, 21, 18, 13], R: [30, 17, 17, 30, 20, 18, 17],
    S: [15, 16, 16, 14, 1, 1, 30], T: [31, 4, 4, 4, 4, 4, 4],
    U: [17, 17, 17, 17, 17, 17, 14], V: [17, 17, 17, 17, 17, 10, 4],
    W: [17, 17, 17, 21, 21, 27, 17], X: [17, 17, 10, 4, 10, 17, 17],
    Y: [17, 17, 10, 4, 4, 4, 4], Z: [31, 1, 2, 4, 8, 16, 31],
    'Ä': [10, 0, 14, 17, 31, 17, 17], 'Ö': [10, 0, 14, 17, 17, 17, 14],
    0: [14, 17, 19, 21, 25, 17, 14], 1: [4, 12, 4, 4, 4, 4, 14],
    2: [14, 17, 1, 2, 4, 8, 31], 3: [31, 2, 4, 2, 1, 17, 14],
    4: [2, 6, 10, 18, 31, 2, 2], 5: [31, 16, 30, 1, 1, 17, 14],
    6: [6, 8, 16, 30, 17, 17, 14], 7: [31, 1, 2, 4, 8, 8, 8],
    8: [14, 17, 17, 14, 17, 17, 14], 9: [14, 17, 17, 15, 1, 2, 12],
    '.': [0, 0, 0, 0, 0, 12, 12], ',': [0, 0, 0, 0, 12, 4, 8],
    ':': [0, 12, 12, 0, 12, 12, 0], '!': [4, 4, 4, 4, 4, 0, 4],
    '-': [0, 0, 0, 31, 0, 0, 0], '+': [0, 4, 4, 31, 4, 4, 0],
    '/': [1, 1, 2, 4, 8, 16, 16], '?': [14, 17, 1, 2, 4, 0, 4],
    "'": [4, 4, 8, 0, 0, 0, 0], ' ': [0, 0, 0, 0, 0, 0, 0],
  };

  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function seeded(seed) {
    let s = seed * 2654435761 % 4294967296;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  }

  function ellipse(ctx, x, y, rx, ry, fill, rot) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
  }

  const easeOutBack = (t) => {
    const c = 1.70158;
    const u = t - 1;
    return 1 + (c + 1) * u * u * u + c * u * u;
  };
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  class Renderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.reduced = root.matchMedia &&
        root.matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.particles = [];
      this.popups = [];
      this.snow = [];
      this.shakes = { left: 0, right: 0, up: 0, down: 0 };
      this.screenShake = 0;
      this.flash = 0;
      this.banner = null;
      const rnd = seeded(5);
      for (let i = 0; i < 46; i++) {
        this.snow.push({
          x: rnd() * LOGICAL_W, y: rnd() * LOGICAL_H,
          s: 0.6 + rnd() * 1.8, v: 8 + rnd() * 22, w: rnd() * 6.28,
        });
      }
      this.resize();
    }

    resize() {
      const dpr = Math.min(root.devicePixelRatio || 1, 2);
      const fit = Math.min(root.innerWidth / LOGICAL_W, root.innerHeight / LOGICAL_H);
      this.canvas.style.width = Math.floor(LOGICAL_W * fit) + 'px';
      this.canvas.style.height = Math.floor(LOGICAL_H * fit) + 'px';
      this.S = fit * dpr;
      this.canvas.width = Math.round(LOGICAL_W * this.S);
      this.canvas.height = Math.round(LOGICAL_H * this.S);
      this.buildSprites();
    }

    makeSprite(w, h, draw) {
      const c = document.createElement('canvas');
      c.width = Math.ceil(w * this.S);
      c.height = Math.ceil(h * this.S);
      const g = c.getContext('2d');
      g.scale(this.S, this.S);
      draw(g);
      c.logicalW = w;
      c.logicalH = h;
      return c;
    }

    buildSprites() {
      this.glyphs = new Map();
      this.iceSprites = [];
      const size = CELL + PAD * 2;
      const height = CELL + BLOCK_H + PAD * 2;
      for (let v = 0; v < 6; v++) {
        this.iceSprites.push(this.makeSprite(size, height, (g) => this.drawIce(g, v)));
      }
      this.diamondSprite = this.makeSprite(size, height, (g) => this.drawDiamond(g));
      this.eggSprite = this.makeSprite(size, height, (g) => this.drawEgg(g));
      this.crackSprite = this.makeSprite(size, height, (g) => this.drawCracks(g));
      this.shadowSprite = this.makeSprite(size, size, (g) => {
        const grad = g.createRadialGradient(size / 2, size / 2, 8, size / 2, size / 2, size / 2);
        grad.addColorStop(0, 'rgba(4,20,48,0.55)');
        grad.addColorStop(1, 'rgba(4,20,48,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, size, size);
      });
      this.emberGlow = this.makeSprite(120, 120, (g) => {
        const grad = g.createRadialGradient(60, 60, 4, 60, 60, 60);
        grad.addColorStop(0, 'rgba(255,140,60,0.55)');
        grad.addColorStop(1, 'rgba(255,90,40,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 120, 120);
      });
      this.floorSprite = this.makeSprite(FIELD_W, FIELD_H, (g) => this.drawFloor(g));
      this.vignette = this.makeSprite(FIELD_W, FIELD_H, (g) => {
        const cx = FIELD_W / 2;
        const cy = FIELD_H / 2;
        const grad = g.createRadialGradient(cx, cy, FIELD_H * 0.42, cx, cy, FIELD_H * 0.72);
        grad.addColorStop(0, 'rgba(5,16,44,0)');
        grad.addColorStop(1, 'rgba(5,16,44,0.45)');
        g.fillStyle = grad;
        g.fillRect(0, 0, FIELD_W, FIELD_H);
      });
      // Aurora is drawn small and stretched: soft by construction, and cheap.
      this.auroraCanvas = document.createElement('canvas');
      this.auroraCanvas.width = 160;
      this.auroraCanvas.height = 60;
      this.auroraCtx = this.auroraCanvas.getContext('2d');
      this.backdrop = document.createElement('canvas');
      this.backdrop.width = this.canvas.width;
      this.backdrop.height = this.canvas.height;
      this.backdropCtx = this.backdrop.getContext('2d');
      this.backdropFrame = 0;
    }

    // ---- sprites ---------------------------------------------------------

    blockBody(g, topStops, frontTop, frontBottom) {
      const x = PAD + 1;
      const y = PAD + 1;
      const s = CELL - 2;
      rr(g, x, y, s, s + BLOCK_H, 7);
      const front = g.createLinearGradient(0, y + s - 8, 0, y + s + BLOCK_H);
      front.addColorStop(0, frontTop);
      front.addColorStop(1, frontBottom);
      g.fillStyle = front;
      g.fill();
      rr(g, x, y, s, s, 7);
      const top = g.createLinearGradient(x, y, x + s, y + s);
      topStops.forEach(([at, col]) => top.addColorStop(at, col));
      g.fillStyle = top;
      g.fill();
    }

    drawIce(g, variant) {
      const rnd = seeded(variant + 11);
      this.blockBody(
        g,
        [[0, '#F2FDFF'], [0.42, '#B4ECFB'], [1, '#62BFE8']],
        '#3F9FD4',
        '#175F97'
      );
      const x = PAD + 1;
      const y = PAD + 1;
      const s = CELL - 2;
      g.save();
      rr(g, x, y, s, s, 7);
      g.clip();
      // Refraction facets: pale shards frozen inside the block
      for (let i = 0; i < 5; i++) {
        const px = x + rnd() * s;
        const py = y + rnd() * s;
        const r = 8 + rnd() * 20;
        g.beginPath();
        const n = 3 + Math.floor(rnd() * 2);
        for (let k = 0; k < n; k++) {
          const a = rnd() * 6.283;
          g.lineTo(px + Math.cos(a) * r, py + Math.sin(a) * r);
        }
        g.closePath();
        g.fillStyle = rnd() > 0.5
          ? `rgba(255,255,255,${0.14 + rnd() * 0.2})`
          : `rgba(40,140,205,${0.08 + rnd() * 0.13})`;
        g.fill();
      }
      // Glossy diagonal sheen
      g.globalCompositeOperation = 'lighter';
      const band = g.createLinearGradient(x, y, x + s * 0.7, y + s * 0.7);
      band.addColorStop(0.1, 'rgba(255,255,255,0)');
      band.addColorStop(0.32, 'rgba(255,255,255,0.42)');
      band.addColorStop(0.46, 'rgba(255,255,255,0)');
      g.fillStyle = band;
      g.fillRect(x, y, s, s);
      g.globalCompositeOperation = 'source-over';
      // Trapped air bubbles
      for (let i = 0; i < 4; i++) {
        ellipse(g, x + 8 + rnd() * (s - 16), y + 8 + rnd() * (s - 16), 0.8 + rnd() * 1.4,
          0.8 + rnd() * 1.4, 'rgba(255,255,255,0.7)');
      }
      g.restore();
      this.blockEdges(g, x, y, s, 'rgba(255,255,255,0.95)', 'rgba(16,90,150,0.55)');
    }

    blockEdges(g, x, y, s, light, dark) {
      rr(g, x + 1, y + 1, s - 2, s - 2, 6);
      const edge = g.createLinearGradient(x, y, x + s, y + s);
      edge.addColorStop(0, light);
      edge.addColorStop(0.55, 'rgba(255,255,255,0.15)');
      edge.addColorStop(1, dark);
      g.strokeStyle = edge;
      g.lineWidth = 1.6;
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.fillRect(x + 7, y + s + 1, s - 14, 1.3);
    }

    drawDiamond(g) {
      this.blockBody(
        g,
        [[0, '#FFF8DC'], [0.5, '#FFE28A'], [1, '#F1A92A']],
        '#D98A18',
        '#8F4C0C'
      );
      const x = PAD + 1;
      const y = PAD + 1;
      const s = CELL - 2;
      const cx = x + s / 2;
      const cy = y + s / 2;
      // A cut gem seen from the side: crown above the girdle, pavilion below.
      const girdle = cy - 5;
      const crownTop = cy - 14;
      const tip = cy + 17;
      const facet = (pts, fill) => {
        g.beginPath();
        pts.forEach(([px, py]) => g.lineTo(cx + px, py));
        g.closePath();
        g.fillStyle = fill;
        g.fill();
        g.strokeStyle = 'rgba(90,120,170,0.55)';
        g.lineWidth = 0.7;
        g.lineJoin = 'round';
        g.stroke();
      };
      ellipse(g, cx, cy + 15, 15, 4, 'rgba(150,80,10,0.4)');
      const crown = [
        [[-19, girdle], [-11, crownTop], [-6, girdle], '#DDF6FF'],
        [[-11, crownTop], [0, crownTop], [-6, girdle], '#FFFFFF'],
        [[-6, girdle], [0, crownTop], [6, girdle], '#BCEBFF'],
        [[0, crownTop], [11, crownTop], [6, girdle], '#F3FCFF'],
        [[6, girdle], [11, crownTop], [19, girdle], '#8FD8F8'],
      ];
      crown.forEach((f) => facet(f.slice(0, 3), f[3]));
      const pavilion = [
        [[-19, girdle], [-6, girdle], [0, tip], '#A8E2FA'],
        [[-6, girdle], [6, girdle], [0, tip], '#EAFAFF'],
        [[6, girdle], [19, girdle], [0, tip], '#62BCEB'],
      ];
      pavilion.forEach((f) => facet(f.slice(0, 3), f[3]));
      this.blockEdges(g, x, y, s, 'rgba(255,255,255,0.95)', 'rgba(130,70,10,0.6)');
    }

    drawEgg(g) {
      const cx = PAD + CELL / 2;
      const cy = PAD + CELL / 2;
      const glow = g.createRadialGradient(cx, cy, 2, cx, cy, 22);
      glow.addColorStop(0, 'rgba(255,190,90,0.95)');
      glow.addColorStop(0.55, 'rgba(255,110,50,0.6)');
      glow.addColorStop(1, 'rgba(255,80,60,0)');
      g.fillStyle = glow;
      g.fillRect(cx - 24, cy - 24, 48, 48);
      ellipse(g, cx, cy + 1, 10, 13, '#FF8A3A');
      ellipse(g, cx - 3, cy - 4, 3, 4.5, 'rgba(255,240,190,0.9)', -0.3);
    }

    drawCracks(g) {
      const rnd = seeded(23);
      const cx = PAD + CELL / 2;
      const cy = PAD + CELL / 2;
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = 1.5;
      g.lineCap = 'round';
      for (let i = 0; i < 7; i++) {
        let a = (i / 7) * 6.283 + rnd();
        let x = cx;
        let y = cy;
        g.beginPath();
        g.moveTo(x, y);
        for (let k = 0; k < 3; k++) {
          const len = 6 + rnd() * 6;
          a += (rnd() - 0.5) * 0.9;
          x += Math.cos(a) * len;
          y += Math.sin(a) * len;
          g.lineTo(x, y);
        }
        g.stroke();
      }
    }

    drawFloor(g) {
      const rnd = seeded(41);
      const base = g.createRadialGradient(
        FIELD_W / 2, FIELD_H * 0.42, 40, FIELD_W / 2, FIELD_H / 2, FIELD_H * 0.72
      );
      base.addColorStop(0, '#1C6DA6');
      base.addColorStop(0.6, C.lake);
      base.addColorStop(1, C.lakeDeep);
      g.fillStyle = base;
      g.fillRect(0, 0, FIELD_W, FIELD_H);
      // Quiet checker gives the eye the grid without drawing lines
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if ((x + y) % 2) {
            g.fillStyle = 'rgba(160,225,255,0.035)';
            g.fillRect(x * CELL, y * CELL, CELL, CELL);
          }
        }
      }
      // Pressure cracks in the lake ice
      g.lineCap = 'round';
      for (let i = 0; i < 16; i++) {
        let x = rnd() * FIELD_W;
        let y = rnd() * FIELD_H;
        let a = rnd() * 6.283;
        g.beginPath();
        g.moveTo(x, y);
        const steps = 3 + Math.floor(rnd() * 6);
        for (let k = 0; k < steps; k++) {
          a += (rnd() - 0.5) * 1.1;
          const len = 10 + rnd() * 26;
          x += Math.cos(a) * len;
          y += Math.sin(a) * len;
          g.lineTo(x, y);
        }
        g.strokeStyle = `rgba(190,240,255,${0.07 + rnd() * 0.13})`;
        g.lineWidth = 0.6 + rnd() * 1.1;
        g.stroke();
      }
      // Frost dust
      for (let i = 0; i < 260; i++) {
        ellipse(g, rnd() * FIELD_W, rnd() * FIELD_H, 0.5 + rnd() * 1.2, 0.5 + rnd() * 1.2,
          `rgba(225,250,255,${0.04 + rnd() * 0.14})`);
      }
    }

    // ---- bitmap text -----------------------------------------------------

    glyph(ch, px, color) {
      const key = ch + '|' + px + '|' + color;
      let sprite = this.glyphs.get(key);
      if (sprite) return sprite;
      const rows = FONT[ch] || FONT['?'];
      sprite = this.makeSprite(5 * px + 2, 7 * px + 3, (g) => {
        // Dark drop first, then frost squares with a lit top edge
        for (const pass of [0, 1]) {
          for (let r = 0; r < 7; r++) {
            for (let col = 0; col < 5; col++) {
              if (!(rows[r] & (1 << (4 - col)))) continue;
              const x = col * px;
              const y = r * px;
              if (pass === 0) {
                g.fillStyle = 'rgba(4,18,46,0.75)';
                rr(g, x + 0.6, y + 1.8, px, px, px * 0.24);
                g.fill();
              } else {
                g.fillStyle = color;
                rr(g, x + 0.2, y + 0.2, px - 0.1, px - 0.1, px * 0.24);
                g.fill();
                g.fillStyle = 'rgba(255,255,255,0.4)';
                g.fillRect(x + px * 0.2, y + px * 0.14, px * 0.6, Math.max(0.5, px * 0.16));
              }
            }
          }
        }
      });
      this.glyphs.set(key, sprite);
      return sprite;
    }

    textWidth(str, px) {
      return String(str).length * 6 * px - px;
    }

    text(str, x, y, px, color, align) {
      const s = String(str).toUpperCase();
      const w = this.textWidth(s, px);
      let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
      for (const ch of s) {
        if (ch !== ' ') {
          const sprite = this.glyph(ch, px, color || C.white);
          this.ctx.drawImage(sprite, cx, y, sprite.logicalW, sprite.logicalH);
        }
        cx += 6 * px;
      }
    }

    // ---- characters ------------------------------------------------------

    drawPengo(ctx, x, y, dir, opts = {}) {
      const walk = opts.walk || 0;
      const moving = opts.moving;
      const swing = moving ? Math.sin(walk * Math.PI * 2) : 0;
      const bob = moving ? Math.abs(swing) * 2.4 : Math.sin((opts.t || 0) * 2.4) * 0.5;
      ctx.save();
      ctx.translate(x, y);
      if (opts.scale) ctx.scale(opts.scale, opts.scale);
      if (opts.spin) ctx.rotate(opts.spin);
      if (opts.flat !== undefined) ctx.scale(1 + (1 - opts.flat) * 0.25, opts.flat);
      ctx.translate(0, -bob);
      ctx.rotate(swing * 0.09);
      const lean = opts.push ? 3.5 : 0;
      if (dir === 'left') ctx.scale(-1, 1);
      if (dir === 'left' || dir === 'right') ctx.translate(lean, 0);
      if (dir === 'up') ctx.translate(0, -lean);
      if (dir === 'down') ctx.translate(0, lean);

      const footL = moving ? swing * 3 : 0;
      // Feet
      ellipse(ctx, -7, 13 + footL * 0.6, 6, 3.4, '#FF9A1F');
      ellipse(ctx, 7, 13 - footL * 0.6, 6, 3.4, '#FF9A1F');

      const bodyGrad = ctx.createLinearGradient(-14, -18, 14, 16);
      bodyGrad.addColorStop(0, '#2E6CB5');
      bodyGrad.addColorStop(0.45, '#123467');
      bodyGrad.addColorStop(1, C.ink);

      const side = dir === 'left' || dir === 'right';
      // Pale rim keeps the dark bird readable on the dark lake
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(0, 1.5, side ? 14 : 16, 16.5, 0, 0, Math.PI * 2);
      ctx.ellipse(side ? 1 : 0, -13, 13, 12, 0, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(190,240,255,0.55)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();

      const flip = opts.push ? -1 : 1;
      if (!side) {
        // Flippers either side
        ctx.save();
        ctx.translate(-15, -1);
        ctx.rotate(0.35 + swing * 0.25 + (opts.push ? -1.2 : 0) + (opts.cheer ? -1.9 : 0));
        ellipse(ctx, 0, 6, 4, 10, '#163E78');
        ctx.restore();
        ctx.save();
        ctx.translate(15, -1);
        ctx.rotate(-0.35 - swing * 0.25 + (opts.push ? 1.2 : 0) + (opts.cheer ? 1.9 : 0));
        ellipse(ctx, 0, 6, 4, 10, '#163E78');
        ctx.restore();
      }

      // Body and head
      ellipse(ctx, 0, 1.5, side ? 14 : 16, 16.5, bodyGrad);
      ellipse(ctx, side ? 1 : 0, -13, 13, 12, bodyGrad);

      if (dir === 'down') {
        ellipse(ctx, 0, 4, 11, 12.5, C.white);
        // Heart-shaped face
        ctx.fillStyle = C.white;
        ellipse(ctx, -5, -12.5, 6.6, 6.8, C.white);
        ellipse(ctx, 5, -12.5, 6.6, 6.8, C.white);
        ellipse(ctx, 0, -8, 7, 5.5, C.white);
        if (opts.dead) {
          this.crossEye(ctx, -5, -13);
          this.crossEye(ctx, 5, -13);
        } else {
          ellipse(ctx, -4.8, -13, 2.6, 3.4, C.ink);
          ellipse(ctx, 4.8, -13, 2.6, 3.4, C.ink);
          ellipse(ctx, -4, -14.3, 1, 1.2, '#fff');
          ellipse(ctx, 5.6, -14.3, 1, 1.2, '#fff');
        }
        ctx.beginPath();
        ctx.moveTo(-4.5, -9);
        ctx.quadraticCurveTo(0, -3, 4.5, -9);
        ctx.quadraticCurveTo(0, -10.5, -4.5, -9);
        ctx.fillStyle = '#FF9A1F';
        ctx.fill();
      } else if (dir === 'up') {
        ellipse(ctx, 0, 5, 7, 8, 'rgba(70,130,200,0.28)');
        ellipse(ctx, 0, 16, 3.2, 2.4, C.ink);
      } else {
        ellipse(ctx, 5, 4, 8, 12, C.white);
        ellipse(ctx, 6, -12.5, 6.4, 6.8, C.white);
        if (opts.dead) this.crossEye(ctx, 7, -13);
        else {
          ellipse(ctx, 7, -13, 2.5, 3.2, C.ink);
          ellipse(ctx, 7.8, -14.2, 0.9, 1.1, '#fff');
        }
        ctx.beginPath();
        ctx.moveTo(10.5, -12);
        ctx.quadraticCurveTo(19, -9.5, 18, -8);
        ctx.quadraticCurveTo(13, -6.5, 10, -8.5);
        ctx.closePath();
        ctx.fillStyle = '#FF9A1F';
        ctx.fill();
        // Near flipper
        ctx.save();
        ctx.translate(-2, -1);
        ctx.rotate(0.15 - swing * 0.4 + (opts.push ? -1.5 : 0) * flip * -1);
        ellipse(ctx, 0, 6.5, 4, 10.5, '#1B4A8C');
        ctx.restore();
      }

      // Red scarf: the one warm note that is his alone
      ctx.fillStyle = '#E8234F';
      ctx.beginPath();
      ctx.ellipse(side ? 1 : 0, -4, side ? 12 : 13.5, 3.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(-8, -6.4, 14, 1);
      const flap = Math.sin((opts.t || 0) * 7 + walk * 5) * 2;
      ctx.fillStyle = '#C8143E';
      if (side) {
        ctx.beginPath();
        ctx.moveTo(-8, -5);
        ctx.quadraticCurveTo(-16, -3 + flap, -21, -5 + flap);
        ctx.lineTo(-20, 1 + flap);
        ctx.quadraticCurveTo(-14, 2, -8, -1);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(dir === 'up' ? 1 : 6, -3);
        ctx.lineTo(dir === 'up' ? 5 + flap : 11 + flap * 0.5, 9);
        ctx.lineTo(dir === 'up' ? -3 + flap : 4 + flap * 0.5, 9);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }

    crossEye(ctx, x, y) {
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x - 2.5, y - 2.5);
      ctx.lineTo(x + 2.5, y + 2.5);
      ctx.moveTo(x + 2.5, y - 2.5);
      ctx.lineTo(x - 2.5, y + 2.5);
      ctx.stroke();
    }

    drawBee(ctx, x, y, b, t) {
      const state = b.state;
      const seed = (b.id || 0) * 1.7;
      const wob = Math.sin(t * 9 + seed);
      ctx.save();
      ctx.translate(x, y - 3 - (state === 'walk' ? Math.abs(wob) * 2 : 0));
      if (state === 'stun') ctx.rotate(Math.sin(t * 7 + seed) * 0.16);
      if (state === 'carried') ctx.scale(0.8, 1.2);
      const scale = b.scale || 1;
      ctx.scale(scale, scale);

      // Wings blur behind the body
      if (state !== 'stun' && state !== 'carried') {
        const flap = Math.sin(t * 46 + seed);
        for (const sgn of [-1, 1]) {
          ctx.save();
          ctx.translate(sgn * 12, -11);
          ctx.rotate(sgn * (0.7 + flap * 0.4));
          ellipse(ctx, 0, -6, 4.5, 10, 'rgba(225,245,255,0.58)');
          ctx.restore();
        }
      }

      // Antennae with ember tips
      ctx.strokeStyle = '#7A1C2E';
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      for (const sgn of [-1, 1]) {
        const tip = sgn * (10 + wob * 1.2);
        ctx.beginPath();
        ctx.moveTo(sgn * 5, -13);
        ctx.quadraticCurveTo(sgn * 6, -20, tip, -23);
        ctx.stroke();
        ellipse(ctx, tip, -23, 2.8, 2.8, state === 'stun' ? '#9CD8F0' : C.gold);
      }

      // Fluffy body: a ring of tufts round a glowing core
      const stunned = state === 'stun';
      const hot = b.rage || b.flee;
      const pulse = 0.5 + 0.5 * Math.sin(t * 8 + seed);
      const rim = stunned ? '#6E8FBE' : hot ? '#D11F5C' : '#E23C3C';
      const n = 20;
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const R = i % 2 ? 19.5 : 16.5;
        ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R * 0.94);
      }
      ctx.closePath();
      ctx.fillStyle = rim;
      ctx.fill();
      const grad = ctx.createRadialGradient(-3, -5, 2, 0, 0, 18);
      if (stunned) {
        grad.addColorStop(0, '#E4F6FF');
        grad.addColorStop(0.6, '#A9C7E6');
        grad.addColorStop(1, '#6E8FBE');
      } else if (hot) {
        grad.addColorStop(0, '#FFE680');
        grad.addColorStop(0.45, pulse > 0.5 ? '#FF6A2E' : '#FF5238');
        grad.addColorStop(1, '#D11F5C');
      } else {
        grad.addColorStop(0, '#FFE9A0');
        grad.addColorStop(0.5, C.ember);
        grad.addColorStop(1, '#E23C3C');
      }
      ellipse(ctx, 0, 0, 16.8, 15.8, grad);

      // Stubby feet
      const step = state === 'walk' ? Math.sin(t * 14 + seed) * 2 : 0;
      ellipse(ctx, -7, 15 + step, 4.8, 2.8, '#7A1C2E');
      ellipse(ctx, 7, 15 - step, 4.8, 2.8, '#7A1C2E');

      // Face
      if (stunned) {
        for (const sgn of [-1, 1]) {
          ctx.strokeStyle = C.ink;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (let a = 0; a < 9; a += 0.5) {
            const r = a * 0.55;
            ctx.lineTo(sgn * 6.5 + Math.cos(a + t * 6) * r, -3 + Math.sin(a + t * 6) * r);
          }
          ctx.stroke();
        }
        ellipse(ctx, 0, 7.5, 3, 2.2, C.ink);
      } else if (state === 'carried') {
        this.crossEye(ctx, -6, -3);
        this.crossEye(ctx, 6, -3);
        ellipse(ctx, 0, 7, 4.5, 3.8, '#5A1020');
      } else {
        const d = root.PengoCore.DIRS[b.dir] || { x: 0, y: 1 };
        for (const sgn of [-1, 1]) {
          ellipse(ctx, sgn * 6.5, -3, 5.8, 6.4, '#FFFFFF');
          ellipse(ctx, sgn * 6.5 + d.x * 2.2, -3 + d.y * 2.2, 2.7, 3.2, C.ink);
          ellipse(ctx, sgn * 6.5 + d.x * 2.2 + 0.9, -4 + d.y * 2.2, 0.9, 1, '#fff');
          ctx.strokeStyle = '#5A1020';
          ctx.lineWidth = 2.6;
          ctx.beginPath();
          const tilt = hot ? 4.4 : 2.2;
          ctx.moveTo(sgn * 12, -9.4 - tilt * 0.4);
          ctx.lineTo(sgn * 2.4, -9.4 + tilt * 0.4);
          ctx.stroke();
        }
        if (state === 'eat') {
          const open = 2 + Math.abs(Math.sin(t * 20)) * 4;
          ellipse(ctx, 0, 7.5, 5.5, open, '#5A1020');
        } else {
          ctx.strokeStyle = '#5A1020';
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.moveTo(-4.5, 8.5);
          ctx.quadraticCurveTo(0, hot ? 5.8 : 10.5, 4.5, 8.5);
          ctx.stroke();
        }
      }

      if (stunned) {
        for (let i = 0; i < 3; i++) {
          const a = t * 4 + (i * Math.PI * 2) / 3;
          this.star(ctx, Math.cos(a) * 15, -21 + Math.sin(a) * 4, 3, C.gold);
        }
      }
      ctx.restore();
    }

    star(ctx, x, y, r, color) {
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const R = i % 2 ? r * 0.38 : r;
        ctx.lineTo(x + Math.cos(a) * R, y + Math.sin(a) * R);
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }

    // ---- effects ---------------------------------------------------------

    cellX(x) {
      return FIELD_X + x * CELL + CELL / 2;
    }

    cellY(y) {
      return FIELD_Y + y * CELL + CELL / 2;
    }

    spray(x, y, count, opts = {}) {
      if (this.particles.length > 500) return;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * 6.283;
        const sp = (opts.speed || 150) * (0.3 + Math.random() * 0.9);
        this.particles.push({
          x, y, z: 0,
          vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.7, vz: 60 + Math.random() * 180,
          life: 0, max: (opts.life || 0.65) * (0.55 + Math.random() * 0.7),
          size: (opts.size || 5) * (0.5 + Math.random()),
          rot: Math.random() * 6.283, vr: (Math.random() - 0.5) * 14,
          color: opts.colors[Math.floor(Math.random() * opts.colors.length)],
          kind: opts.kind || 'shard',
        });
      }
    }

    popup(x, y, str, color, px) {
      this.popups.push({ x, y, str, color: color || C.gold, life: 0, max: 1.15, px: px || 3 });
    }

    handleEvent(e) {
      const ICE = ['#FFFFFF', '#CFF4FF', '#8EDBF6', '#5EBBE6'];
      const EMBER = ['#FFE680', '#FF9A3D', '#FF5E3A', '#FFD1A0'];
      switch (e.type) {
        case 'break':
          this.spray(this.cellX(e.x), this.cellY(e.y), e.by === 'bee' ? 14 : 26, { colors: ICE });
          this.spray(this.cellX(e.x), this.cellY(e.y), 10, {
            colors: ['#FFFFFF'], kind: 'dust', size: 3, speed: 80,
          });
          break;
        case 'eggbreak':
          this.spray(this.cellX(e.x), this.cellY(e.y), 14, { colors: EMBER, size: 4 });
          this.popup(this.cellX(e.x), this.cellY(e.y) - 18, e.score, C.white);
          break;
        case 'land':
          this.spray(this.cellX(e.x), this.cellY(e.y) + 18, 6, {
            colors: ['#FFFFFF'], kind: 'dust', size: 3, speed: 70, life: 0.4,
          });
          this.kick(1.5);
          break;
        case 'crush':
          this.spray(this.cellX(e.x), this.cellY(e.y), 24 + e.count * 10, { colors: EMBER, speed: 210 });
          this.popup(this.cellX(e.x), this.cellY(e.y) - 22, e.score, C.gold, e.count > 1 ? 4 : 3);
          this.kick(4 + e.count * 2);
          break;
        case 'stomp':
          this.spray(this.cellX(e.x), this.cellY(e.y), 18, { colors: EMBER });
          this.popup(this.cellX(e.x), this.cellY(e.y) - 22, e.score, C.white);
          break;
        case 'shake':
          this.shakes[e.side] = 1;
          this.kick(e.stunned ? 3 : 2);
          break;
        case 'hatch':
          this.spray(this.cellX(e.x), this.cellY(e.y), 16, { colors: ICE.concat(EMBER), size: 4 });
          break;
        case 'die':
          this.spray(this.cellX(e.x), this.cellY(e.y), 18, { colors: ['#FFFFFF', '#2E6CB5', '#E8234F'] });
          this.kick(6);
          break;
        case 'diamonds':
          this.flash = 1;
          for (const c of e.cells) {
            this.spray(this.cellX(c.x), this.cellY(c.y), 30, {
              colors: [C.gold, '#FFFFFF', '#FFE680'], kind: 'star', speed: 240, life: 1.1, size: 7,
            });
          }
          this.popup(this.cellX(e.cells[1].x), this.cellY(e.cells[1].y) - 24, e.bonus, C.gold, 5);
          this.kick(7);
          break;
        case 'life':
          this.banner = { text: 'EXTRA LIFE!', t: 0, max: 1.8, color: C.aurora };
          break;
        default:
          break;
      }
    }

    kick(amount) {
      if (!this.reduced) this.screenShake = Math.max(this.screenShake, amount);
    }

    updateEffects(dt) {
      for (const p of this.particles) {
        p.life += dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.z += p.vz * dt;
        p.vz -= 520 * dt;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.rot += p.vr * dt;
        if (p.z < 0) {
          p.z = 0;
          p.vz *= -0.35;
        }
      }
      this.particles = this.particles.filter((p) => p.life < p.max);
      for (const p of this.popups) p.life += dt;
      this.popups = this.popups.filter((p) => p.life < p.max);
      for (const k of Object.keys(this.shakes)) this.shakes[k] = Math.max(0, this.shakes[k] - dt * 1.5);
      this.screenShake = Math.max(0, this.screenShake - dt * 26);
      this.flash = Math.max(0, this.flash - dt * 1.6);
      if (this.banner) {
        this.banner.t += dt;
        if (this.banner.t > this.banner.max) this.banner = null;
      }
      for (const s of this.snow) {
        s.y += s.v * dt;
        s.x += Math.sin(s.y * 0.02 + s.w) * 10 * dt;
        if (s.y > LOGICAL_H) {
          s.y = -4;
          s.x = Math.random() * LOGICAL_W;
        }
      }
    }

    // ---- scene pieces ----------------------------------------------------

    drawAurora(t) {
      const g = this.auroraCtx;
      const w = this.auroraCanvas.width;
      const h = this.auroraCanvas.height;
      const time = this.reduced ? 12 : t;
      g.clearRect(0, 0, w, h);
      g.globalCompositeOperation = 'lighter';
      const ribbons = [
        { base: 0.38, amp: 0.2, f: 0.052, sp: 0.35, col: '77,240,176', a: 0.55, len: 0.55 },
        { base: 0.52, amp: 0.17, f: 0.08, sp: -0.24, col: '138,92,255', a: 0.5, len: 0.45 },
        { base: 0.28, amp: 0.13, f: 0.035, sp: 0.18, col: '84,220,255', a: 0.35, len: 0.4 },
      ];
      for (const r of ribbons) {
        for (let x = 0; x < w; x++) {
          const y = h * (r.base + r.amp * Math.sin(x * r.f + time * r.sp)
            + 0.06 * Math.sin(x * r.f * 2.7 - time * r.sp * 1.6));
          const shimmer = 0.6 + 0.4 * Math.sin(x * 0.2 + time * 1.3);
          const len = h * r.len * (0.7 + 0.3 * Math.sin(x * 0.09 + time * 0.5));
          const grad = g.createLinearGradient(0, y - len, 0, y + 3);
          grad.addColorStop(0, `rgba(${r.col},0)`);
          grad.addColorStop(0.85, `rgba(${r.col},${r.a * shimmer})`);
          grad.addColorStop(1, `rgba(${r.col},0)`);
          g.fillStyle = grad;
          g.fillRect(x, y - len, 1, len + 3);
        }
      }
      g.globalCompositeOperation = 'destination-in';
      const edges = g.createLinearGradient(0, 0, w, 0);
      edges.addColorStop(0, 'rgba(0,0,0,0)');
      edges.addColorStop(0.1, 'rgba(0,0,0,1)');
      edges.addColorStop(0.9, 'rgba(0,0,0,1)');
      edges.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = edges;
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'source-over';
    }

    // Sky, floor and the lake's reflection change slowly but are the costliest
    // layers, so they are composed off-screen every few frames and blitted.
    drawFieldBackdrop(t) {
      if (this.backdropFrame++ % 4 === 0) {
        this.drawAurora(t);
        const g = this.backdropCtx;
        g.setTransform(this.S, 0, 0, this.S, 0, 0);
        g.fillStyle = C.sky;
        g.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
        g.imageSmoothingEnabled = true;
        g.imageSmoothingQuality = 'medium';
        g.drawImage(this.auroraCanvas, 0, -6, LOGICAL_W, FIELD_Y + 24);
        g.drawImage(this.floorSprite, FIELD_X, FIELD_Y, FIELD_W, FIELD_H);
        g.save();
        g.beginPath();
        g.rect(FIELD_X, FIELD_Y, FIELD_W, FIELD_H);
        g.clip();
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.34;
        g.translate(0, FIELD_Y + FIELD_H * 0.6);
        g.scale(1, -1);
        g.drawImage(this.auroraCanvas, 0, -FIELD_H * 0.42, LOGICAL_W, FIELD_H * 0.62);
        g.restore();
        // Darkens the lake only: over the blocks it turned bright ice a muddy grey.
        g.drawImage(this.vignette, FIELD_X, FIELD_Y, FIELD_W, FIELD_H);
      }
      this.ctx.drawImage(this.backdrop, 0, 0, LOGICAL_W, LOGICAL_H);
    }

    wallPath(side, t) {
      const ctx = this.ctx;
      const amp = this.shakes[side];
      const off = WALL / 2 - 1;
      const x0 = FIELD_X - off;
      const y0 = FIELD_Y - off;
      const x1 = FIELD_X + FIELD_W + off;
      const y1 = FIELD_Y + FIELD_H + off;
      const pts = {
        up: [x0, y0, x1, y0], down: [x0, y1, x1, y1],
        left: [x0, y0, x0, y1], right: [x1, y0, x1, y1],
      }[side];
      const len = Math.hypot(pts[2] - pts[0], pts[3] - pts[1]);
      const nx = side === 'left' || side === 'right' ? 1 : 0;
      const ny = 1 - nx;
      const motion = this.reduced ? 0.3 : 1;
      ctx.beginPath();
      for (let s = 0; s <= len; s += 10) {
        const f = s / len;
        const env = Math.sin(f * Math.PI);
        const d = amp * amp * 8 * env * motion * Math.sin(s * 0.09 - t * 42);
        const x = pts[0] + (pts[2] - pts[0]) * f + nx * d;
        const y = pts[1] + (pts[3] - pts[1]) * f + ny * d;
        if (s === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }

    drawWalls(t, sides) {
      const ctx = this.ctx;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const side of sides) {
        const amp = this.shakes[side];
        this.wallPath(side, t);
        ctx.lineWidth = WALL;
        ctx.strokeStyle = '#123F73';
        ctx.stroke();
        ctx.lineWidth = WALL - 6;
        ctx.strokeStyle = '#2F86BF';
        ctx.stroke();
        ctx.lineWidth = 6;
        ctx.strokeStyle = 'rgba(191,240,255,0.65)';
        ctx.stroke();
        // Live current in the fence: runs quiet, flares when struck
        const pulse = 0.55 + 0.25 * Math.sin(t * 3.1 + side.length);
        ctx.lineWidth = 2 + amp * 4;
        ctx.strokeStyle = amp > 0.02
          ? `rgba(255,240,160,${0.5 + amp * 0.5})`
          : `rgba(120,250,220,${pulse})`;
        ctx.stroke();
      }
    }

    wallPosts() {
      const ctx = this.ctx;
      const off = WALL / 2 - 1;
      const corners = [
        [FIELD_X - off, FIELD_Y - off], [FIELD_X + FIELD_W + off, FIELD_Y - off],
        [FIELD_X - off, FIELD_Y + FIELD_H + off], [FIELD_X + FIELD_W + off, FIELD_Y + FIELD_H + off],
      ];
      for (const [x, y] of corners) {
        rr(ctx, x - 13, y - 13, 26, 26, 7);
        const g = ctx.createLinearGradient(x - 13, y - 13, x + 13, y + 13);
        g.addColorStop(0, '#F2FDFF');
        g.addColorStop(0.5, '#7CCDEE');
        g.addColorStop(1, '#2F86BF');
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(16,70,120,0.8)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    blit(sprite, cx, baseY, sx, sy) {
      // Sprites are anchored so the block's top-left sits at (PAD, PAD).
      const scaleX = sx === undefined ? 1 : sx;
      const scaleY = sy === undefined ? scaleX : sy;
      const w = sprite.logicalW * scaleX;
      const h = sprite.logicalH * scaleY;
      this.ctx.drawImage(sprite, cx - w / 2, baseY - PAD * scaleY, w, h);
    }

    drawBlock(block, px, py, opts = {}) {
      const ctx = this.ctx;
      const sprite = block.type === 'diamond'
        ? this.diamondSprite
        : this.iceSprites[block.variant % 6];
      const scale = opts.scale === undefined ? 1 : opts.scale;
      if (scale <= 0.01) return;
      const topY = py - CELL / 2 - BLOCK_H;
      const anchorY = py + (topY - py) * scale;
      const shake = block.hatch > 0 ? Math.sin(opts.t * 40) * 1.6 : 0;
      this.blit(sprite, px + shake, anchorY, scale);
      if (opts.eggAlpha > 0 && block.type === 'ice') {
        ctx.globalAlpha = opts.eggAlpha;
        this.blit(this.eggSprite, px, anchorY, scale);
        ctx.globalAlpha = 1;
      }
      if (block.hatch > 0) {
        ctx.globalAlpha = clamp01(1.25 - block.hatch);
        this.blit(this.crackSprite, px + shake, anchorY, scale);
        ctx.globalAlpha = Math.min(1, 0.55 + Math.sin(opts.t * 22) * 0.45);
        this.blit(this.eggSprite, px + shake, anchorY, scale);
        ctx.globalAlpha = 1;
      }
      if (block.type === 'diamond' && !this.reduced) {
        const phase = (opts.t * 0.8 + block.id * 0.37) % 2.4;
        if (phase < 0.5) {
          const a = Math.sin((phase / 0.5) * Math.PI);
          this.star(ctx, px + 9, anchorY + 9, 8 * a, `rgba(255,255,255,${a})`);
        }
      }
    }

    renderGame(game, t) {
      const ctx = this.ctx;
      ctx.setTransform(this.S, 0, 0, this.S, 0, 0);
      if (this.screenShake > 0) {
        ctx.translate(
          (Math.random() - 0.5) * this.screenShake,
          (Math.random() - 0.5) * this.screenShake
        );
      }
      this.drawFieldBackdrop(t);
      this.drawWalls(t, ['up', 'left', 'right']);

      // Soft contact shadows live on the lake, under everything
      const items = [];
      const intro = game.phase === 'intro' ? game.phaseT : 99;
      const eggFlash = game.phase === 'intro' && intro > 0.9
        ? 0.62 + 0.38 * Math.sin((intro - 0.9) * 13)
        : 0;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const b = game.grid[y][x];
          if (!b) continue;
          const appear = clamp01((intro * 2.4 - (x + y) * 0.055));
          const scale = intro < 99 ? easeOutBack(appear) : 1;
          const px = this.cellX(x);
          const py = this.cellY(y);
          ctx.globalAlpha = clamp01(scale);
          ctx.drawImage(this.shadowSprite, px - 32 + 3, py - 32 + 7, 64, 64);
          ctx.globalAlpha = 1;
          items.push({
            depth: y,
            draw: () => this.drawBlock(b, px, py, {
              t, scale: Math.max(0, scale), eggAlpha: b.egg ? eggFlash : 0,
            }),
          });
        }
      }
      for (const s of game.sliders) {
        const px = this.cellX(s.x);
        const py = this.cellY(s.y);
        ctx.drawImage(this.shadowSprite, px - 32 + 3, py - 32 + 7, 64, 64);
        // Spray trail behind the moving block
        if (!this.reduced && Math.random() < 0.8) {
          this.spray(px - s.dx * 22, py + 18 - s.dy * 22, 1, {
            colors: ['#FFFFFF', '#CFF4FF'], kind: 'dust', size: 3, speed: 40, life: 0.45,
          });
        }
        items.push({
          depth: s.y,
          draw: () => {
            // Ghost frames sell the speed without any blur filter
            ctx.globalAlpha = 0.22;
            this.drawBlock(s.block, px - s.dx * 20, py - s.dy * 20, { t });
            ctx.globalAlpha = 1;
            this.drawBlock(s.block, px, py, { t });
          },
        });
      }
      for (const b of game.bees) {
        const px = this.cellX(b.x);
        const py = this.cellY(b.y);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const glowSize = b.state === 'stun' ? 54 : 104;
        ctx.globalAlpha = b.state === 'stun' ? 0.25 : 0.75;
        ctx.drawImage(this.emberGlow, px - glowSize / 2, py - glowSize / 2 - 4, glowSize, glowSize);
        ctx.restore();
        ctx.globalAlpha = 0.8;
        ctx.drawImage(this.shadowSprite, px - 24, py - 22, 48, 48);
        ctx.globalAlpha = 1;
        items.push({ depth: b.y, draw: () => this.drawBee(ctx, px, py - CHAR_LIFT, b, t) });
      }
      if (game.phase !== 'gameover') {
        const p = game.player;
        const px = this.cellX(p.x);
        const py = this.cellY(p.y);
        const blink = p.inv > 0 && Math.floor(t * 12) % 2 === 0;
        ctx.globalAlpha = 0.8;
        ctx.drawImage(this.shadowSprite, px - 24, py - 22, 48, 48);
        ctx.globalAlpha = 1;
        items.push({
          depth: p.y,
          draw: () => {
            if (blink) ctx.globalAlpha = 0.35;
            this.drawPlayer(game, p, px, py, t);
            ctx.globalAlpha = 1;
          },
        });
      }
      items.sort((a, b) => a.depth - b.depth);
      for (const it of items) it.draw();

      this.drawWalls(t, ['down']);
      this.wallPosts();
      this.drawParticles();
      this.drawSnow();
      if (this.flash > 0) {
        ctx.fillStyle = `rgba(255,240,180,${this.flash * 0.4})`;
        ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);
      }
      this.drawPopups();
      this.drawHud(game, t);
      this.drawGameMessages(game, t);
    }

    drawPlayer(game, p, px, py, t) {
      const y = py - CHAR_LIFT;
      if (game.phase === 'dying') {
        const k = clamp01(game.phaseT / 0.8);
        this.drawPengo(this.ctx, px, y, 'down', {
          t, dead: true, spin: k * Math.PI * 4 * (this.reduced ? 0 : 1), flat: 1 - k * 0.55,
        });
        for (let i = 0; i < 4; i++) {
          const a = t * 5 + (i * Math.PI) / 2;
          this.star(this.ctx, px + Math.cos(a) * 20, y - 26 + Math.sin(a) * 6, 4, C.gold);
        }
        return;
      }
      if (game.phase === 'clear') {
        const hop = Math.abs(Math.sin(t * 7)) * 11;
        const dance = ['down', 'right', 'down', 'left'][Math.floor(t * 3.5) % 4];
        this.drawPengo(this.ctx, px, y - hop, dance, { t, cheer: true });
        return;
      }
      this.drawPengo(this.ctx, px, y, p.dir, {
        t, walk: p.walk, moving: p.moving, push: p.pushT > 0,
      });
    }

    drawParticles() {
      const ctx = this.ctx;
      for (const p of this.particles) {
        const k = 1 - p.life / p.max;
        ctx.globalAlpha = Math.min(1, k * 1.6);
        const y = p.y - p.z * 0.35;
        if (p.kind === 'dust') {
          ellipse(ctx, p.x, y, p.size * (1.6 - k), p.size * (1.6 - k), p.color);
        } else if (p.kind === 'star') {
          this.star(ctx, p.x, y, p.size * k + 1, p.color);
        } else {
          ctx.save();
          ctx.translate(p.x, y);
          ctx.rotate(p.rot);
          ctx.beginPath();
          ctx.moveTo(-p.size, -p.size * 0.5);
          ctx.lineTo(p.size, -p.size * 0.2);
          ctx.lineTo(-p.size * 0.2, p.size * 0.8);
          ctx.closePath();
          ctx.fillStyle = p.color;
          ctx.fill();
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
    }

    drawSnow() {
      if (this.reduced) return;
      const ctx = this.ctx;
      for (const s of this.snow) {
        ctx.globalAlpha = 0.28 + s.s * 0.2;
        ellipse(ctx, s.x, s.y, s.s, s.s, '#EAFBFF');
      }
      ctx.globalAlpha = 1;
    }

    drawPopups() {
      const ctx = this.ctx;
      for (const p of this.popups) {
        const k = p.life / p.max;
        ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
        const rise = easeOutBack(clamp01(k * 2.2)) * 26;
        this.text(p.str, p.x, p.y - rise, p.px, p.color, 'center');
      }
      ctx.globalAlpha = 1;
    }

    drawHud(game) {
      const ctx = this.ctx;
      const hi = Math.max(this.hiScore || 0, game.score);
      this.text('SCORE', FIELD_X, 16, 2, C.aurora);
      this.text(game.score, FIELD_X, 36, 4, C.white);
      this.text('HIGH SCORE', LOGICAL_W / 2, 16, 2, C.aurora, 'center');
      this.text(hi, LOGICAL_W / 2, 36, 4, C.gold, 'center');
      this.text('ROUND', LOGICAL_W - FIELD_X, 16, 2, C.aurora, 'right');
      this.text(game.level, LOGICAL_W - FIELD_X, 36, 4, C.white, 'right');

      // Footer: spare lives on the left, bees left to catch on the right
      const y = LOGICAL_H - 27;
      for (let i = 0; i < Math.min(game.lives - 1, 7); i++) {
        this.drawPengo(ctx, FIELD_X + 12 + i * 34, y + 4, 'down', { scale: 0.62, t: 0 });
      }
      const left = game.remainingBees();
      const fakeBee = { state: 'idle', dir: 'down', id: 1 };
      for (let i = 0; i < Math.min(left, 12); i++) {
        ctx.save();
        ctx.translate(LOGICAL_W - FIELD_X - 12 - i * 26, y);
        ctx.scale(0.48, 0.48);
        this.drawBee(ctx, 0, 0, fakeBee, 0);
        ctx.restore();
      }
    }

    panel(x, y, w, h) {
      const ctx = this.ctx;
      rr(ctx, x, y, w, h, 14);
      ctx.fillStyle = 'rgba(7,28,60,0.86)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(191,240,255,0.8)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    drawGameMessages(game, t) {
      const cx = LOGICAL_W / 2;
      const cy = FIELD_Y + FIELD_H / 2;
      if (this.banner) {
        const k = this.banner.t / this.banner.max;
        this.ctx.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
        // A time bonus can award a life, so stay clear of the round-clear panel.
        const clearPanelLow = game.phase === 'clear' && game.player.y < H / 2;
        const by = clearPanelLow ? cy + 44 : cy + 96;
        this.panel(cx - 170, by, 340, 52);
        this.text(this.banner.text, cx, by + 16, 3, this.banner.color, 'center');
        this.ctx.globalAlpha = 1;
      }
      if (game.phase === 'intro') {
        // Gone before the eggs start flashing: that moment needs a clear view.
        const fade = clamp01((0.95 - game.phaseT) / 0.2);
        if (fade > 0) {
          this.ctx.globalAlpha = fade;
          this.panel(cx - 138, cy - 40, 276, 72);
          this.text('ROUND ' + game.level, cx, cy - 20, 4, C.white, 'center');
          this.ctx.globalAlpha = 1;
        } else {
          this.text('WATCH THE EGGS', cx, LOGICAL_H - 34, 2, C.gold, 'center');
        }
      } else if (game.phase === 'clear') {
        // Sits in whichever half Pengo is not dancing in.
        const py = game.player.y < H / 2 ? FIELD_Y + FIELD_H * 0.74 : FIELD_Y + FIELD_H * 0.26;
        this.panel(cx - 190, py - 66, 380, 132);
        this.text('ROUND CLEAR!', cx, py - 44, 4, C.aurora, 'center');
        this.text('TIME ' + Math.floor(game.time) + ' S', cx, py - 2, 3, C.ice, 'center');
        this.text('TIME BONUS ' + game.lastBonus, cx, py + 28, 3, C.gold, 'center');
      } else if (game.phase === 'gameover') {
        this.panel(cx - 200, cy - 92, 400, 184);
        this.text('GAME OVER', cx, cy - 72, 6, C.white, 'center');
        this.text('SCORE ' + game.score, cx, cy - 14, 3, C.gold, 'center');
        if (this.newRecord) this.text('NEW HIGH SCORE!', cx, cy + 16, 3, C.aurora, 'center');
        if (Math.floor(t * 2) % 2 === 0 || this.reduced) {
          this.text(this.startHint(), cx, cy + 56, 2, C.ice, 'center');
        }
      }
    }

    startHint() {
      return this.touch ? 'TAP: NEW GAME' : 'SPACE: NEW GAME';
    }

    renderPause() {
      const ctx = this.ctx;
      ctx.setTransform(this.S, 0, 0, this.S, 0, 0);
      const cx = LOGICAL_W / 2;
      const cy = FIELD_Y + FIELD_H / 2;
      this.panel(cx - 170, cy - 58, 340, 116);
      this.text('PAUSED', cx, cy - 38, 5, C.white, 'center');
      this.text(this.touch ? 'TAP: RESUME' : 'P: RESUME', cx, cy + 14, 3, C.ice, 'center');
    }

    // ---- title screen ----------------------------------------------------

    // Word is built from real ice blocks that slide in and lock together.
    renderTitle(t, onThunk) {
      const ctx = this.ctx;
      ctx.setTransform(this.S, 0, 0, this.S, 0, 0);
      this.drawFieldBackdrop(t);
      this.drawWalls(t, ['up', 'left', 'right', 'down']);
      this.wallPosts();

      const word = 'PENGO';
      const bs = 20;
      const totalW = word.length * 6 * bs - bs;
      const left = (LOGICAL_W - totalW) / 2;
      const top = FIELD_Y + 34;
      const sprites = this.iceSprites;
      const drawn = [];
      for (let li = 0; li < word.length; li++) {
        const rows = FONT[word[li]];
        const delay = this.reduced ? 0 : li * 0.2;
        const k = this.reduced ? 1 : clamp01((t - delay) / 0.42);
        if (k >= 1 && !this.titleHit[li]) {
          this.titleHit[li] = true;
          if (onThunk) onThunk(li);
          this.spray(left + (li * 6 + 2.5) * bs, top + 7 * bs, 16, {
            colors: ['#FFFFFF', '#CFF4FF'], kind: 'dust', size: 4, speed: 130,
          });
        }
        const fromLeft = li % 2 === 0;
        const start = fromLeft ? -LOGICAL_W : LOGICAL_W;
        const e = 1 - Math.pow(1 - k, 3);
        const off = start * (1 - e);
        for (let r = 0; r < 7; r++) {
          for (let c = 0; c < 5; c++) {
            if (!(rows[r] & (1 << (4 - c)))) continue;
            drawn.push({
              x: left + (li * 6 + c) * bs + off,
              y: top + r * bs,
              variant: (li * 3 + r * 5 + c * 7) % 6,
            });
          }
        }
      }
      drawn.sort((a, b) => a.y - b.y);
      const scale = bs / CELL;
      for (const d of drawn) {
        const sprite = sprites[d.variant];
        ctx.drawImage(
          sprite,
          d.x - PAD * scale, d.y - PAD * scale,
          sprite.logicalW * scale, sprite.logicalH * scale
        );
      }

      const hud = Math.max(this.hiScore || 0, 0);
      this.text('HIGH SCORE', LOGICAL_W / 2, 16, 2, C.aurora, 'center');
      this.text(hud, LOGICAL_W / 2, 36, 4, C.gold, 'center');

      const fade = this.reduced ? 1 : clamp01((t - 1.3) / 0.5);
      if (fade > 0) {
        ctx.globalAlpha = fade;
        this.drawLegend(t);
        ctx.globalAlpha = 1;
      }
      this.drawParticles();
      this.drawSnow();
    }

    drawLegend(t) {
      const ctx = this.ctx;
      const col = FIELD_X + 60;
      const textX = col + 52;
      const pointsX = LOGICAL_W - FIELD_X - 34;
      let y = FIELD_Y + 232;
      const gap = 74;

      const beeDemo = { state: 'walk', dir: 'right', id: 3 };
      this.drawBee(ctx, col, y + 12, beeDemo, t);
      this.text('PUSH A BLOCK INTO', textX, y - 6, 3, C.white);
      this.text('A SNO-BEE', textX, y + 20, 3, C.white);
      this.text('400-6400', pointsX, y + 20, 3, C.gold, 'right');
      y += gap;

      this.blit(this.diamondSprite, col, y - 12, 0.92);
      this.text('LINE UP THREE', textX, y - 6, 3, C.white);
      this.text('DIAMONDS', textX, y + 20, 3, C.white);
      this.text('10000', pointsX, y + 20, 3, C.gold, 'right');
      y += gap;

      this.blit(this.iceSprites[2], col, y - 12, 0.92);
      this.blit(this.eggSprite, col, y - 12, 0.92);
      this.text('BREAK AN EGG BEFORE', textX, y - 6, 3, C.white);
      this.text('IT HATCHES', textX, y + 20, 3, C.white);
      this.text('500', pointsX, y + 20, 3, C.gold, 'right');
      y += gap;

      this.drawBee(ctx, col, y + 12, { state: 'stun', dir: 'down', id: 4 }, t);
      this.text('SHAKE A WALL, THEN', textX, y - 6, 3, C.white);
      this.text('WALK OVER THE BEE', textX, y + 20, 3, C.white);
      this.text('100', pointsX, y + 20, 3, C.gold, 'right');
      y += gap + 14;

      const cx = LOGICAL_W / 2;
      const walkCycle = t * 1.6;
      this.drawPengo(ctx, cx, y + 16, 'down', {
        t, moving: false, walk: walkCycle, cheer: Math.floor(t * 1.2) % 2 === 0,
      });
      y += 58;
      if (this.touch) {
        this.text('SWIPE: MOVE', cx, y, 3, C.ice, 'center');
        this.text('TAP: PUSH', cx, y + 28, 3, C.ice, 'center');
      } else {
        this.text('ARROWS: MOVE', cx, y, 3, C.ice, 'center');
        this.text('SPACE: PUSH', cx, y + 28, 3, C.ice, 'center');
      }
      if (Math.floor(t * 1.8) % 2 === 0 || this.reduced) {
        this.text(this.touch ? 'TAP: START' : 'SPACE: START', cx, y + 64, 3, C.gold, 'center');
      }
      if (!this.touch) {
        this.text('P: PAUSE   M: SOUND', cx, y + 96, 2, C.aurora, 'center');
      }
    }
  }

  root.PengoRenderer = Renderer;
  root.PengoLayout = { LOGICAL_W, LOGICAL_H };
})(window);
