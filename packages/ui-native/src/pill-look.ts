// pill-look.ts -- what a pill in `PillField`'s words draws and is heard as: a mention as its chip in a message reads it, a file's marker as the file it names.

import { isPictureName } from "@repo/features/file-marker";
import { PILL_KIND, type Pill } from "@repo/features/pill-words";
import { CHIP_MARK, type ChipMarkOf } from "./chip-mark-model.js";
import { ENTITY_GLYPH } from "./entity-glyph.js";
import { GLYPH, type Glyph } from "./glyph.js";
import { managerFaceAsset } from "./manager-face-look.js";
import {
  MARKDOWN_BLOCK,
  MARKDOWN_RUN,
  type MarkdownChip,
  type MarkdownReading,
  markdownBlocks,
} from "./markdown-model.js";

/** A pill's glyph and words, and what VoiceOver hears for it. */
interface PillLook {
  readonly words: string;
  /** The asset catalog's name of what leads its words: its kind's glyph, or a Manager's face (`managerFaceAsset`). */
  readonly glyph: Glyph | string;
  readonly heard: string;
}

/** The glyph a mention leads with where its link reads as no chip of ours. */
const LINK_GLYPH = GLYPH.GLOBE;

/** What leads a chip's words in a pill: a Manager's face, at rest, since a field's words stand still, where the app holds one, else its kind's glyph. */
function chipGlyph(chip: MarkdownChip, markOf: ChipMarkOf | undefined): Glyph | string {
  const mark = chip.of === undefined ? undefined : markOf?.(chip.of);

  return mark?.kind === CHIP_MARK.MANAGER
    ? managerFaceAsset(mark.face, false)
    : ENTITY_GLYPH[chip.entity];
}

/**
 * A mention's look, read from its Markdown as a sent message reads it
 * (`markdownBlocks`), so a pill and the chip it becomes once sent say the
 * same: a date its day, a pull request its number and title, each kind its
 * own glyph, a Manager its face. A link that reads as no chip keeps the name
 * it was written with.
 */
function mentionLook(
  pill: Extract<Pill, { readonly kind: typeof PILL_KIND.MENTION }>,
  reading: MarkdownReading,
  markOf: ChipMarkOf | undefined,
): PillLook {
  const [block] = markdownBlocks(pill.markdown, reading);
  const run = block?.kind === MARKDOWN_BLOCK.PARAGRAPH ? block.runs[0] : undefined;

  if (run?.kind !== MARKDOWN_RUN.CHIP)
    return { words: pill.name, glyph: LINK_GLYPH, heard: pill.name };

  return { words: run.chip.name, glyph: chipGlyph(run.chip, markOf), heard: run.chip.heard };
}

/** What a pill draws and is heard as: a mention as its chip, a picture or a file by its name and glyph; a Manager's by its face where `markOf` holds it. */
export function pillLook(pill: Pill, reading: MarkdownReading, markOf?: ChipMarkOf): PillLook {
  if (pill.kind === PILL_KIND.MENTION) return mentionLook(pill, reading, markOf);

  return {
    words: pill.name,
    glyph: isPictureName(pill.name) ? GLYPH.IMAGE : GLYPH.FILE,
    heard: pill.name,
  };
}
