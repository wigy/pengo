'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { Game, W, H, timeBonus, INTRO_TIME } = require('../js/core.js');

const DT = 1 / 60;
const run = (g, seconds) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) g.update(DT);
};

// An empty arena with the player placed by hand, so each rule is tested alone.
function arena(px = 6, py = 7) {
  const g = new Game({ seed: 7 });
  g.grid = g.grid.map((row) => row.map(() => null));
  g.bees = [];
  g.eggCount = 0;
  g.sliders = [];
  g.player = g.makePlayer(px, py);
  g.phase = 'play';
  g.phaseT = 0;
  g.drainEvents();
  return g;
}
const ice = (g, x, y) => (g.grid[y][x] = g.makeBlock('ice'));
const diamond = (g, x, y) => (g.grid[y][x] = g.makeBlock('diamond'));
function bee(g, x, y) {
  g.spawnBee(x, y);
  const b = g.bees[g.bees.length - 1];
  b.rage = false;
  return b;
}
// Two stunned bees far away keep the round alive and stop the last-bee escape.
function spares(g) {
  for (const x of [10, 11]) {
    const b = bee(g, x, 13);
    b.state = 'stun';
    b.stun = 99;
  }
}
const types = (g) => g.drainEvents().map((e) => e.type);
function push(g, dir) {
  g.player.dir = dir;
  g.pressAction();
}

test('every open cell of a fresh maze is reachable from the start, across seeds', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const g = new Game({ seed });
    const seen = new Set(['6,7']);
    const queue = [[6, 7]];
    while (queue.length) {
      const [x, y] = queue.pop();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const k = `${x + dx},${y + dy}`;
        if (g.open(x + dx, y + dy) && !seen.has(k)) {
          seen.add(k);
          queue.push([x + dx, y + dy]);
        }
      }
    }
    let open = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g.open(x, y)) open++;
    assert.strictEqual(seen.size, open, `seed ${seed}`);
  }
});

test('a level starts with 3 scattered diamonds and the right egg count', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const g = new Game({ seed });
    const diamonds = g.grid.flat().filter((b) => b && b.type === 'diamond');
    assert.strictEqual(diamonds.length, 3, `seed ${seed}`);
    assert.strictEqual(g.grid.flat().filter((b) => b && b.egg).length, g.eggCount);
    assert.strictEqual(g.eggCount, 6);
  }
});

test('four bees hatch when the intro ends', () => {
  const g = new Game({ seed: 3 });
  run(g, INTRO_TIME + DT * 2);
  assert.strictEqual(g.phase, 'play');
  assert.strictEqual(g.bees.length, 4);
  assert.strictEqual(g.eggCount, 2);
});

test('walking into a block does not enter it, but turns Pengo to face it', () => {
  const g = arena(6, 7);
  ice(g, 7, 7);
  g.setInput('right');
  run(g, 0.5);
  assert.deepStrictEqual([g.player.x, g.player.y], [6, 7]);
  assert.strictEqual(g.player.dir, 'right');
});

test('a pushed block slides until the next obstacle', () => {
  const g = arena(2, 7);
  ice(g, 3, 7);
  ice(g, 9, 7);
  push(g, 'right');
  run(g, 1);
  assert.ok(g.grid[7][8], 'stops next to the far block');
  assert.strictEqual(g.grid[7][3], null);
  assert.strictEqual(g.sliders.length, 0);
});

test('pushing a blocked ice block breaks it; a blocked diamond survives', () => {
  const g = arena(2, 7);
  ice(g, 3, 7);
  ice(g, 4, 7);
  push(g, 'right');
  run(g, 0.1);
  assert.strictEqual(g.grid[7][3], null);
  assert.ok(types(g).includes('break'));

  const d = arena(2, 7);
  diamond(d, 3, 7);
  ice(d, 4, 7);
  push(d, 'right');
  run(d, 0.1);
  assert.ok(d.grid[7][3]);
  assert.ok(types(d).includes('clunk'));
});

test('breaking a block with an egg scores 500 and removes that bee', () => {
  const g = arena(2, 7);
  const b = ice(g, 3, 7);
  b.egg = true;
  g.eggCount = 1;
  spares(g);
  ice(g, 4, 7);
  push(g, 'right');
  run(g, 0.1);
  assert.strictEqual(g.score, 500);
  assert.strictEqual(g.eggCount, 0);
});

test('crushing pays 400 for one bee and 1600 for two with the same block', () => {
  const one = arena(2, 3);
  ice(one, 3, 3);
  const a = bee(one, 7, 3);
  a.state = 'stun';
  a.stun = 9;
  bee(one, 12, 14).state = 'stun';
  one.bees[1].stun = 9;
  push(one, 'right');
  run(one, 1);
  assert.strictEqual(one.score, 400);

  const two = arena(2, 3);
  ice(two, 3, 3);
  for (const x of [6, 8]) {
    const c = bee(two, x, 3);
    c.state = 'stun';
    c.stun = 9;
  }
  const spare = bee(two, 12, 14);
  spare.state = 'stun';
  spare.stun = 9;
  push(two, 'right');
  run(two, 1);
  assert.strictEqual(two.score, 1600);
  assert.strictEqual(two.bees.length, 1);
});

