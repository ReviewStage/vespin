/**
 * completion-sound.ts -- plays the completion sounds, each synthesized with Web Audio, so there is no file to ship or license.
 *
 * DOM-only and app-agnostic: the desktop's panel window, the web's tab, and
 * Settings' preview all call `playCompletionSound`. Every sound is a
 * recipe: a few oscillators under a gain envelope, a filtered sweep, or a
 * short burst of noise, scheduled on the one shared `AudioContext` and
 * ended well under 1.2 s. The envelopes keep the set at about one loudness,
 * so the softest pick is never drowned by the loudest. A sine or triangle
 * note is two voices a few cents apart, which warms a bare tone.
 *
 * Every sound leaves through one bus made with the context (`Bus`): a
 * short room, a convolution with decaying noise mixed under the dry sound,
 * then a master level that lifts the set toward a system alert's loudness.
 *
 * A browser keeps a context made outside a press suspended (Safari on iOS
 * runs a context only from a gesture), so a sound asked for while the
 * context is not running is dropped, never queued: a chime that sounded
 * minutes later, on some unrelated press, would say nothing true. The ask
 * tries to resume the context, and the first press anywhere on the page
 * resumes it, so the chimes after that play.
 *
 * One sound sounds at a time. The same sound asked for while it sounds is
 * dropped, so a burst is never a loud stack; another sound cuts the one
 * sounding short and plays, since the news it tells is the newer.
 *
 * A sound never raises an error: where Web Audio is missing or refuses, it
 * is silent.
 */

import { COMPLETION_SOUND, type CompletionSound } from "@repo/wire/app-settings";

/** A gain envelope cannot ramp from or to zero, so it rests here. */
const SILENCE = 0.0001;
/** How long a note takes to reach its peak, which keeps its start from clicking. */
const ATTACK = 0.01;
/** How long an oscillator runs past its envelope's end before it is stopped. */
const TAIL = 0.02;
/** The bandpass Q a filtered sweep is shaped by: wide enough that a sawtooth keeps most of its level through it. */
const SWEEP_FILTER_Q = 1.5;
/** How far apart, in cents, the two voices of a sine or triangle note sit. */
const DETUNE_CENTS = 4;
/** How long the room rings, in seconds. */
const ROOM_LENGTH = 0.7;
/** How steeply the room's ring dies away: higher is a smaller room. */
const ROOM_DECAY = 3.2;
/** How much of the room is mixed under the dry sound. */
const ROOM_MIX = 0.22;
/**
 * The bus's lift, about 5.5 dB, which brings the set closer to a system
 * alert's loudness while the loudest recipe's peak, Pop's, stays about 1 dB
 * under clipping. Note that there is no limiter behind it, because a
 * browser's compressor pulls a short sound down by several decibels more
 * than a long one and would undo the set's even loudness.
 */
const MASTER_LEVEL = 1.9;
/** How long a sound cut short takes to fade, which keeps the cut from clicking. */
const CUT = 0.03;

/** One sound being scheduled: where it starts, where it plays into, and how far its latest note reaches. */
interface Stage {
  readonly context: AudioContext;
  /** The sound's own gain, into the bus, which cutting it short fades. */
  readonly out: GainNode;
  readonly at: number;
  /** Seconds from `at` to the end of the last note, which is how long the sound occupies the speakers. */
  end: number;
}

interface Tone {
  /** Seconds after the sound's start. */
  when: number;
  hz: number;
  /** Seconds from the note's start to silence. */
  length: number;
  gain: number;
  wave?: OscillatorType;
}

interface Sweep {
  when: number;
  fromHz: number;
  toHz: number;
  length: number;
  gain: number;
  wave?: OscillatorType;
  /** A bandpass centered here, which turns a raw wave into a voice. */
  filterHz?: number;
}

interface Burst {
  when: number;
  length: number;
  gain: number;
  /** The bandpass's center: low is a thud, high is a tick. */
  filterHz: number;
  /** The bandpass's Q: higher rings more like a struck body. */
  q?: number;
}

