// reaction-menu.ts -- a pull request comment's reactions on iOS: its Add reaction, as its long press menu offers it, GitHub's eight by their emoji, the reader's own ticked, a press giving one or taking it back; and the pills of those it wears.

import type { ReactionGroup } from "@repo/features/agent-wire";
import {
  ADD_REACTION_WORDS,
  REACTION_FACES,
  reactedWords,
} from "@repo/features/pull-request-model";
import { PULL_REQUEST_ACTION, REACTION } from "@repo/features/pull-request-write-wire";
import { GLYPH, githubFace, type ReactionPill, type RowSubmenu } from "@repo/ui-native";
import type { PullRequestWrites } from "./use-pull-request.js";

/**
 * Add reaction for what wears reactions by GitHub's id `subject`, as the
 * panel's smiley offers it: GitHub's eight in its order, each by its emoji,
 * the reader's own ticked as GitHub read their sign-in (`mine`), a press
 * giving it or taking it back, one change on GitHub on the member's own
 * sign-in (`ADD_REACTION`, `REMOVE_REACTION`) through the page's write.
 * None where the read names no id for it.
 */
export function reactionMenu(
  subject: string | undefined,
  reactions: readonly ReactionGroup[] | undefined,
  writes: PullRequestWrites,
): readonly RowSubmenu[] {
  if (subject === undefined) return [];

  const mine = new Set(
    (reactions ?? []).filter((each) => each.mine === true).map((each) => each.content),
  );

  return [
    {
      label: ADD_REACTION_WORDS,
      symbol: GLYPH.REACT,
      choices: Object.values(REACTION).map((content) => ({
        label: REACTION_FACES[content].item,
        emoji: REACTION_FACES[content].emoji,
        on: mine.has(content),
        onPress: () =>
          void writes.write({
            action: mine.has(content)
              ? PULL_REQUEST_ACTION.REMOVE_REACTION
              : PULL_REQUEST_ACTION.ADD_REACTION,
            subject,
            content,
          }),
      })),
    },
  ];
}

/** What a reaction's pill's press does to the reader's own, which its long press menu names. */
const REMOVE_REACTION_WORDS = "Remove reaction";

/**
 * The reactions what wears them by GitHub's id `subject` wears, as pills
 * (`ReactionPills`): each by its emoji and count in GitHub's order, the
 * reader's own lit (`mine`), who gave it named by their GitHub faces, and,
 * where `pressable` and the read names an id, a tap giving it or taking the
 * reader's back through the page's write, as the panel's pill does. Note
 * that a row, which is a press of its own, hands `pressable` false, its long
 * press's Add reaction giving or taking one.
 */
export function reactionPills(
  subject: string | undefined,
  reactions: readonly ReactionGroup[] | undefined,
  writes: PullRequestWrites,
  pressable: boolean,
): readonly ReactionPill[] {
  return (reactions ?? []).map((each) => {
    const face = REACTION_FACES[each.content];
    const mine = each.mine === true;
    const names = (each.by ?? []).map((person) => githubFace(person).name);

    const press =
      !pressable || subject === undefined
        ? undefined
        : {
            label: mine ? REMOVE_REACTION_WORDS : `${ADD_REACTION_WORDS}: ${face.item}`,
            onPress: () =>
              void writes.write({
                action: mine
                  ? PULL_REQUEST_ACTION.REMOVE_REACTION
                  : PULL_REQUEST_ACTION.ADD_REACTION,
                subject,
                content: each.content,
              }),
          };

    return {
      key: each.content,
      emoji: face.emoji,
      count: each.count,
      mine,
      who: reactedWords(names, each.count, face.name),
      press,
    };
  });
}
