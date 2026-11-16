/**
 * waveform.ts -- a sound clip's shape as a player draws it: how loud each stretch of it is, as bars between nothing and the loudest.
 *
 * A clip's samples are cut into as many even stretches as the waveform has
 * bars, and each bar stands as tall as the loudest sample in its stretch,
 * across every channel, so a click no longer than one sample still shows.
 * The bars are scaled so the loudest stands full, since a clip recorded
 * quietly would otherwise draw as a flat line, and every bar stands at least
 * `WAVEFORM_FLOOR`, so a silence still draws as a line where the scrubber
 * runs. A clip with no sound at all stands at the floor throughout.
 */

/** The least a bar stands at, of the loudest: a silence drawn as a line rather than as nothing. */
export const WAVEFORM_FLOOR = 0.08;

/** How loud each of `bars` even stretches of the samples is, between `WAVEFORM_FLOOR` and one. */
export function waveformPeaks(channels: readonly Float32Array[], bars: number): readonly number[] {
  const length = Math.max(0, ...channels.map((channel) => channel.length));
  const peaks: number[] = [];

  for (let bar = 0; bar < bars; bar += 1) {
    const from = Math.floor((bar * length) / bars);
    const to = Math.max(from + 1, Math.floor(((bar + 1) * length) / bars));
    let peak = 0;

    for (const channel of channels) {
      for (let at = from; at < Math.min(to, channel.length); at += 1) {
        peak = Math.max(peak, Math.abs(channel[at] ?? 0));
      }
    }

    peaks.push(peak);
  }

  const loudest = Math.max(0, ...peaks);

  return peaks.map((peak) =>
    loudest === 0 ? WAVEFORM_FLOOR : Math.max(WAVEFORM_FLOOR, peak / loudest),
  );
}