/** A gain node that swells to `gain` and dies away over `length`. */
function envelope(stage: Stage, when: number, length: number, gain: number): GainNode {
  const { context, at } = stage;
  const amp = context.createGain();
  amp.gain.setValueAtTime(SILENCE, at + when);
  amp.gain.exponentialRampToValueAtTime(gain, at + when + ATTACK);
  amp.gain.exponentialRampToValueAtTime(SILENCE, at + when + length);
  return amp;
}

function reach(stage: Stage, until: number): void {
  stage.end = Math.max(stage.end, until);
}

function tone(stage: Stage, { when, hz, length, gain, wave = "sine" }: Tone): void {
  const { context, at, out } = stage;
  // Note that a square wave keeps one voice, because two beating squares sound broken rather than warm.
  const detunes = wave === "sine" || wave === "triangle" ? [-DETUNE_CENTS, DETUNE_CENTS] : [0];
  const amp = envelope(stage, when, length, gain / detunes.length);
  amp.connect(out);
  for (const cents of detunes) {
    const oscillator = context.createOscillator();
    oscillator.type = wave;
    oscillator.frequency.value = hz;
    oscillator.detune.value = cents;
    oscillator.connect(amp);
    oscillator.start(at + when);
    oscillator.stop(at + when + length + TAIL);
  }
  reach(stage, when + length + TAIL);
}

function sweep(
  stage: Stage,
  { when, fromHz, toHz, length, gain, wave = "sine", filterHz }: Sweep,
): void {
  const { context, at, out } = stage;
  const oscillator = context.createOscillator();
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(fromHz, at + when);
  oscillator.frequency.exponentialRampToValueAtTime(toHz, at + when + length);
  const amp = envelope(stage, when, length, gain);
  oscillator.connect(amp);
  if (filterHz === undefined) {
    amp.connect(out);
  } else {
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = filterHz;
    filter.Q.value = SWEEP_FILTER_Q;
    amp.connect(filter).connect(out);
  }
  oscillator.start(at + when);
  oscillator.stop(at + when + length + TAIL);
  reach(stage, when + length + TAIL);
}

