// reaction-menu.ts -- a pull request comment's Add reaction, as its long press menu offers it on iOS: GitHub's eight by their emoji, the reader's own ticked, a press giving one or taking it back.

import type { ReactionGroup } from "@repo/features/agent-wire";
import { ADD_REACTION_WORDS, REACTION_FACES } from "@repo/features/pull-request-model";
import { PULL_REQUEST_ACTION, REACTION } from "@repo/features/pull-request-write-wire";
import { GLYPH, type RowSubmenu } from "@repo/ui-native";
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
