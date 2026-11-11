import { COMPLETION_SOUND } from "@repo/wire/app-settings";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What reached the speakers: the start time of every oscillator and noise burst the fake context was told to play. */
let started: number[];
let clock: { now: number };
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
}

/** A fresh player, since its one audio context and its busy mark live as long as the module. */
async function freshPlayer(): Promise<
  typeof import("./completion-sound.js")["playCompletionSound"]
> {
  vi.resetModules();
  return (await import("./completion-sound.js")).playCompletionSound;
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

  it("is silent, and throws nothing, where Web Audio is missing or refuses", async () => {
    const play = await freshPlayer();
    expect(() => play(COMPLETION_SOUND.CHIME)).not.toThrow();

    vi.stubGlobal("AudioContext", StandInAudioContext);
    oscillatorsRefused = true;
    const playRefused = await freshPlayer();
    expect(() => playRefused(COMPLETION_SOUND.CHIME)).not.toThrow();
  });
});
