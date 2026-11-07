/**
 * completion-sound.ts -- plays the completion sounds, each synthesized with Web Audio, so there is no file to ship or license.
 *
 * DOM-only and app-agnostic: the desktop's panel window, the web's tab, and
 * Settings' preview all call `playCompletionSound`. Every sound is a
 * recipe: a few oscillators under a gain envelope, a filtered sweep, or a
 * short burst of noise, scheduled on the one shared `AudioContext` and
 * ended well under 1.2 s. The envelopes keep each peak modest and the set
 * at about one loudness, so the softest pick is never drowned by the loudest.
 *
 * A browser keeps a context made outside a press suspended (Safari on iOS
 * runs a context only from a gesture), so a sound asked for while the
 * context is not running is dropped, never queued: a chime that sounded
 * minutes later, on some unrelated press, would say nothing true. The ask
 * tries to resume the context, and the first press anywhere on the page
 * resumes it, so the chimes after that play.
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

/** One sound being scheduled: where it starts, and how far its latest note reaches. */
interface Stage {
  readonly context: AudioContext;
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
  const { context, at } = stage;
  const oscillator = context.createOscillator();
  oscillator.type = wave;
  oscillator.frequency.value = hz;
  const amp = envelope(stage, when, length, gain);
  oscillator.connect(amp).connect(context.destination);
  oscillator.start(at + when);
  oscillator.stop(at + when + length + TAIL);
  reach(stage, when + length + TAIL);
}

function sweep(
  stage: Stage,
  { when, fromHz, toHz, length, gain, wave = "sine", filterHz }: Sweep,
): void {
  const { context, at } = stage;
  const oscillator = context.createOscillator();
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(fromHz, at + when);
  oscillator.frequency.exponentialRampToValueAtTime(toHz, at + when + length);
  const amp = envelope(stage, when, length, gain);
  oscillator.connect(amp);
  if (filterHz === undefined) {
    amp.connect(context.destination);
  } else {
    const filter = context.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = filterHz;
    filter.Q.value = SWEEP_FILTER_Q;
    amp.connect(filter).connect(context.destination);
  }
  oscillator.start(at + when);
  oscillator.stop(at + when + length + TAIL);
  reach(stage, when + length + TAIL);
}

/** White noise fading to nothing, through a bandpass: a key's strike, not a note. */
function burst(stage: Stage, { when, length, gain, filterHz }: Burst): void {
  const { context, at } = stage;
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
  const amp = context.createGain();
  amp.gain.value = gain;
  source.connect(filter).connect(amp).connect(context.destination);
  source.start(at + when);
  reach(stage, when + length);
}

/** A struck bell: the fundamental over two inharmonic partials that die sooner. */
function bell(stage: Stage, when: number, hz: number, length: number, gain: number): void {
  tone(stage, { when, hz, length, gain });
  tone(stage, { when, hz: hz * 2.76, length: length * 0.5, gain: gain * 0.3 });
  tone(stage, { when, hz: hz * 5.4, length: length * 0.25, gain: gain * 0.12 });
}

const RECIPES: Record<CompletionSound, (stage: Stage) => void> = {
  [COMPLETION_SOUND.CHIME]: (stage) => {
    tone(stage, { when: 0, hz: 1318.5, length: 0.45, gain: 0.22 });
    tone(stage, { when: 0.12, hz: 1760, length: 0.6, gain: 0.22 });
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

let shared: AudioContext | undefined;
/** The shared context's time at which the sound now playing ends. */
let busyUntil = 0;

/** Resumes a context a browser kept suspended, on the first press anywhere. */
function resumeOnPress(): void {
  shared?.resume().catch(() => undefined);
}

/** Tries to bring a context that is not running back, now and on the next press anywhere. */
function resumeSoon(context: AudioContext): void {
  context.resume().catch(() => undefined);
  // Adding the same listener twice is one listener, so a run of drops arms one.
  document.addEventListener("pointerdown", resumeOnPress, { capture: true, once: true });
}

/** The one context every sound plays on, made on first use; absent where the platform has no Web Audio. */
function sharedContext(): AudioContext | undefined {
  if (shared?.state === "closed") {
    shared = undefined;
    busyUntil = 0;
  }
  if (shared !== undefined) return shared;
  if (typeof AudioContext === "undefined") return undefined;
  shared = new AudioContext();
  return shared;
}

/**
 * Plays `sound` now, unless one is still sounding: a second call within a
 * sound's length plays nothing, so a burst of finishes is one chime and never
 * a loud stack. A context that is not running, as a browser leaves one made
 * outside a press, plays nothing. Returns nothing and throws nothing.
 */
export function playCompletionSound(sound: CompletionSound): void {
  try {
    const context = sharedContext();
    if (context === undefined || context.currentTime < busyUntil) return;
    if (context.state !== "running") {
      resumeSoon(context);
      return;
    }
    const stage: Stage = { context, at: context.currentTime, end: 0 };
    RECIPES[sound](stage);
    busyUntil = stage.at + stage.end;
  } catch {
    // A sound is never worth an error.
  }
}
