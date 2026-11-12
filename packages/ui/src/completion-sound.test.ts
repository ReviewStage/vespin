import { COMPLETION_SOUND } from "@repo/wire/app-settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Clock = { now: number };

/** What reached the speakers: the start time of every oscillator and noise burst the fake context was told to play. */
let started: number[];
let clock: Clock;
let oscillatorsRefused: boolean;
let contextState: string;

class StandInParam {
  value = 0;
  setValueAtTime(): void {}
  exponentialRampToValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
}

class StandInNode {
  readonly gain = new StandInParam();
  readonly frequency = new StandInParam();
  readonly Q = new StandInParam();
  readonly detune = new StandInParam();
  type = "";
  buffer: unknown;
  connect<Next>(next: Next): Next {
    return next;
  }
  start(when: number): void {
    started.push(when);
  }
  stop(): void {}
  getChannelData(): Float32Array {
    return new Float32Array(1);
  }
}

class StandInAudioContext {
  get state(): string {
    return contextState;
  }
  resume = (): Promise<void> => Promise.resolve();
  readonly sampleRate = 8000;
  readonly destination = new StandInNode();
  get currentTime(): number {
    return clock.now;
  }
  createOscillator(): StandInNode {
    if (oscillatorsRefused) throw new Error("The audio device is gone.");

    return new StandInNode();
  }
  createGain = (): StandInNode => new StandInNode();
  createBiquadFilter = (): StandInNode => new StandInNode();
  createBuffer = (): StandInNode => new StandInNode();
  createBufferSource = (): StandInNode => new StandInNode();
  createConvolver = (): StandInNode => new StandInNode();
  /** Decodes any bytes that open with a byte of one, as a clip a second long; refuses every other. */
  decodeAudioData = (data: ArrayBuffer): Promise<{ duration: number }> =>
    new Uint8Array(data)[0] === 1
      ? Promise.resolve({ duration: 1 })
      : Promise.reject(new Error("Unable to decode audio data"));
}

/** A fresh player module, since its one audio context, its busy mark, and its clip live as long as the module. */
async function freshModule(): Promise<typeof import("./completion-sound.js")> {
  vi.resetModules();

  return await import("./completion-sound.js");
}

/** A fresh player. */
async function freshPlayer(): Promise<
  typeof import("./completion-sound.js")["playCompletionSound"]
> {
  return (await freshModule()).playCompletionSound;
}

describe("playCompletionSound", () => {
  beforeEach(() => {
    started = [];
    clock = { now: 10 };
    oscillatorsRefused = false;
    contextState = "running";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("plays nothing for the sound still sounding, but cuts in with another, and plays again once it has ended", async () => {
    vi.stubGlobal("AudioContext", StandInAudioContext);
    const play = await freshPlayer();

    play(COMPLETION_SOUND.CHIME);
    const first = started.length;
    expect(first).toBeGreaterThan(0);

    clock.now += 0.1;
    play(COMPLETION_SOUND.CHIME);
    expect(started).toHaveLength(first);

    clock.now += 0.1;
    play(COMPLETION_SOUND.KNOCK);
    const cutIn = started.length;
    expect(cutIn).toBeGreaterThan(first);

    clock.now += 2;
    play(COMPLETION_SOUND.KNOCK);
    expect(started.length).toBeGreaterThan(cutIn);
  });

  it("drops a sound asked for while the context is suspended rather than queueing it", async () => {
    vi.stubGlobal("AudioContext", StandInAudioContext);
    vi.stubGlobal("document", { addEventListener: () => undefined });
    contextState = "suspended";
    const play = await freshPlayer();

    play(COMPLETION_SOUND.CHIME);
    expect(started).toHaveLength(0);

    contextState = "running";
    play(COMPLETION_SOUND.CHIME);
    expect(started.length).toBeGreaterThan(0);
  });

  it("plays each sound's own clip once it decodes, and the chime while none has", async () => {
    vi.stubGlobal("AudioContext", StandInAudioContext);
    const { playCompletionSound: play, setCustomSoundClip } = await freshModule();

    await setCustomSoundClip(COMPLETION_SOUND.CUSTOM, new Uint8Array([2]));
    play(COMPLETION_SOUND.CUSTOM);
    const chime = started.length;
    expect(chime).toBeGreaterThan(1);

    clock.now += 2;
    await setCustomSoundClip(COMPLETION_SOUND.CUSTOM, new Uint8Array([1]));
    play(COMPLETION_SOUND.CUSTOM);
    expect(started).toHaveLength(chime + 1);

    // The other sound's clip is its own, so with none handed in it still plays the chime.
    clock.now += 2;
    play(COMPLETION_SOUND.CUSTOM_ASK);
    expect(started).toHaveLength(2 * chime + 1);
  });

  it("is silent, and throws nothing, where Web Audio is missing or refuses", async () => {
    const play = await freshPlayer();
    expect(() => play(COMPLETION_SOUND.CHIME)).not.toThrow();

    vi.stubGlobal("AudioContext", StandInAudioContext);
    oscillatorsRefused = true;
    const playRefused = await freshPlayer();
    expect(() => playRefused(COMPLETION_SOUND.CHIME)).not.toThrow();
  });
});
