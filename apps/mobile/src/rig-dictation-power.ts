// rig-dictation-power.ts -- the rig's stand-in for a voice: the power a fixture run's dictation meters while `-dictationPower canned` asks, so a simulator's silent microphone still draws the strip's wave as speech draws it.

import { launchCannedDictationPower } from "./host/launch-arguments.js";

/** A voice's average power, in decibels below full scale, one reading a beat: syllables rising and falling with short pauses, looped. */
const CANNED_POWER = [
  -48, -30, -18, -12, -16, -26, -44, -52, -24, -14, -10, -13, -20, -34, -50, -55, -22, -15, -11,
  -18, -30, -42, -17, -12, -21, -38, -54, -56,
] as const;

/** How many readings the canned voice has given. */
let read = 0;

/** The canned voice's next reading, looped. */
function cannedPower(): number {
  const reading = CANNED_POWER[read % CANNED_POWER.length] ?? 0;
  read += 1;

  return reading;
}

/** What a dictation meters in place of the microphone, read once at launch: the canned voice where the launch asks for it, and none, the microphone itself, on every phone. */
export const rigDictationPower: (() => number) | undefined = launchCannedDictationPower()
  ? cannedPower
  : undefined;
