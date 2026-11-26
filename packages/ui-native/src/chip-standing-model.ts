// chip-standing-model.ts -- how a chip of a GitHub page stands once GitHub has answered for it, as the panel's chip draws it: its state's mark and tone, the name it shows, and what VoiceOver hears, the same in a message's words and in a document field's pill.

import { entityWordHeard } from "@repo/features/entity-kind";
import type { LinkStanding } from "@repo/features/link-standing-model";
import { pullRequestMarkState } from "@repo/features/pull-request-model";
import type { Glyph } from "./glyph.js";
import { ISSUE_LOOK, PULL_REQUEST_LOOK } from "./inbox-line-model.js";
import type { MarkdownChip } from "./markdown-model.js";
import type { StatusTone } from "./tokens/status-tone.js";

/** A chip of a GitHub page as its standing draws it: its mark, its name, and its state's words after it. */
export interface StandingLook {
  readonly glyph: Glyph;
  readonly tone: StatusTone;
  readonly name: string;
  /** What VoiceOver hears: its kind, the name it now shows, and its state. */
  readonly heard: string;
}

/** A GitHub chip's words as VoiceOver hears them once its standing is read, as the panel hears the label it shows: its kind and the name it shows, then its state. */
function standingHeard(chip: MarkdownChip, name: string, state: string | undefined): string {
  const word = entityWordHeard(chip.entity, name);
  const named = word === undefined ? name : `${word} ${name}`;

  return state === undefined ? named : `${named}, ${state}`;
}

/**
 * How a chip of a GitHub page stands, as the panel's chip draws it: a pull
 * request by its number alone, its title fading mid-word in a chip, with
 * its state's mark, its words heard alone; an issue by its number and
 * title, likewise; none where GitHub has answered nothing of it.
 */
export function chipStanding(
  chip: MarkdownChip,
  linkStanding: (page: string) => LinkStanding | undefined,
): StandingLook | undefined {
  const standing = chip.github === undefined ? undefined : linkStanding(chip.github);

  if (standing?.pullRequest !== undefined) {
    const look = PULL_REQUEST_LOOK[pullRequestMarkState(standing.pullRequest)];
    const name = `#${standing.pullRequest.number}`;

    return {
      glyph: look.symbol,
      tone: look.tone,
      name,
      heard: standingHeard(chip, name, standing.state),
    };
  }

  if (standing?.issue !== undefined) {
    const look = ISSUE_LOOK[standing.issue.state];
    const name = `#${standing.issue.number} ${standing.title}`;

    return {
      glyph: look.symbol,
      tone: look.tone,
      name,
      heard: standingHeard(chip, name, standing.state),
    };
  }

  return undefined;
}
