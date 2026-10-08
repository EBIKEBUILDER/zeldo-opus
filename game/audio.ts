// ─────────────────────────────────────────────────────────────────────────────
//  Web Audio synth: every sound is generated from oscillators and noise.
//  Includes a tiny look-ahead music sequencer with three moods.
// ─────────────────────────────────────────────────────────────────────────────
import type { SfxName } from "./types";

type Track = "none" | "over" | "dungeon" | "boss";

const NOTE_BASE: Record<string, number> = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
function freq(note: string): number {
  // "F#5", "Bb3", "A4"
  const m = /^([A-G])([#b]?)(\d)$/.exec(note);
  if (!m) return 0;
  let semi = NOTE_BASE[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
  semi += (parseInt(m[3], 10) - 4) * 12;
  return 440 * Math.pow(2, semi / 12);
}

interface Song {
  bpm: number;
  /** Eighth-note steps. "-" holds, "." rests. */
  lead: string[];
  bass: string[];
  leadWave: OscillatorType;
  bassWave: OscillatorType;
  leadGain: number;
  bassGain: number;
  leadCut: number;
}

const s = (str: string) => str.trim().split(/\s+/);

const SONGS: Record<Exclude<Track, "none">, Song> = {
  // Hearthside theme: a bouncy little D-major walk.
  over: {
    bpm: 112,
    lead: s(`
      D5 - A4 D5 F#5 - E5 D5   E5 - C#5 A4 B4 - A4 -
      G4 - B4 D5 G5 - F#5 E5   F#5 - D5 - A4 - . .
      D5 - A4 D5 F#5 - A5 G5   F#5 - E5 D5 E5 - B4 -
      G4 B4 D5 G5 F#5 D5 E5 C#5  D5 - - - . . . .`),
    bass: s(`
      D3 . A3 . D3 . A3 .   A2 . E3 . A2 . E3 .
      G2 . D3 . G2 . D3 .   D3 . A3 . D3 . F#3 .
      D3 . A3 . D3 . A3 .   A2 . E3 . A2 . E3 .
      G2 . D3 . A2 . E3 .   D3 . A2 . D3 . . .`),
    leadWave: "triangle", bassWave: "sine", leadGain: 0.16, bassGain: 0.2, leadCut: 2600,
  },
  // Barrow Halls: slow A-minor arpeggios dripping in the dark.
  dungeon: {
    bpm: 84,
    lead: s(`
      A4 . C5 . E5 . C5 .   G4 . B4 . E5 . B4 .
      F4 . A4 . C5 . A4 .   E4 . G#4 . B4 . E5 -
      A4 . C5 . E5 . A5 .   G4 . B4 . D5 . G5 .
      F4 . A4 . D5 . F5 .   E5 - D5 - C5 - B4 -`),
    bass: s(`
      A2 - - - - - - -   G2 - - - - - - -
      F2 - - - - - - -   E2 - - - - - - -
      A2 - - - - - - -   G2 - - - - - - -
      D2 - - - - - - -   E2 - - - - - - -`),
    leadWave: "square", bassWave: "triangle", leadGain: 0.05, bassGain: 0.2, leadCut: 1200,
  },
  // King Gloob: a pushy E-minor ostinato.
  boss: {
    bpm: 150,
    lead: s(`
      E5 . E5 G5 . E5 Bb5 A5   E5 . E5 G5 . B5 A5 G5
      E5 . E5 G5 . E5 Bb5 A5   G5 F#5 E5 D5 E5 - . .`),
    bass: s(`
      E2 E3 E2 E3 E2 E3 E2 E3   C2 C3 C2 C3 D2 D3 D2 D3
      E2 E3 E2 E3 E2 E3 E2 E3   C2 C3 D2 D3 E2 E3 E2 .`),
    leadWave: "square", bassWave: "sawtooth", leadGain: 0.06, bassGain: 0.09, leadCut: 1800,
  },
};

class Synth {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  sfxBus: GainNode | null = null;
  musicBus: GainNode | null = null;
  noise: AudioBuffer | null = null;
  muted = false;
  track: Track = "none";
  private step = 0;
  private nextTime = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Must be called from a user gesture. */
  unlock() {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(ctx.destination);
      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = 0.9;
      this.sfxBus.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.55;
      this.musicBus.connect(this.master);
      const len = ctx.sampleRate;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let seed = 1234567;
      for (let i = 0; i < len; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        d[i] = (seed / 0x7fffffff) * 2 - 1;
      }
      this.noise = buf;
      this.timer = setInterval(() => this.schedule(), 60);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.02);
  }

  setTrack(t: Track) {
    if (t === this.track) return;
    this.track = t;
    this.step = 0;
    if (this.ctx) this.nextTime = this.ctx.currentTime + 0.12;
  }

  dispose() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    void this.ctx?.close();
    this.ctx = null;
  }

  // ── Music ──
  private schedule() {
    const ctx = this.ctx;
    if (!ctx || this.track === "none") return;
    const song = SONGS[this.track];
    const stepDur = 60 / song.bpm / 2;
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + 0.25) {
      const i = this.step % song.lead.length;
      this.playStep(song.lead, i, song.leadWave, song.leadGain, song.leadCut, stepDur, this.nextTime, true);
      const j = this.step % song.bass.length;
      this.playStep(song.bass, j, song.bassWave, song.bassGain, 900, stepDur, this.nextTime, false);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  private playStep(seq: string[], i: number, wave: OscillatorType, gain: number, cut: number, stepDur: number, t: number, lead: boolean) {
    const n = seq[i];
    if (n === "-" || n === ".") return;
    let len = 1;
    while (seq[(i + len) % seq.length] === "-" && len < seq.length) len++;
    const f = freq(n);
    if (!f) return;
    const ctx = this.ctx!;
    const dur = len * stepDur;
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.value = f;
    if (lead) {
      // A touch of vibrato on held notes.
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 5.5;
      lg.gain.value = len > 1 ? f * 0.006 : 0;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(t); lfo.stop(t + dur + 0.1);
    }
    const flt = ctx.createBiquadFilter();
    flt.type = "lowpass";
    flt.frequency.value = cut;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.012);
    g.gain.setTargetAtTime(gain * 0.55, t + 0.05, 0.08);
    g.gain.setTargetAtTime(0, t + dur * 0.9, 0.04);
    o.connect(flt).connect(g).connect(this.musicBus!);
    o.start(t);
    o.stop(t + dur + 0.3);
  }

  // ── SFX building blocks ──
  private tone(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, when = 0, cut = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (cut) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = cut;
      node.connect(f);
      node = f;
    }
    node.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private hiss(type: BiquadFilterType, f0: number, f1: number, dur: number, gain: number, when = 0, q = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.noise || !this.sfxBus) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  private notes(list: string[], gap: number, type: OscillatorType, dur: number, gain: number, start = 0) {
    list.forEach((n, i) => {
      const f = freq(n);
      this.tone(type, f, f, dur, gain, start + i * gap);
    });
  }

  /** A gliding oscillator with an LFO wobbling its pitch: gurgles, warbly whistles. */
  private wobble(type: OscillatorType, f0: number, f1: number, dur: number, gain: number, lfoHz: number, depth: number, when = 0, cut = 0) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = lfoHz;
    const lg = ctx.createGain();
    lg.gain.value = depth;
    lfo.connect(lg).connect(o.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.08, dur * 0.3));
    g.gain.setValueAtTime(gain, t + dur * 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = o;
    if (cut) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = cut;
      o.connect(f);
      node = f;
    }
    node.connect(g).connect(this.sfxBus);
    o.start(t); lfo.start(t);
    o.stop(t + dur + 0.05); lfo.stop(t + dur + 0.05);
  }

  play(name: SfxName) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case "swing":
        this.hiss("bandpass", 700, 3200, 0.13, 0.35, 0, 2.5);
        this.tone("sine", 300, 600, 0.08, 0.05);
        break;
      case "hit":
        this.tone("square", 260, 90, 0.09, 0.18, 0, 2400);
        this.hiss("highpass", 3000, 1500, 0.06, 0.3);
        break;
      case "bossHit":
        this.tone("square", 180, 60, 0.16, 0.22, 0, 1600);
        this.tone("sine", 90, 40, 0.2, 0.4);
        this.hiss("bandpass", 1800, 600, 0.12, 0.35, 0, 1.5);
        break;
      case "kill":
        this.tone("triangle", 700, 90, 0.28, 0.25);
        this.hiss("lowpass", 2400, 200, 0.3, 0.35);
        this.tone("sine", 1200, 1800, 0.06, 0.08, 0.12);
        break;
      case "rupee":
        this.notes(["E6", "B6"], 0.06, "triangle", 0.12, 0.12);
        this.tone("sine", freq("E7"), freq("E7"), 0.1, 0.03, 0.11);
        break;
      case "heart":
        this.tone("sine", 660, 1320, 0.18, 0.18);
        this.tone("triangle", 990, 1760, 0.18, 0.08, 0.08);
        break;
      case "hurt":
        this.tone("sawtooth", 420, 110, 0.26, 0.2, 0, 1800);
        this.tone("square", 210, 80, 0.2, 0.08, 0.02, 900);
        break;
      case "die":
        this.notes(["A4", "F4", "D4", "A3"], 0.16, "triangle", 0.28, 0.2);
        this.hiss("lowpass", 900, 100, 0.9, 0.12, 0.1);
        break;
      case "key":
        this.notes(["G5", "B5", "D6", "G6"], 0.075, "triangle", 0.3, 0.16);
        this.notes(["D6", "G6"], 0.12, "sine", 0.6, 0.08, 0.32);
        break;
      case "gate":
        this.hiss("lowpass", 500, 90, 1.1, 0.5, 0, 0.7);
        this.tone("square", 70, 40, 0.9, 0.12, 0, 300);
        this.tone("sine", 55, 35, 0.4, 0.4, 0.9);
        break;
      case "seal":
        this.tone("sine", 70, 30, 0.5, 0.6);
        this.tone("square", 190, 170, 0.35, 0.08, 0, 1200);
        this.hiss("bandpass", 1200, 400, 0.35, 0.3, 0, 3);
        break;
      case "chest": {
        // Original fanfare: rising thirds into a held major chord.
        const seq = ["C5", "E5", "G5", "C6"];
        this.notes(seq, 0.11, "square", 0.16, 0.07);
        this.notes(seq, 0.11, "triangle", 0.18, 0.12);
        ["C6", "E6", "G6"].forEach((n) => this.tone("triangle", freq(n), freq(n), 1.5, 0.08, 0.5));
        this.tone("sine", freq("C4"), freq("C4"), 1.5, 0.15, 0.5);
        this.hiss("highpass", 6000, 9000, 1.2, 0.04, 0.5);
        break;
      }
      case "cut":
        this.hiss("highpass", 2500, 5000, 0.08, 0.28);
        this.hiss("bandpass", 1200, 800, 0.1, 0.12, 0.02, 2);
        break;
      case "smash":
        this.hiss("bandpass", 1600, 500, 0.22, 0.45, 0, 1.2);
        this.tone("triangle", 900, 300, 0.07, 0.1);
        this.tone("triangle", 1300, 500, 0.06, 0.08, 0.05);
        this.tone("triangle", 700, 250, 0.06, 0.08, 0.1);
        break;
      case "bossRoar":
        this.tone("sawtooth", 110, 55, 0.9, 0.16, 0, 700);
        this.tone("sawtooth", 116, 58, 0.9, 0.12, 0.02, 700);
        this.hiss("lowpass", 800, 150, 0.8, 0.2);
        break;
      case "lunge":
        this.hiss("bandpass", 300, 1200, 0.3, 0.35, 0, 2);
        this.tone("sawtooth", 90, 160, 0.25, 0.08, 0, 600);
        break;
      case "bossDie":
        this.tone("sawtooth", 300, 40, 1.4, 0.18, 0, 1200);
        this.hiss("lowpass", 3000, 80, 1.5, 0.45);
        this.notes(["E5", "G5", "B5", "E6"], 0.1, "triangle", 0.4, 0.12, 1.0);
        break;
      case "door":
        this.notes(["E4", "C4", "A3"], 0.12, "triangle", 0.2, 0.12);
        this.hiss("lowpass", 600, 200, 0.4, 0.1);
        break;
      case "text":
        this.notes(["A5", "D6"], 0.05, "square", 0.05, 0.05);
        break;
      case "clink":
        this.tone("square", 1800, 1500, 0.06, 0.06, 0, 4000);
        this.tone("triangle", 2400, 2300, 0.12, 0.05, 0.01);
        break;
      case "split":
        this.tone("sine", 300, 900, 0.18, 0.15);
        this.tone("sine", 320, 1000, 0.18, 0.12, 0.12);
        this.hiss("lowpass", 1500, 300, 0.25, 0.2);
        break;
      case "denied":
        this.notes(["E3", "C3"], 0.1, "square", 0.12, 0.08);
        break;
      case "alert":
        // A startled little "bwip!" when a gloob spots you.
        this.tone("square", 520, 1040, 0.07, 0.05, 0, 3000);
        this.tone("triangle", 780, 1560, 0.1, 0.1, 0.04);
        break;
      case "inflate": {
        // The King gulps air: a rising, bubbling gurgle that says "something's coming".
        this.wobble("sawtooth", 70, 260, 0.85, 0.11, 14, 25, 0, 700);
        this.wobble("sine", 140, 520, 0.85, 0.09, 9, 40);
        this.hiss("bandpass", 300, 1400, 0.8, 0.1, 0, 3);
        for (let i = 0; i < 7; i++) {
          const f = 260 + ((i * 137) % 5) * 70 + i * 40;
          this.tone("sine", f, f * 1.6, 0.05, 0.05, i * 0.11);
        }
        break;
      }
      case "spit":
        // Wet "PTOO!" followed by a warbling whistle as the glob falls.
        this.hiss("bandpass", 1400, 400, 0.12, 0.5, 0, 1.5);
        this.tone("sine", 700, 110, 0.16, 0.35);
        this.tone("square", 220, 90, 0.1, 0.06, 0, 1200);
        this.wobble("sine", 1500, 520, 0.95, 0.045, 7, 30, 0.12);
        break;
      case "splat":
        this.tone("sine", 140, 38, 0.3, 0.5);
        this.hiss("lowpass", 2200, 180, 0.32, 0.45);
        this.hiss("bandpass", 500, 1600, 0.12, 0.25, 0.02, 4);
        this.tone("triangle", 420, 160, 0.08, 0.08, 0.05);
        break;
      case "swat":
        // Returned to sender: a bright, rising tennis-racket PING.
        this.tone("square", 1320, 1320, 0.09, 0.07, 0, 5000);
        this.tone("triangle", 1980, 2640, 0.22, 0.12);
        this.tone("sine", 660, 1760, 0.12, 0.1);
        this.hiss("highpass", 4000, 8000, 0.1, 0.18);
        break;
    }
  }
}

export const audio = new Synth();
