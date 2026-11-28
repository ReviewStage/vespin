/**
 * emoji-wire.ts -- one emoji as the wire carries it: a section's icon and a Manager's face alike.
 *
 * An emoji is one grapheme, as a person sees one character, holding a
 * pictograph, a flag's letters, or a keycap, its ends trimmed and bounded,
 * so a family or a flag with its joiners is one emoji and two side by side
 * are refused.
 */

import { Schema as EffectSchema } from "effect";

/** The most UTF-16 units one emoji may spell, a family or a flag with its joiners included. */
export const MAX_EMOJI_UNITS = 32;

/** What reads as an emoji: a pictograph, a flag's letters, or a keycap. */
const EMOJI_PART = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;

/** Whether a text is one grapheme, an emoji's, as a person sees one character. */
function isOneEmoji(text: string): boolean {
  if (!EMOJI_PART.test(text)) return false;
  const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text);

  return [...graphemes].length === 1;
}

/** One emoji, its ends trimmed. */
export const emojiSchema = EffectSchema.Trim.check(
  EffectSchema.isMaxLength(MAX_EMOJI_UNITS),
  EffectSchema.makeFilter(isOneEmoji),
);
