// pill-look.ts -- what a pill in `PillField`'s words draws and is heard as: a mention as its chip in a message reads it, a file's marker as the file it names.

import { isPictureName } from "@repo/features/file-marker";
import { PILL_KIND, type Pill } from "@repo/features/pill-words";
import { ENTITY_GLYPH } from "./entity-glyph.js";
import { GLYPH, type Glyph } from "./glyph.js";
import {
  MARKDOWN_BLOCK,
  MARKDOWN_RUN,
  type MarkdownReading,
  markdownBlocks,
} from "./markdown-model.js";

/** A pill's glyph and words, and what VoiceOver hears for it. */
interface PillLook {
  readonly words: string;
  readonly glyph: Glyph;
  readonly heard: string;
}

/** The glyph a mention leads with where its link reads as no chip of ours. */
const LINK_GLYPH = GLYPH.GLOBE;

/**
 * A mention's look, read from its Markdown as a sent message reads it
 * (`markdownBlocks`), so a pill and the chip it becomes once sent say the
 * same: a date its day, a pull request its number and title, each kind its
 * own glyph. A link that reads as no chip keeps the name it was written with.
 */
function mentionLook(
  pill: Extract<Pill, { readonly kind: typeof PILL_KIND.MENTION }>,
  reading: MarkdownReading,
): PillLook {
  const [block] = markdownBlocks(pill.markdown, reading);
  const run = block?.kind === MARKDOWN_BLOCK.PARAGRAPH ? block.runs[0] : undefined;

  if (run?.kind !== MARKDOWN_RUN.CHIP)
    return { words: pill.name, glyph: LINK_GLYPH, heard: pill.name };

  return { words: run.chip.name, glyph: ENTITY_GLYPH[run.chip.entity], heard: run.chip.heard };
}

/** What a pill draws and is heard as: a mention as its chip, a picture or a file by its name and glyph. */
export function pillLook(pill: Pill, reading: MarkdownReading): PillLook {
  if (pill.kind === PILL_KIND.MENTION) return mentionLook(pill, reading);

  return {
    words: pill.name,
    glyph: isPictureName(pill.name) ? GLYPH.IMAGE : GLYPH.FILE,
    heard: pill.name,
  };
}
