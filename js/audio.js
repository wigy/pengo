// All sound is synthesised at runtime with WebAudio; there are no audio files.
(function (root) {
  'use strict';

  const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12);

  // An original 16-step tune in A minor. Each row is one bar of eighth notes;
  // 0 is a rest.
  const LEAD = [
    [69, 0, 72, 76, 74, 72, 69, 0], [67, 0, 71, 74, 72, 71, 67, 0],
    [65, 0, 69, 72, 71, 69, 65, 69], [64, 68, 71, 76, 74, 71, 68, 64],
    [69, 76, 74, 76, 72, 76, 71, 76], [69, 0, 72, 0, 76, 79, 81, 0],
    [77, 76, 74, 72, 74, 72, 71, 69], [68, 71, 76, 71, 69, 0, 0, 0],
  ];
  const BASS = [45, 43, 41, 40, 45, 45, 38, 40];

  class Audio {
    constructor() {
      this.ctx = null;
      this.muted = false;
      this.musicOn = false;
      this.step = 0;
      this.nextNoteAt = 0;
      this.timer = null;
    }

    // Browsers only allow audio to start from a user gesture.
    unlock() {
      if (!this.ctx) {
        const AC = root.AudioContext || root.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : 0.6;
        const comp = this.ctx.createDynamicsCompressor();
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
        const len = this.ctx.sampleRate;
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const data = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    }

    setMuted(muted) {
      this.muted = muted;
      if (this.master) this.master.gain.value = muted ? 0 : 0.6;
    }

    tone(freq, dur, opts = {}) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + (opts.delay || 0);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = opts.type || 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
      const vol = opts.vol === undefined ? 0.3 : opts.vol;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }

    burst(dur, opts = {}) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime + (opts.delay || 0);
      const src = this.ctx.createBufferSource();
      src.buffer = this.noise;
      const filter = this.ctx.createBiquadFilter();
      filter.type = opts.filter || 'highpass';
      filter.frequency.setValueAtTime(opts.freq || 2000, t);
      if (opts.to) filter.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(opts.vol === undefined ? 0.25 : opts.vol, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      src.start(t, Math.random() * 0.5, dur + 0.05);
    }

    arpeggio(notes, gap, opts = {}) {
      notes.forEach((n, i) => {
        this.tone(NOTE(n), opts.dur || 0.2, Object.assign({}, opts, { delay: i * gap }));
      });
    }

    event(e) {
      switch (e.type) {
        case 'push':
          this.burst(0.28, { filter: 'bandpass', freq: 500, to: 2600, vol: 0.28 });
          break;
        case 'land':
          this.tone(150, 0.12, { to: 70, type: 'sine', vol: 0.5 });
          this.burst(0.05, { freq: 3000, vol: 0.12 });
          break;
        case 'break':
          this.burst(0.25, { freq: 3500, vol: e.by === 'bee' ? 0.12 : 0.25 });
          for (let i = 0; i < 4; i++) {
            this.tone(2200 + Math.random() * 2600, 0.14, {
              delay: i * 0.025, vol: e.by === 'bee' ? 0.04 : 0.08, type: 'sine',
            });
          }
          break;
        case 'clunk':
          this.tone(110, 0.12, { type: 'square', vol: 0.12 });
          break;
        case 'crush':
          this.tone(520, 0.3, { to: 70, type: 'sawtooth', vol: 0.22 });
          this.arpeggio([76, 79, 84].slice(0, Math.min(3, e.count + 1)), 0.07, {
            delay: 0.1, vol: 0.2,
          });
          break;
        case 'eggbreak':
          this.arpeggio([84, 88], 0.06, { vol: 0.16, dur: 0.12 });
          break;
        case 'stomp':
          this.tone(300, 0.14, { to: 900, type: 'square', vol: 0.12 });
          break;
        case 'shake':
          this.tone(90, 0.4, { to: 60, type: 'sawtooth', vol: 0.22 });
          this.burst(0.3, { freq: 5000, vol: 0.08 });
          break;
        case 'hatch':
          this.tone(420, 0.18, { to: 900, type: 'square', vol: 0.06 });
          break;
        case 'flee':
          this.arpeggio([81, 79, 81, 79], 0.08, { vol: 0.1, type: 'square', dur: 0.08 });
          break;
        case 'die':
          this.stopMusic();
          this.arpeggio([76, 72, 69, 65, 62, 57], 0.13, { vol: 0.25, dur: 0.25 });
          break;
        case 'diamonds':
          this.arpeggio([72, 76, 79, 84, 88, 91, 96], 0.09, { vol: 0.25, dur: 0.4, type: 'sine' });
          break;
        case 'clear':
          this.stopMusic();
          this.arpeggio([69, 72, 76, 81, 76, 81, 84], 0.12, { vol: 0.22, dur: 0.28 });
          break;
        case 'life':
          this.arpeggio([76, 81, 88], 0.1, { vol: 0.22, dur: 0.25, type: 'square' });
          break;
        case 'gameover':
          this.arpeggio([57, 56, 55, 52], 0.32, { vol: 0.22, dur: 0.5 });
          break;
        default:
          break;
      }
    }

    titleThunk(i) {
      this.tone(130 + i * 26, 0.14, { to: 70, type: 'sine', vol: 0.4 });
    }

    startMusic() {
      if (!this.ctx || this.musicOn) return;
      this.musicOn = true;
      this.step = 0;
      this.nextNoteAt = this.ctx.currentTime + 0.05;
      this.timer = setInterval(() => this.scheduleMusic(), 60);
    }

    stopMusic() {
      this.musicOn = false;
      clearInterval(this.timer);
    }

    scheduleMusic() {
      const eighth = 0.17;
      while (this.nextNoteAt < this.ctx.currentTime + 0.18) {
        const bar = Math.floor(this.step / 8) % LEAD.length;
        const beat = this.step % 8;
        const delay = Math.max(0, this.nextNoteAt - this.ctx.currentTime);
        const n = LEAD[bar][beat];
        if (n) this.tone(NOTE(n), 0.15, { delay, vol: 0.075, type: 'triangle' });
        if (beat % 2 === 0) {
          const b = BASS[bar] + (beat === 4 ? 12 : 0);
          this.tone(NOTE(b), 0.16, { delay, vol: 0.09, type: 'square' });
        }
        this.nextNoteAt += eighth;
        this.step++;
      }
    }
  }

  root.PengoAudio = Audio;
})(window);
