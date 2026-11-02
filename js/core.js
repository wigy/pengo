// Pengo: pure game simulation. No DOM, no drawing: everything the player sees
// is derived from this state plus the `events` queue the renderer drains.
(function (root) {
  'use strict';

  const W = 13;
  const H = 15;
  const DIRS = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };
  const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
  const DIR_NAMES = Object.keys(DIRS);

  const PLAYER_SPEED = 4.6;
  const SLIDE_SPEED = 13;
  const FLEE_SPEED = 5.4;
  const MAX_ACTIVE_BEES = 4;
  const INTRO_TIME = 2.6;
  const READY_TIME = 1.0;
  const DEATH_TIME = 1.7;
  const CLEAR_TIME = 3.4;
  const WALL_STUN = 3.5;
  const DIAMOND_STUN = 6;
  const CRUSH_SCORES = [400, 1600, 3200, 6400];
  const EGG_SCORE = 500;
  const STUNNED_SCORE = 100;
  const CORNERS = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]];

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Faster clears pay more, as on the original cabinet.
  function timeBonus(seconds) {
    if (seconds < 20) return 5000;
    if (seconds < 30) return 2000;
    if (seconds < 40) return 1000;
    if (seconds < 50) return 500;
    if (seconds < 60) return 10;
    return 0;
  }

  class Game {
    constructor(opts = {}) {
      this.rng = mulberry32(opts.seed === undefined ? Date.now() : opts.seed);
      this.events = [];
      this.score = 0;
      this.lives = 3;
      this.nextLifeAt = 30000;
      this.level = 0;
      this.input = null;
      this.actionBuf = 0;
      this.nextId = 1;
      this.startLevel(1);
    }

    // ---- setup -----------------------------------------------------------

    startLevel(level) {
      this.level = level;
      this.phase = 'intro';
      this.phaseT = 0;
      this.time = 0;
      this.bees = [];
      this.sliders = [];
      this.eggCount = 0;
      this.hatchCooldown = 0;
      this.shakeCooldown = 0;
      this.diamondBonusDone = false;
      this.lastBonus = 0;
      this.player = this.makePlayer(6, 7);
      this.generateMaze();
      this.placeDiamonds();
      this.placeEggs(Math.min(6 + Math.floor(level / 2), 12));
      this.emit('level', { level });
    }

    makePlayer(x, y) {
      return {
        x, y, tx: x, ty: y, fx: x, fy: y,
        moving: false, dir: 'down', pushT: 0, inv: 0, walk: 0,
      };
    }

    makeBlock(type) {
      return {
        id: this.nextId++, type, egg: false, hatch: 0,
        variant: Math.floor(this.rng() * 6),
      };
    }

    // Depth-first carve on even cells: leaves one connected corridor network,
    // the same shape of maze the arcade game builds at the start of a round.
    generateMaze() {
      this.grid = [];
      for (let y = 0; y < H; y++) {
        const row = [];
        for (let x = 0; x < W; x++) row.push(this.makeBlock('ice'));
        this.grid.push(row);
      }
      const seen = new Set();
      const startX = 2 * Math.floor(this.rng() * 7);
      const startY = 2 * Math.floor(this.rng() * 8);
      const stack = [[startX, startY]];
      seen.add(startX + ',' + startY);
      this.grid[startY][startX] = null;
      while (stack.length) {
        const [cx, cy] = stack[stack.length - 1];
        const options = DIR_NAMES.map((n) => DIRS[n]).filter((d) => {
          const nx = cx + d.x * 2;
          const ny = cy + d.y * 2;
          return this.inBounds(nx, ny) && !seen.has(nx + ',' + ny);
        });
        if (!options.length) {
          stack.pop();
          continue;
        }
        const d = options[Math.floor(this.rng() * options.length)];
        const nx = cx + d.x * 2;
        const ny = cy + d.y * 2;
        this.grid[cy + d.y][cx + d.x] = null;
        this.grid[ny][nx] = null;
        seen.add(nx + ',' + ny);
        stack.push([nx, ny]);
      }
      // Pengo's start cell sits between two even cells, so clearing it stays connected.
      this.grid[7][6] = null;
    }

    iceCells() {
      const cells = [];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const b = this.grid[y][x];
          if (b && b.type === 'ice' && !b.egg) cells.push({ x, y });
        }
      }
      return cells;
    }

    pickRandom(list) {
      return list[Math.floor(this.rng() * list.length)];
    }

    // Diamonds start scattered: never touching a wall and never sharing a line.
    placeDiamonds() {
      const placed = [];
      let guard = 0;
      while (placed.length < 3 && guard++ < 2000) {
        const c = this.pickRandom(this.iceCells());
        if (c.x < 1 || c.x > W - 2 || c.y < 1 || c.y > H - 2) continue;
        if (Math.abs(c.x - 6) + Math.abs(c.y - 7) < 3) continue;
        if (placed.some((p) => p.x === c.x || p.y === c.y)) continue;
        this.grid[c.y][c.x].type = 'diamond';
        placed.push(c);
      }
    }

    placeEggs(count) {
      const candidates = this.iceCells().filter(
        (c) => Math.abs(c.x - 6) + Math.abs(c.y - 7) >= 4
      );
      for (let i = 0; i < count && candidates.length; i++) {
        const idx = Math.floor(this.rng() * candidates.length);
        const c = candidates.splice(idx, 1)[0];
        this.grid[c.y][c.x].egg = true;
        this.eggCount++;
      }
    }

    // ---- small helpers ---------------------------------------------------

    emit(type, data) {
      this.events.push(Object.assign({ type }, data));
    }

    drainEvents() {
      const out = this.events;
      this.events = [];
      return out;
    }

    inBounds(x, y) {
      return x >= 0 && y >= 0 && x < W && y < H;
    }

    open(x, y) {
      return this.inBounds(x, y) && !this.grid[y][x];
    }

    addScore(points) {
      this.score += points;
      while (this.score >= this.nextLifeAt) {
        this.lives++;
        this.nextLifeAt += 50000;
        this.emit('life', {});
      }
    }

    remainingBees() {
      return this.bees.length + this.eggCount;
    }

    setInput(dir) {
      this.input = dir;
    }

    pressAction() {
      this.actionBuf = 0.2;
    }

    // ---- main update -----------------------------------------------------

    update(dt) {
      this.phaseT += dt;
      this.actionBuf = Math.max(0, this.actionBuf - dt);
      this.shakeCooldown = Math.max(0, this.shakeCooldown - dt);

      switch (this.phase) {
        case 'intro':
          if (this.phaseT >= INTRO_TIME) this.beginPlay();
          break;
        case 'play':
          this.time += dt;
          this.updateHatching(dt);
          this.updatePlayer(dt);
          this.updateBees(dt);
          this.updateSliders(dt);
          this.checkPlayerContact();
          this.checkCleared();
          break;
        case 'ready':
          this.updateSliders(dt);
          if (this.phaseT >= READY_TIME) this.setPhase('play');
          break;
        case 'dying':
          this.updateSliders(dt);
          if (this.phaseT >= DEATH_TIME) this.afterDeath();
          break;
        case 'clear':
          this.updateSliders(dt);
          if (this.phaseT >= CLEAR_TIME) this.startLevel(this.level + 1);
          break;
        default:
          break;
      }
    }

    setPhase(phase) {
      this.phase = phase;
      this.phaseT = 0;
    }

    beginPlay() {
      this.setPhase('play');
      const eggs = this.eggBlocks();
      for (let i = 0; i < MAX_ACTIVE_BEES && eggs.length; i++) {
        const idx = Math.floor(this.rng() * eggs.length);
        const c = eggs.splice(idx, 1)[0];
        this.hatchAt(c.x, c.y);
      }
    }

    eggBlocks() {
      const cells = [];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const b = this.grid[y][x];
          if (b && b.egg && !b.hatch) cells.push({ x, y });
        }
      }
      return cells;
    }

    // ---- eggs and hatching -----------------------------------------------

    hatchAt(x, y) {
      this.grid[y][x] = null;
      this.eggCount--;
      this.spawnBee(x, y);
      this.emit('hatch', { x, y });
    }

    spawnBee(x, y) {
      const rageChance = Math.min(0.1 + this.level * 0.06, 0.5);
      this.bees.push({
        id: this.nextId++,
        x, y, tx: x, ty: y,
        moving: false, dir: 'down', state: 'walk',
        stun: 0, eat: 0, eatX: 0, eatY: 0,
        carrier: null,
        rage: this.rng() < rageChance,
        flee: false, born: this.time,
      });
    }

    updateHatching(dt) {
      let hatching = 0;
      const due = [];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const b = this.grid[y][x];
          if (b && b.hatch > 0) {
            hatching++;
            b.hatch -= dt;
            if (b.hatch <= 0) due.push({ x, y });
          }
        }
      }
      for (const c of due) this.hatchAt(c.x, c.y);

      this.hatchCooldown -= dt;
      if (this.hatchCooldown > 0) return;
      if (this.bees.length + hatching - due.length >= MAX_ACTIVE_BEES) return;
      const eggs = this.eggBlocks();
      if (!eggs.length) return;
      const c = this.pickRandom(eggs);
      this.grid[c.y][c.x].hatch = 1.3;
      this.hatchCooldown = 0.8;
      this.emit('crack', { x: c.x, y: c.y });
    }

    // ---- player ----------------------------------------------------------

    updatePlayer(dt) {
      const p = this.player;
      p.inv = Math.max(0, p.inv - dt);
      if (p.pushT > 0) {
        p.pushT -= dt;
        return;
      }
      if (this.actionBuf > 0 && !p.moving) {
        this.actionBuf = 0;
        p.pushT = 0.16;
        this.doPush();
        return;
      }
      // Reversing mid-step turns straight back instead of finishing the cell.
      if (p.moving && this.input === OPPOSITE[p.dir]) {
        const fx = p.fx;
        const fy = p.fy;
        p.fx = p.tx;
        p.fy = p.ty;
        p.tx = fx;
        p.ty = fy;
        p.dir = this.input;
      }
      const before = { x: p.x, y: p.y };
      this.stepEntity(p, PLAYER_SPEED, dt, () => this.choosePlayerMove());
      p.walk += Math.abs(p.x - before.x) + Math.abs(p.y - before.y);
    }

    choosePlayerMove() {
      const p = this.player;
      if (!this.input) return false;
      p.dir = this.input;
      const d = DIRS[p.dir];
      const nx = p.x + d.x;
      const ny = p.y + d.y;
      if (!this.open(nx, ny) || this.sliderNear(nx, ny)) return false;
      p.fx = p.x;
      p.fy = p.y;
      p.tx = nx;
      p.ty = ny;
      p.moving = true;
      return true;
    }

    sliderNear(x, y) {
      return this.sliders.some((s) => {
        const near = Math.abs(s.x - x) + Math.abs(s.y - y) < 1.05;
        return near || (s.tx === x && s.ty === y);
      });
    }

    doPush() {
      const p = this.player;
      const d = DIRS[p.dir];
      const fx = p.x + d.x;
      const fy = p.y + d.y;
      if (!this.inBounds(fx, fy)) {
        this.shakeWall(p.dir);
        return;
      }
      const block = this.grid[fy][fx];
      if (!block) {
        this.emit('whiff', {});
        return;
      }
      const nx = fx + d.x;
      const ny = fy + d.y;
      if (!this.open(nx, ny)) {
        if (block.type === 'diamond') {
          this.emit('clunk', { x: fx, y: fy });
          return;
        }
        this.grid[fy][fx] = null;
        if (block.egg) {
          this.eggCount--;
          this.addScore(EGG_SCORE);
          this.emit('eggbreak', { x: fx, y: fy, score: EGG_SCORE });
        }
        this.emit('break', { x: fx, y: fy, by: 'player' });
        return;
      }
      this.grid[fy][fx] = null;
      this.sliders.push({
        block, x: fx, y: fy, tx: nx, ty: ny, dx: d.x, dy: d.y, carried: [],
      });
      this.emit('push', { x: fx, y: fy, dir: p.dir });
    }

    shakeWall(side) {
      if (this.shakeCooldown > 0) return;
      this.shakeCooldown = 0.35;
      let stunned = 0;
      for (const b of this.bees) {
        if (b.state === 'carried') continue;
        const touching =
          (side === 'left' && b.x < 0.6) ||
          (side === 'right' && b.x > W - 1.6) ||
          (side === 'up' && b.y < 0.6) ||
          (side === 'down' && b.y > H - 1.6);
        if (touching) {
          b.state = 'stun';
          b.stun = WALL_STUN;
          stunned++;
        }
      }
      this.emit('shake', { side, stunned });
    }

    // Shared cell-to-cell movement; `next` picks the following target when idle.
    stepEntity(e, speed, dt, next) {
      let rem = speed * dt;
      for (let guard = 0; guard < 4 && rem > 0; guard++) {
        if (!e.moving && !next()) break;
        const dx = e.tx - e.x;
        const dy = e.ty - e.y;
        const dist = Math.abs(dx) + Math.abs(dy);
        if (dist <= rem) {
          e.x = e.tx;
          e.y = e.ty;
          e.moving = false;
          rem -= dist;
        } else {
          e.x += Math.sign(dx) * rem;
          e.y += Math.sign(dy) * rem;
          rem = 0;
        }
      }
    }

    // ---- sliding blocks --------------------------------------------------

    updateSliders(dt) {
      for (let i = this.sliders.length - 1; i >= 0; i--) {
        const s = this.sliders[i];
        let rem = SLIDE_SPEED * dt;
        let landed = false;
        while (rem > 0 && !landed) {
          const dist = Math.abs(s.tx - s.x) + Math.abs(s.ty - s.y);
          if (dist <= rem) {
            s.x = s.tx;
            s.y = s.ty;
            rem -= dist;
            const nx = s.x + s.dx;
            const ny = s.y + s.dy;
            if (this.slideBlocked(nx, ny)) {
              landed = true;
            } else {
              s.tx = nx;
              s.ty = ny;
            }
          } else {
            s.x += s.dx * rem;
            s.y += s.dy * rem;
            rem = 0;
          }
          this.collectBees(s);
        }
        s.carried.forEach((b, k) => {
          b.x = s.x + s.dx * (0.72 + k * 0.2);
          b.y = s.y + s.dy * (0.72 + k * 0.2);
        });
        if (landed) {
          this.sliders.splice(i, 1);
          this.landSlider(s);
        }
      }
    }

    slideBlocked(x, y) {
      if (!this.open(x, y)) return true;
      const p = this.player;
      const onPlayer = (p.x === x && p.y === y) ||
        (Math.round(p.x) === x && Math.round(p.y) === y) ||
        (p.moving && p.tx === x && p.ty === y);
      return this.phase !== 'dying' && onPlayer;
    }

    collectBees(s) {
      for (const b of this.bees) {
        if (b.state === 'carried') continue;
        const along = (b.x - s.x) * s.dx + (b.y - s.y) * s.dy;
        const across = Math.abs((b.x - s.x) * s.dy) + Math.abs((b.y - s.y) * s.dx);
        if (along > 0 && along <= 0.9 && across < 0.55) {
          b.state = 'carried';
          b.moving = false;
          s.carried.push(b);
          this.emit('scoop', { x: b.x, y: b.y });
        }
      }
    }

    landSlider(s) {
      this.grid[s.y][s.x] = s.block;
      const crushed = s.carried.slice();
      for (const b of this.bees) {
        if (b.state === 'carried' || crushed.includes(b)) continue;
        const heading = b.moving && b.tx === s.x && b.ty === s.y;
        const under = Math.abs(b.x - s.x) + Math.abs(b.y - s.y) < 0.5;
        if (heading || under) crushed.push(b);
      }
      this.emit('land', { x: s.x, y: s.y, type: s.block.type, hit: crushed.length });
      if (crushed.length) {
        const points = CRUSH_SCORES[Math.min(crushed.length, CRUSH_SCORES.length) - 1];
        this.addScore(points);
        this.bees = this.bees.filter((b) => !crushed.includes(b));
        this.emit('crush', {
          x: s.x + s.dx * 0.7, y: s.y + s.dy * 0.7, count: crushed.length, score: points,
        });
      }
      if (s.block.type === 'diamond') this.checkDiamonds();
    }

    // ---- diamonds --------------------------------------------------------

    checkDiamonds() {
      if (this.diamondBonusDone) return;
      const cells = [];
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const b = this.grid[y][x];
          if (b && b.type === 'diamond') cells.push({ x, y });
        }
      }
      if (cells.length !== 3) return;
      const xs = cells.map((c) => c.x).sort((a, b) => a - b);
      const ys = cells.map((c) => c.y).sort((a, b) => a - b);
      const inRow = ys[0] === ys[2] && xs[1] === xs[0] + 1 && xs[2] === xs[1] + 1;
      const inCol = xs[0] === xs[2] && ys[1] === ys[0] + 1 && ys[2] === ys[1] + 1;
      if (!inRow && !inCol) return;
      const touchesWall = cells.some(
        (c) => c.x === 0 || c.x === W - 1 || c.y === 0 || c.y === H - 1
      );
      const bonus = touchesWall ? 5000 : 10000;
      this.diamondBonusDone = true;
      this.addScore(bonus);
      for (const b of this.bees) {
        if (b.state === 'carried') continue;
        b.state = 'stun';
        b.stun = DIAMOND_STUN;
      }
      this.emit('diamonds', { cells, bonus });
    }

    // ---- Sno-Bees --------------------------------------------------------

    beeSpeed(b) {
      if (b.flee) return FLEE_SPEED;
      const base = Math.min(2.4 + this.level * 0.18, 4.0);
      return b.rage ? base + 0.6 : base;
    }

    updateBees(dt) {
      const lastOne = this.bees.length === 1 && this.eggCount === 0;
      for (const b of this.bees.slice()) {
        if (lastOne && !b.flee && b.state !== 'carried') {
          b.flee = true;
          this.emit('flee', { x: b.x, y: b.y });
        }
        if (this.time > 60) b.rage = true;
        switch (b.state) {
          case 'stun':
            b.stun -= dt;
            if (b.stun <= 0) b.state = 'walk';
            break;
          case 'eat':
            b.eat -= dt;
            if (b.eat <= 0) this.finishEating(b);
            break;
          case 'walk':
            this.stepEntity(b, this.beeSpeed(b), dt, () => this.chooseBeeMove(b));
            if (b.flee && !b.moving && this.isCorner(b.x, b.y)) {
              this.bees = this.bees.filter((o) => o !== b);
              this.emit('escape', { x: b.x, y: b.y });
            }
            break;
          default:
            break;
        }
      }
    }

    isCorner(x, y) {
      return CORNERS.some(([cx, cy]) => cx === x && cy === y);
    }

    startMove(b, name) {
      const d = DIRS[name];
      b.dir = name;
      b.tx = b.x + d.x;
      b.ty = b.y + d.y;
      b.moving = true;
      return true;
    }

    startEating(b, name) {
      const d = DIRS[name];
      b.dir = name;
      b.state = 'eat';
      b.eat = b.flee ? 0.3 : 0.6;
      b.eatX = b.x + d.x;
      b.eatY = b.y + d.y;
      this.emit('munch', { x: b.eatX, y: b.eatY });
      return false;
    }

    finishEating(b) {
      b.state = 'walk';
      const block = this.inBounds(b.eatX, b.eatY) ? this.grid[b.eatY][b.eatX] : null;
      if (!block || block.type !== 'ice') return;
      this.grid[b.eatY][b.eatX] = null;
      this.emit('break', { x: b.eatX, y: b.eatY, by: 'bee' });
      if (block.egg) {
        this.eggCount--;
        this.spawnBee(b.eatX, b.eatY);
        this.emit('hatch', { x: b.eatX, y: b.eatY });
      }
    }

    chooseBeeMove(b) {
      if (b.flee) return this.chooseFleeMove(b);
      const p = this.player;
      const isTaken = (x, y) =>
        this.bees.some((o) => o !== b && o.moving && o.tx === x && o.ty === y);
      let options = DIR_NAMES.filter((n) => {
        const d = DIRS[n];
        return this.open(b.x + d.x, b.y + d.y) && !isTaken(b.x + d.x, b.y + d.y);
      });
      const dist = (n) =>
        Math.abs(b.x + DIRS[n].x - p.x) + Math.abs(b.y + DIRS[n].y - p.y);

      // Enraged bees sometimes chew straight through the ice towards Pengo.
      const toPlayer = DIR_NAMES.slice().sort((a, c) => dist(a) - dist(c))[0];
      const fd = DIRS[toPlayer];
      const facing = this.inBounds(b.x + fd.x, b.y + fd.y)
        ? this.grid[b.y + fd.y][b.x + fd.x]
        : null;
      const canChew = facing && facing.type === 'ice';
      if (canChew && (!options.length || (b.rage && this.rng() < 0.35))) {
        return this.startEating(b, toPlayer);
      }

      if (!options.length) {
        const chewable = DIR_NAMES.find((n) => {
          const d = DIRS[n];
          if (!this.inBounds(b.x + d.x, b.y + d.y)) return false;
          const bl = this.grid[b.y + d.y][b.x + d.x];
          return bl && bl.type === 'ice';
        });
        return chewable ? this.startEating(b, chewable) : false;
      }

      if (options.length > 1) {
        options = options.filter((n) => n !== OPPOSITE[b.dir]);
      }
      const aggression = Math.min(0.4 + this.level * 0.05, 0.85);
      const pick = this.rng() < aggression
        ? options.slice().sort((a, c) => dist(a) - dist(c))[0]
        : this.pickRandom(options);
      return this.startMove(b, pick);
    }

    // Last bee standing runs for a corner, chewing ice if it has to.
    chooseFleeMove(b) {
      if (this.isCorner(b.x, b.y)) return false;
      const step = this.fleeStep(b.x, b.y);
      if (!step) {
        const options = DIR_NAMES.filter((n) => this.open(b.x + DIRS[n].x, b.y + DIRS[n].y));
        return options.length ? this.startMove(b, this.pickRandom(options)) : false;
      }
      const d = DIRS[step];
      if (this.open(b.x + d.x, b.y + d.y)) return this.startMove(b, step);
      return this.startEating(b, step);
    }

    // Dijkstra over the grid: ice is walkable but expensive, diamonds are not.
    fleeStep(sx, sy) {
      const key = (x, y) => y * W + x;
      const dist = new Array(W * H).fill(Infinity);
      const first = new Array(W * H).fill(null);
      const done = new Array(W * H).fill(false);
      dist[key(sx, sy)] = 0;
      for (;;) {
        let best = -1;
        for (let i = 0; i < dist.length; i++) {
          if (!done[i] && dist[i] < Infinity && (best < 0 || dist[i] < dist[best])) best = i;
        }
        if (best < 0) return null;
        done[best] = true;
        const x = best % W;
        const y = Math.floor(best / W);
        if (this.isCorner(x, y) && best !== key(sx, sy)) return first[best];
        for (const n of DIR_NAMES) {
          const nx = x + DIRS[n].x;
          const ny = y + DIRS[n].y;
          if (!this.inBounds(nx, ny)) continue;
          const cell = this.grid[ny][nx];
          if (cell && cell.type === 'diamond') continue;
          const cost = dist[best] + (cell ? 4 : 1);
          const k = key(nx, ny);
          if (cost < dist[k]) {
            dist[k] = cost;
            first[k] = first[best] || n;
          }
        }
      }
    }

    // ---- contact, death, clearing ----------------------------------------

    checkPlayerContact() {
      const p = this.player;
      for (const b of this.bees.slice()) {
        if (b.state === 'carried') continue;
        const near = Math.abs(b.x - p.x) + Math.abs(b.y - p.y) < 0.62;
        if (!near) continue;
        if (b.state === 'stun') {
          this.bees = this.bees.filter((o) => o !== b);
          this.addScore(STUNNED_SCORE);
          this.emit('stomp', { x: b.x, y: b.y, score: STUNNED_SCORE });
        } else if (p.inv <= 0) {
          this.setPhase('dying');
          this.emit('die', { x: p.x, y: p.y });
          return;
        }
      }
    }

    afterDeath() {
      this.lives--;
      if (this.lives <= 0) {
        this.setPhase('gameover');
        this.emit('gameover', { score: this.score });
        return;
      }
      const spot = this.findRespawnCell();
      this.player = this.makePlayer(spot.x, spot.y);
      this.player.inv = 2.4;
      for (const b of this.bees) {
        if (b.state === 'carried') continue;
        b.state = 'stun';
        b.stun = 1.6;
      }
      this.setPhase('ready');
      this.emit('respawn', spot);
    }

    findRespawnCell() {
      let best = null;
      let bestScore = -Infinity;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!this.open(x, y)) continue;
          const nearestBee = this.bees.reduce(
            (m, b) => Math.min(m, Math.abs(b.x - x) + Math.abs(b.y - y)), 99
          );
          const fromCenter = Math.abs(x - 6) + Math.abs(y - 7);
          const score = Math.min(nearestBee, 5) * 10 - fromCenter;
          if (score > bestScore) {
            bestScore = score;
            best = { x, y };
          }
        }
      }
      if (best) return best;
      this.grid[7][6] = null;
      return { x: 6, y: 7 };
    }

    checkCleared() {
      if (this.phase !== 'play' || this.remainingBees() > 0) return;
      this.lastBonus = timeBonus(this.time);
      this.addScore(this.lastBonus);
      this.setPhase('clear');
      this.emit('clear', { bonus: this.lastBonus, time: this.time });
    }
  }

  const api = { Game, W, H, DIRS, timeBonus, INTRO_TIME, CLEAR_TIME, DEATH_TIME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PengoCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