/** White noise fading to nothing, through a bandpass: a key's strike, not a note. */
function burst(stage: Stage, { when, length, gain, filterHz, q }: Burst): void {
  const { context, at, out } = stage;
  const frames = Math.floor(context.sampleRate * length);
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const samples = buffer.getChannelData(0);
  for (let frame = 0; frame < frames; frame++) {
    samples[frame] = (Math.random() * 2 - 1) * (1 - frame / frames);
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = filterHz;
  if (q !== undefined) filter.Q.value = q;
  const amp = context.createGain();
  amp.gain.value = gain;
  source.connect(filter).connect(amp).connect(out);
  source.start(at + when);
  reach(stage, when + length);
}

/** A struck bell: the fundamental over two inharmonic partials that die sooner. */
function bell(stage: Stage, when: number, hz: number, length: number, gain: number): void {
  tone(stage, { when, hz, length, gain });
  tone(stage, { when, hz: hz * 2.76, length: length * 0.5, gain: gain * 0.3 });
  tone(stage, { when, hz: hz * 5.4, length: length * 0.25, gain: gain * 0.12 });
}

/** A knuckle on wood: a sharp tick of noise over a low thud that drops in pitch. */
function knock(stage: Stage, when: number): void {
  burst(stage, { when, length: 0.06, gain: 1.1, filterHz: 900, q: 3 });
  sweep(stage, { when, fromHz: 220, toHz: 140, length: 0.12, gain: 0.3 });
}

const RECIPES: Record<CompletionSound, (stage: Stage) => void> = {
  [COMPLETION_SOUND.CHIME]: (stage) => {
    tone(stage, { when: 0, hz: 1318.5, length: 0.45, gain: 0.22 });
    tone(stage, { when: 0.12, hz: 1760, length: 0.6, gain: 0.22 });
  },
  [COMPLETION_SOUND.DONE]: (stage) => {
    // A rising major third that settles: finished, nothing asked.
    tone(stage, { when: 0, hz: 784, length: 0.5, gain: 0.24 });
    tone(stage, { when: 0.11, hz: 987.8, length: 0.8, gain: 0.24 });
  },
  [COMPLETION_SOUND.KNOCK]: (stage) => {
    // No pitch at all, so it is never mistaken for a finish.
    knock(stage, 0);
    knock(stage, 0.16);
  },
  [COMPLETION_SOUND.QUESTION]: (stage) => {
    // Three rising notes that stop short of home, as a question does.
    tone(stage, { when: 0, hz: 659.3, length: 0.18, gain: 0.28, wave: "triangle" });
    tone(stage, { when: 0.12, hz: 880, length: 0.18, gain: 0.28, wave: "triangle" });
    tone(stage, { when: 0.24, hz: 1108.7, length: 0.5, gain: 0.28, wave: "triangle" });
  },
  [COMPLETION_SOUND.PING]: (stage) => {
    tone(stage, { when: 0, hz: 1568, length: 0.35, gain: 0.34, wave: "triangle" });
  },
  [COMPLETION_SOUND.MARIMBA]: (stage) => {
    tone(stage, { when: 0, hz: 880, length: 0.4, gain: 0.3 });
    tone(stage, { when: 0, hz: 3520, length: 0.12, gain: 0.06 });
    tone(stage, { when: 0.1, hz: 1174.7, length: 0.4, gain: 0.25 });
  },
  [COMPLETION_SOUND.POP]: (stage) => {
    sweep(stage, { when: 0, fromHz: 600, toHz: 1400, length: 0.12, gain: 0.45 });
  },
  [COMPLETION_SOUND.BELL]: (stage) => {
    bell(stage, 0, 880, 1.1, 0.22);
  },
  [COMPLETION_SOUND.GLASS]: (stage) => {
    tone(stage, { when: 0, hz: 2093, length: 0.8, gain: 0.18 });
    tone(stage, { when: 0, hz: 4186, length: 0.3, gain: 0.06 });
    tone(stage, { when: 0.09, hz: 2637, length: 0.7, gain: 0.14 });
  },
  [COMPLETION_SOUND.DROPLET]: (stage) => {
    sweep(stage, { when: 0, fromHz: 900, toHz: 2200, length: 0.14, gain: 0.42 });
    sweep(stage, { when: 0.16, fromHz: 1100, toHz: 2600, length: 0.1, gain: 0.21 });
  },
  [COMPLETION_SOUND.SOFT]: (stage) => {
    tone(stage, { when: 0, hz: 523.3, length: 0.7, gain: 0.26 });
    tone(stage, { when: 0.18, hz: 659.3, length: 0.9, gain: 0.23 });
  },
  [COMPLETION_SOUND.DOORBELL]: (stage) => {
    bell(stage, 0, 659.3, 0.9, 0.25);
    bell(stage, 0.4, 523.3, 0.75, 0.25);
  },
  [COMPLETION_SOUND.COIN]: (stage) => {
    tone(stage, { when: 0, hz: 987.8, length: 0.08, gain: 0.2, wave: "square" });
    tone(stage, { when: 0.08, hz: 1318.5, length: 0.4, gain: 0.2, wave: "square" });
  },
  [COMPLETION_SOUND.LEVEL_UP]: (stage) => {
    const steps = [523.3, 659.3, 784, 1046.5];
    steps.forEach((hz, step) => {
      const last = step === steps.length - 1;
      tone(stage, { when: step * 0.08, hz, length: last ? 0.4 : 0.1, gain: 0.21, wave: "square" });
    });
  },
  [COMPLETION_SOUND.TRAIN_HORN]: (stage) => {
    // A minor chord's three voices, each sagging a little as the horn dies.
    for (const hz of [311.1, 392, 466.2]) {
      sweep(stage, {
        when: 0,
        fromHz: hz,
        toHz: hz * 0.98,
        length: 0.9,
        gain: 0.32,
        wave: "sawtooth",
        filterHz: 900,
      });
    }
  },
  [COMPLETION_SOUND.QUACK]: (stage) => {
    sweep(stage, {
      when: 0,
      fromHz: 520,
      toHz: 330,
      length: 0.16,
      gain: 0.6,
      wave: "sawtooth",
      filterHz: 1100,
    });
    sweep(stage, {
      when: 0.22,
      fromHz: 500,
      toHz: 310,
      length: 0.18,
      gain: 0.6,
      wave: "sawtooth",
      filterHz: 1100,
    });
  },
  [COMPLETION_SOUND.TYPEWRITER]: (stage) => {
    burst(stage, { when: 0, length: 0.03, gain: 0.5, filterHz: 2500 });
    burst(stage, { when: 0.09, length: 0.03, gain: 0.5, filterHz: 2500 });
    bell(stage, 0.2, 2637, 0.6, 0.19);
  },
};

/** The one context every sound plays on, and the bus every sound leaves through. */
interface Player {
  readonly context: AudioContext;
  readonly bus: AudioNode;
}

/** The sound sounding now: which, its own gain, and the context's time at which it ends. */
interface Sounding {
  readonly sound: CompletionSound;
  readonly out: GainNode;
  readonly until: number;
}

let shared: Player | undefined;
let sounding: Sounding | undefined;

/** A small room's ring: two channels of noise dying away, which a convolver turns into a room around the sound. */
function roomOf(context: AudioContext): ConvolverNode {
  const frames = Math.floor(context.sampleRate * ROOM_LENGTH);
  const ring = context.createBuffer(2, frames, context.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const samples = ring.getChannelData(channel);
    for (let frame = 0; frame < frames; frame++) {
      samples[frame] = (Math.random() * 2 - 1) * (1 - frame / frames) ** ROOM_DECAY;
    }
  }
  const room = context.createConvolver();
  room.buffer = ring;
  return room;
}

/** The bus: the dry sound and its room, lifted by the master level, out to the speakers. */
function busOf(context: AudioContext): AudioNode {
  const input = context.createGain();
  const master = context.createGain();
  master.gain.value = MASTER_LEVEL;
  const wet = context.createGain();
  wet.gain.value = ROOM_MIX;
  input.connect(master);
  input.connect(roomOf(context)).connect(wet).connect(master);
  master.connect(context.destination);
  return input;
}

/** Resumes a context a browser kept suspended, on the first press anywhere. */
function resumeOnPress(): void {
  shared?.context.resume().catch(() => undefined);
}

/** Tries to bring a context that is not running back, now and on the next press anywhere. */
function resumeSoon(context: AudioContext): void {
  context.resume().catch(() => undefined);
  // Adding the same listener twice is one listener, so a run of drops arms one.
  document.addEventListener("pointerdown", resumeOnPress, { capture: true, once: true });
}

/** The one player every sound plays on, made on first use; absent where the platform has no Web Audio. */
function sharedPlayer(): Player | undefined {
  if (shared?.context.state === "closed") {
    shared = undefined;
    sounding = undefined;
  }
  if (shared !== undefined) return shared;
  if (typeof AudioContext === "undefined") return undefined;
  const context = new AudioContext();
  shared = { context, bus: busOf(context) };
  return shared;
}

/** Fades the sound sounding now to nothing, so the next one plays alone. */
function cut(context: AudioContext, { out }: Sounding): void {
  out.gain.setValueAtTime(out.gain.value, context.currentTime);
  out.gain.linearRampToValueAtTime(0, context.currentTime + CUT);
}

/**
 * Plays `sound` now. The same sound asked for while it still sounds plays
 * nothing, so a burst of finishes is one chime and never a loud stack;
 * another sound cuts it short and plays. A context that is not running, as
 * a browser leaves one made outside a press, plays nothing. Returns nothing
 * and throws nothing.
 */
export function playCompletionSound(sound: CompletionSound): void {
  try {
    const player = sharedPlayer();
    if (player === undefined) return;
    const { context, bus } = player;
    const now = context.currentTime;
    const still = sounding !== undefined && now < sounding.until ? sounding : undefined;
    if (still?.sound === sound) return;
    if (context.state !== "running") {
      resumeSoon(context);
      return;
    }
    if (still !== undefined) cut(context, still);
    const out = context.createGain();
    out.connect(bus);
    const stage: Stage = { context, out, at: now, end: 0 };
    RECIPES[sound](stage);
    sounding = { sound, out, until: stage.at + stage.end };
  } catch {
    // A sound is never worth an error.
  }
}
