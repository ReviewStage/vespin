/**
 * use-skill-offer.ts -- the skills a `/` being typed offers in any of the app's composers, an agent's own and New task's and New agent's sheets alike, as the panel's box offers them.
 *
 * A `/` starting the word the words end with offers the skills of the place
 * they go (`TASKS_SKILLS`): a task's repository by the task, or, for a task
 * not made yet, the workspace's and the repository it starts in, as the
 * panel's New task reads them. They are read the first time one is typed,
 * kept a minute for the place under the account signed in, and narrowed as
 * the name is typed (`@repo/features/skill-mention`'s `skillOffer`); a
 * press writes the skill's `/name` in the word's place, which the agent
 * loads before it acts. None is offered while the Skills experiment is off,
 * as the panel offers none. Note that a field hands no caret, so the word is
 * the one the words end with, which is where the caret stands as a `/` is
 * typed.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  mentionAt,
  SKILLS_UNANSWERED,
  type SkillOffer,
  type SkillsRead,
  skillOffer,
  skillsReadOf,
} from "@repo/features/skill-mention";
import { skillWord } from "@repo/features/skill-word";
import type { TasksSkillsParams } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { selectExperiment } from "@repo/host/app-state-reads";
import { EXPERIMENT } from "@repo/settings";
import { BUZZ, buzz } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { appStateQuery } from "./host/app-state-query.js";
import { useHostActs } from "./host/host-provider.js";

/** Where the skills read are kept among the app's queries. */
const QUERY_ROOT = "repository-skills";

/** How long a read of a place's skills stands before a `/` reads them again, as the panel's list reads them again behind. */
const SKILLS_FRESH_MS = 60_000;

/** The skills a `/` being typed offers, what stands in their place where none is offered, and the press that writes one. */
export interface SkillsOffered extends SkillOffer {
  /** Writes the skill's `/name` in the `/` word's place. */
  readonly pick: (name: string) => void;
}

/**
 * The skills the `/` word `words` end with offers, read for `place`, a pick
 * handing the words with the skill written in to `onWords`; none while no
 * `/` word ends them, no place is known, or the Skills experiment is off.
 */
export function useSkillOffer(
  words: string,
  onWords: (words: string) => void,
  place: TasksSkillsParams | undefined,
): SkillsOffered | undefined {
  const acts = useHostActs();

  const { data: skillsOn = false } = useQuery({
    ...appStateQuery,
    select: selectExperiment(EXPERIMENT.SKILLS),
  });

  // Note that the read is kept under the account signed in, so another account's never offers from it.
  const { data: accountId } = useQuery({
    ...appStateQuery,
    select: (state) => signedInAccountId(state.account),
  });

  const mention = useMemo(() => mentionAt(words, words.length), [words]);
  const asks = skillsOn && mention !== undefined && place !== undefined;

  const { data: read } = useQuery({
    queryKey: [QUERY_ROOT, accountId, place],
    enabled: asks,
    staleTime: SKILLS_FRESH_MS,
    queryFn: (): Promise<SkillsRead> =>
      acts[ACT_KIND.TASKS_SKILLS](place ?? { planId: "" }).then(skillsReadOf, (cause: unknown) => {
        console.error("The skills were not read.", cause);

        return { unread: SKILLS_UNANSWERED };
      }),
  });

  if (!asks) return undefined;

  return {
    ...skillOffer(read, mention.query),
    pick: (name) => {
      onWords(`${words.slice(0, mention.start)}${skillWord(name)} `);
      buzz(BUZZ.SELECTION);
    },
  };
}
