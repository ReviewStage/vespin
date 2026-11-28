// dictation-wave-model.ts -- the dictation strip's wave as numbers: how loud the microphone's metered power reads, and the bars it keeps, newest last.

/** How many bars the wave holds: enough to cross a phone's strip, the oldest clipped at the leading edge where the strip is narrower. */
const WAVE_BAR_COUNT = 64;

/** How much a voice's level is scaled, so ordinary speech fills the wave, as the desktop's meter scales it (`frame-level.ts`). */
const SPEECH_GAIN = 4.5;

/** The bars the wave holds, newest last, and the count of the oldest, which names it while it scrolls. */
export interface Wave {
  readonly first: number;
  readonly levels: readonly number[];
}

/** A wave of silence, every bar at rest. */
export const QUIET_WAVE: Wave = {
  first: 0,
  levels: Array.from({ length: WAVE_BAR_COUNT }, () => 0),
};

/**
 * How loud the microphone is, in the unit interval, from its average power
 * in decibels below full scale as iOS's recorder meters it (0 the loudest,
 * -160 silence): the power read back as the level's root mean square and
 * scaled as the desktop scales its own, so a voice fills the wave as it
 * does there. Nothing metered is silence.
 */
export function levelOfPower(decibels: number | undefined): number {
  if (decibels === undefined || !Number.isFinite(decibels)) return 0;

  return Math.min(1, 10 ** (decibels / 20) * SPEECH_GAIN);
}

/** The wave with a new bar at its end, its oldest let go. */
export function pushedWave(wave: Wave, level: number): Wave {
  return { first: wave.first + 1, levels: [...wave.levels.slice(1), level] };
}
