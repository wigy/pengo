// Regenerates the README images: the highlight screenshots, plus one example
// maze per round with its thumbnail.
//
//   node scripts/capture-screenshots.mjs [outDir]    (default: docs/screenshots)
//
// Needs Playwright (a local or global install) and ImageMagick. Set CHROME_PATH
// to use an installed browser. Playwright is not a project dependency, because
// the game itself has none.
//
// Rounds are randomly generated in the game. Here each uses a fixed seed, so the
// mazes are repeatable. The highlight scenes are set up by script and drawn by the
// game's own simulation and renderer.
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(process.argv[2] ?? join(root, 'docs/screenshots'));
const roundDir = join(outDir, 'rounds');
const thumbDir = join(roundDir, 'thumbs');
const ROUNDS = 12;
const THUMB_WIDTH = 400;

function loadPlaywright() {
  const require = createRequire(import.meta.url);
  for (const name of ['playwright', 'playwright-core']) {
    try {
      return require(name);
    } catch {
      // Try the next one, then the global install.
    }
  }
  return require(join(execSync('npm root -g', { encoding: 'utf8' }).trim(), 'playwright'));
}

// Runs in the page. A second renderer draws exact frames while the live game,
// whose state is private, stays hidden.
function installStage() {
  document.getElementById('game').style.display = 'none';
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const r = new window.PengoRenderer(canvas);
  r.titleHit = { 0: true, 1: true, 2: true, 3: true, 4: true };
  r.hiScore = 0;
  let clock = 0;

  // Advances simulation and effects together, returning the events that fired.
  const step = (g, seconds) => {
    const fired = [];
    for (let i = 0; i < Math.round(seconds * 60); i++) {
      g.update(1 / 60);
      for (const e of g.drainEvents()) {
        r.handleEvent(e);
        fired.push(e.type);
      }
      r.updateEffects(1 / 60);
      clock += 1 / 60;
    }
    return fired;
  };
  const stepUntil = (g, type) => {
    for (let i = 0; i < 300; i++) if (step(g, 1 / 60).includes(type)) return;
    throw new Error(`event never fired: ${type}`);
  };
  const newRound = (round, seed) => {
    r.particles = [];
    r.popups = [];
    r.flash = 0;
    r.screenShake = 0;
    const g = new window.PengoCore.Game({ seed });
    g.startLevel(round);
    g.drainEvents();
    return g;
  };
  const inPlay = (round, seed) => {
    const g = newRound(round, seed);
    step(g, window.PengoCore.INTRO_TIME + 0.1);
    g.player.inv = 99; // A capture must not end early because a bee caught Pengo.
    return g;
  };
  const draw = (g) => {
    g.player.inv = 0; // Otherwise Pengo can be caught mid-blink, half transparent.
    r.renderGame(g, clock);
  };

  window.stage = {
    title() {
      r.renderTitle(2.4);
    },
    // Eggs at the brightest point of their flash, every block settled.
    round(round) {
      const g = newRound(round, 1000 + round);
      g.phase = 'intro';
      g.phaseT = 0.9 + Math.PI / 2 / 13;
      draw(g);
    },
    crush() {
      const g = inPlay(3, 2003);
      // A row with room to slide: Pengo, a block, then open ice with a bee on it.
      const y = 7;
      for (let x = 0; x < 13; x++) g.grid[y][x] = null;
      g.grid[y][2] = g.makeBlock('ice');
      g.grid[y][10] = g.makeBlock('ice');
      g.bees = g.bees.filter((b) => Math.abs(b.y - y) > 3); // Keep the row readable.
      g.player = g.makePlayer(1, y);
      g.player.inv = 99;
      g.player.dir = 'right';
      g.spawnBee(6, y);
      g.bees[g.bees.length - 1].state = 'stun';
      g.bees[g.bees.length - 1].stun = 9;
      g.pressAction();
      stepUntil(g, 'crush');
      step(g, 0.14);
      draw(g);
    },
    diamonds() {
      const g = inPlay(5, 2005);
      for (const row of g.grid) {
        row.forEach((b) => {
          if (b && b.type === 'diamond') b.type = 'ice';
        });
      }
      const y = 5;
      for (let x = 0; x < 13; x++) g.grid[y][x] = null;
      for (const x of [3, 8, 9]) g.grid[y][x] = g.makeBlock('diamond');
      g.player = g.makePlayer(2, y);
      g.player.inv = 99;
      g.player.dir = 'right';
      g.pressAction();
      stepUntil(g, 'diamonds');
      step(g, 0.55);
      draw(g);
    },
    clear() {
      const g = inPlay(2, 2002);
      g.bees = [];
      g.eggCount = 0;
      for (const row of g.grid) {
        for (const b of row) {
          if (b) {
            b.egg = false;
            b.hatch = 0;
          }
        }
      }
      g.time = 27;
      stepUntil(g, 'clear');
      step(g, 0.5);
      draw(g);
    },
  };
}

const { chromium } = loadPlaywright();
mkdirSync(thumbDir, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
try {
  // Exactly the game's logical size, so one canvas pixel is one image pixel.
  const page = await browser.newPage({ viewport: { width: 672, height: 912 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(pathToFileURL(join(root, 'index.html')).href);
  await page.evaluate(installStage);

  for (const scene of ['title', 'crush', 'diamonds', 'clear']) {
    await page.evaluate((name) => window.stage[name](), scene);
    await page.screenshot({ path: join(outDir, `${scene}.png`) });
    console.log(`${scene}.png`);
  }
  for (let round = 1; round <= ROUNDS; round++) {
    const file = `round-${String(round).padStart(2, '0')}`;
    await page.evaluate((n) => window.stage.round(n), round);
    await page.screenshot({ path: join(roundDir, `${file}.png`) });
    execFileSync('convert', [
      join(roundDir, `${file}.png`), '-resize', `${THUMB_WIDTH}x`, '-strip', '-quality', '85',
      join(thumbDir, `${file}.jpg`),
    ]);
    console.log(`${file}.png`);
  }
  if (errors.length) throw new Error(`page errors: ${errors.join('; ')}`);
} finally {
  await browser.close();
}
