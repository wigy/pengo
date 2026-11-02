// Wires the simulation, renderer and audio to the browser: loop, input, storage.
(function () {
  'use strict';

  const STEP = 1 / 60;
  const HI_KEY = 'pengo.hiscore';
  const MUTE_KEY = 'pengo.muted';

  const canvas = document.getElementById('game');
  const renderer = new window.PengoRenderer(canvas);
  const audio = new window.PengoAudio();

  const store = {
    get(key) {
      try { return window.localStorage.getItem(key); } catch (e) { return null; }
    },
    set(key, value) {
      try { window.localStorage.setItem(key, value); } catch (e) { /* private mode */ }
    },
  };

  renderer.hiScore = Number(store.get(HI_KEY)) || 0;
  renderer.titleHit = {};
  renderer.touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  audio.setMuted(store.get(MUTE_KEY) === '1');

  let screen = 'title';
  let game = null;
  let paused = false;
  let titleT = 0;
  let clock = 0;
  let last = performance.now();
  let acc = 0;

  function startGame() {
    audio.unlock();
    game = new window.PengoCore.Game();
    renderer.newRecord = false;
    renderer.particles = [];
    renderer.popups = [];
    screen = 'game';
    paused = false;
    held.length = 0;
  }

  function togglePause() {
    if (screen !== 'game' || game.phase === 'gameover') return;
    paused = !paused;
    if (paused) audio.stopMusic();
  }

  function saveHiScore() {
    if (game.score > renderer.hiScore) {
      renderer.hiScore = game.score;
      renderer.newRecord = true;
      store.set(HI_KEY, String(game.score));
    }
  }

  function processEvents() {
    for (const e of game.drainEvents()) {
      renderer.handleEvent(e);
      audio.event(e);
      if (e.type === 'gameover') saveHiScore();
    }
    // Keep the hi-score safe even if the tab is closed mid-game.
    if (game.score > renderer.hiScore && game.phase === 'clear') saveHiScore();
    if (game.phase === 'play' && !paused) audio.startMusic();
  }

  // ---- keyboard ----------------------------------------------------------

  const KEYS = {
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    KeyW: 'up', KeyS: 'down', KeyA: 'left', KeyD: 'right',
  };
  const held = []; // most recent direction key last, so overlapping keys feel right

  function syncInput() {
    if (game) game.setInput(held.length ? held[held.length - 1] : null);
  }

  function pressPrimary() {
    audio.unlock();
    if (screen === 'title') {
      startGame();
    } else if (paused) {
      paused = false;
    } else if (game.phase === 'gameover') {
      if (game.phaseT > 0.8) startGame();
    } else {
      game.pressAction();
    }
  }

  window.addEventListener('keydown', (e) => {
    const dir = KEYS[e.code];
    if (dir) {
      e.preventDefault();
      audio.unlock();
      if (!held.includes(dir)) held.push(dir);
      syncInput();
      return;
    }
    if (e.repeat) return;
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault();
      pressPrimary();
    } else if (e.code === 'KeyP' || e.code === 'Escape') {
      togglePause();
    } else if (e.code === 'KeyM') {
      audio.setMuted(!audio.muted);
      store.set(MUTE_KEY, audio.muted ? '1' : '0');
    }
  });

  window.addEventListener('keyup', (e) => {
    const dir = KEYS[e.code];
    if (!dir) return;
    const i = held.indexOf(dir);
    if (i >= 0) held.splice(i, 1);
    syncInput();
  });

  window.addEventListener('blur', () => {
    held.length = 0;
    syncInput();
    if (screen === 'game' && game.phase !== 'gameover' && !paused) togglePause();
  });

  // ---- touch: drag to walk, quick tap to push ----------------------------

  let touchStart = null;
  let touchMoved = false;

  canvas.addEventListener('pointerdown', (e) => {
    renderer.touch = renderer.touch || e.pointerType === 'touch';
    touchStart = { x: e.clientX, y: e.clientY, at: performance.now() };
    touchMoved = false;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!touchStart) return;
    const dx = e.clientX - touchStart.x;
    const dy = e.clientY - touchStart.y;
    if (Math.hypot(dx, dy) < 18) return;
    touchMoved = true;
    const dir = Math.abs(dx) > Math.abs(dy)
      ? (dx > 0 ? 'right' : 'left')
      : (dy > 0 ? 'down' : 'up');
    if (game) game.setInput(dir);
    // Re-anchor so changing direction mid-drag doesn't need a long swipe back.
    touchStart.x = e.clientX - Math.sign(dx) * 6;
    touchStart.y = e.clientY - Math.sign(dy) * 6;
  });

  function endPointer() {
    if (!touchStart) return;
    if (!touchMoved) pressPrimary();
    else if (game) game.setInput(null);
    touchStart = null;
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', () => {
    touchStart = null;
    if (game) game.setInput(null);
  });

  window.addEventListener('resize', () => renderer.resize());

  // ---- loop --------------------------------------------------------------

  function frame(now) {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    clock += dt;

    if (screen === 'title') {
      titleT += dt;
      renderer.updateEffects(dt);
      renderer.renderTitle(titleT, (i) => audio.titleThunk(i));
    } else if (paused) {
      renderer.renderGame(game, clock);
      renderer.renderPause();
    } else {
      acc += dt;
      while (acc >= STEP) {
        game.update(STEP);
        acc -= STEP;
      }
      processEvents();
      renderer.updateEffects(dt);
      renderer.renderGame(game, clock);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