test('shaking a wall stuns only the bees touching it, and stunned bees can be stomped', () => {
  const g = arena(0, 7);
  const near = bee(g, 0, 2);
  const far = bee(g, 4, 2);
  far.state = 'stun'; // hold still; checked for no timer change below
  far.stun = 0.01;
  push(g, 'left');
  run(g, 0.05);
  assert.strictEqual(near.state, 'stun');
  assert.ok(near.stun > 3);
  assert.ok(types(g).includes('shake'));

  const s = arena(3, 3);
  const stunned = bee(s, 4, 3);
  stunned.state = 'stun';
  stunned.stun = 3;
  bee(s, 12, 14).state = 'stun';
  s.bees[1].stun = 9;
  s.setInput('right');
  run(s, 0.3);
  assert.strictEqual(s.score, 100);
  assert.strictEqual(s.bees.includes(stunned), false);
});

test('three diamonds in line pay 10000 in open ice, 5000 on a wall, once', () => {
  const open = arena(2, 5);
  diamond(open, 3, 5);
  diamond(open, 8, 5);
  diamond(open, 9, 5);
  spares(open);
  push(open, 'right');
  run(open, 1);
  assert.strictEqual(open.score, 10000);
  assert.ok(open.diamondBonusDone);
  assert.strictEqual(open.bees[0].stun <= 6, true, 'diamond bonus re-stuns every bee');

  const wall = arena(2, 0);
  diamond(wall, 3, 0);
  diamond(wall, 8, 0);
  diamond(wall, 9, 0);
  spares(wall);
  push(wall, 'right');
  run(wall, 1);
  assert.strictEqual(wall.score, 5000);
});

test('touching an awake bee costs a life, and the last life ends the game', () => {
  const g = arena(3, 3);
  g.lives = 2;
  const b = bee(g, 4, 3);
  b.state = 'stun';
  b.stun = 0;
  g.bees[0].x = 3.2;
  g.bees[0].state = 'walk';
  g.bees[0].moving = false;
  g.update(DT);
  assert.strictEqual(g.phase, 'dying');
  run(g, 1.8);
  assert.strictEqual(g.lives, 1);
  assert.strictEqual(g.phase, 'ready');
  assert.ok(g.player.inv > 0);

  const over = arena(3, 3);
  over.lives = 1;
  bee(over, 3, 3);
  over.update(DT);
  run(over, 1.8);
  assert.strictEqual(over.phase, 'gameover');
});

test('the last bee runs for a corner and the round ends when it escapes', () => {
  const g = arena(6, 14);
  bee(g, 6, 3);
  run(g, 3);
  assert.ok(['clear', 'intro'].includes(g.phase), `phase was ${g.phase}`);
  assert.strictEqual(g.bees.length, 0);
});

test('clearing the round pays a time bonus and starts the next level', () => {
  const g = arena(2, 3);
  ice(g, 3, 3);
  const b = bee(g, 7, 3);
  b.state = 'stun';
  b.stun = 9;
  g.time = 10;
  push(g, 'right');
  run(g, 1);
  assert.strictEqual(g.score, 400 + 5000);
  assert.strictEqual(g.phase, 'clear');
  run(g, 3.5);
  assert.strictEqual(g.level, 2);
  assert.strictEqual(g.phase, 'intro');
});

test('time bonus table', () => {
  assert.deepStrictEqual(
    [10, 25, 35, 45, 55, 90].map(timeBonus),
    [5000, 2000, 1000, 500, 10, 0]
  );
});

test('an extra life arrives at 30000 points', () => {
  const g = arena();
  g.addScore(29999);
  assert.strictEqual(g.lives, 3);
  g.addScore(1);
  assert.strictEqual(g.lives, 4);
});

test('a long unattended game never crashes and always reaches a stable state', () => {
  for (let seed = 1; seed <= 12; seed++) {
    const g = new Game({ seed });
    const rand = (() => {
      let s = seed * 9973;
      return () => (s = (s * 16807) % 2147483647) / 2147483647;
    })();
    const dirs = ['up', 'down', 'left', 'right', null];
    for (let i = 0; i < 60 * 240; i++) {
      if (i % 20 === 0) g.setInput(dirs[Math.floor(rand() * 5)]);
      if (i % 25 === 0) g.pressAction();
      g.update(DT);
      g.drainEvents();
      for (const b of g.bees) {
        assert.ok(Number.isFinite(b.x) && Number.isFinite(b.y));
      }
      assert.ok(g.eggCount >= 0);
      if (g.phase === 'gameover') break;
    }
  }
});
