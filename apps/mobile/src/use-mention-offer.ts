/**
 * use-mention-offer.ts -- what an `@` being typed offers in an agent's composer, as the panel's mention picker offers it: the place's agents, its workspace's tasks and people, and each pick sent as the mention's link.
 *
 * An `@` starting the word the words end with offers, with nothing typed
 * after it, the task's own agents as Suggested and then the workspace's
 * people, the reader first; with words typed, the workspace's agents, tasks
 * and people the words find, as `@repo/features/mention-offer` groups and
 * scores them. A pick writes `@Name ` in the word's place, since the
 * system's field can draw no chip, and the send writes each picked
 * `@Name` still standing as the link the panel's chip writes
 * (`[@Name](https://vespin.dev/…)`). The people are followed only while an
 * `@` is being typed. Note that a field hands no caret, so the word is the
 * one the words end with, which is where the caret stands as it is typed.
 */

import { LINK_DESTINATION, linkOf, linkWorkspaceStep } from "@repo/features/link-grammar";
import {
  atWordEnding,
  MENTION_NO_MATCH,
  MENTION_OFFER_GROUP,
  type MentionCandidate,
  type MentionGroup,
  type MentionOfferGroup,
  mentionGroups,
  type PickedMention,
  withMentionLinks,
  wordsWithPick,
} from "@repo/features/mention-offer";
import { agentName } from "@repo/features/model-label";
import { taskKey } from "@repo/features/workspace-key";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import { BUZZ, buzz, GLYPH, type Glyph, type MentionSuggestionGroup } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { appStateQuery } from "./host/app-state-query.js";
import { useListedAgents, useListedTasks } from "./host/host-provider.js";
import { useListedMembers } from "./member-pictures.js";

/** What a person's row says after their name where it is the reader, as the panel's picker says it. */
const YOU = "You";

/** The glyph each group's rows lead with, as the panel's rows lead with their kind's. */
const GROUP_GLYPH = {
  [MENTION_OFFER_GROUP.SUGGESTED]: GLYPH.AGENT,
  [MENTION_OFFER_GROUP.AGENTS]: GLYPH.AGENT,
  [MENTION_OFFER_GROUP.TASKS]: GLYPH.TASK,
  [MENTION_OFFER_GROUP.PEOPLE]: GLYPH.PERSON,
} as const satisfies Record<MentionOfferGroup, Glyph>;

/** What an `@` being typed offers, what stands where nothing matches, and the press that writes one. */
export interface MentionsOffered {
  readonly groups: readonly MentionSuggestionGroup[];
  readonly empty: string | undefined;
  readonly pick: (group: string, id: string) => void;
}

/** What `useMentionOffer` hands its composer: the offer while an `@` is typed, and the words as they are sent, each pick written as its link. */
export interface MentionOffer {
  readonly offered: MentionsOffered | undefined;
  readonly sendable: (words: string) => string;
}

/**
 * What the `@` word `words` end with offers in the place, a pick handing
 * the words with the name written in to `onWords`; none while no `@` word
 * ends them, or before the place's workspace is known.
 */
export function useMentionOffer(
  words: string,
  onWords: (words: string) => void,
  place: { readonly workspaceId: string | undefined; readonly taskId: string | undefined },
): MentionOffer {
  const { workspaceId, taskId } = place;
  const word = useMemo(() => atWordEnding(words), [words]);
  const asking = word !== undefined && workspaceId !== undefined;
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? [];
  const step = linkWorkspaceStep(workspaceId, workspaces);
  const workspace = workspaces.find(({ id }) => id === workspaceId);
  const members = useListedMembers(asking ? workspaceId : undefined);
  const agents = useListedAgents();
  const tasks = useListedTasks();
  // The mentions picked into the words, which the send writes as their links where they still stand.
  const picked = useRef<PickedMention[]>([]);

  const groups = useMemo((): readonly MentionGroup[] => {
    if (!asking || step === undefined) return [];

    const ownAgents = agents.filter(
      (agent) => agent.workspaceId === workspaceId && agent.archivedAt === undefined,
    );

    const agentRow = (agent: (typeof ownAgents)[number]): MentionCandidate => ({
      id: agent.id,
      name: agentName(agent),
      target: linkOf({ kind: LINK_DESTINATION.AGENT, agentId: agent.id }, step),
    });

    const sources = {
      suggested: ownAgents.filter((agent) => agent.taskId === taskId).map(agentRow),
      agents: ownAgents.map(agentRow),
      tasks: tasks
        .filter((task) => task.workspaceId === workspaceId)
        .map((task) => {
          const key =
            workspace === undefined || task.number === undefined
              ? undefined
              : taskKey(workspace.name, task.number);

          return {
            id: task.id,
            name: task.name,
            detail: key,
            key,
            target: linkOf({ kind: LINK_DESTINATION.TASK, taskId: task.id }, step),
          };
        }),
      people: members.map((member) => ({
        id: member.userId,
        name: member.name,
        detail: member.you ? YOU : member.email,
        terms: [member.email],
        target: linkOf({ kind: LINK_DESTINATION.PERSON, userId: member.userId }, step),
      })),
    };

    return mentionGroups(sources, word.query);
  }, [asking, step, agents, tasks, members, workspaceId, taskId, workspace, word]);

  const sendable = (text: string) => withMentionLinks(text, picked.current);

  if (!asking) return { offered: undefined, sendable };

  // Note that once the words run past a space with nothing found, the offer closes, as the panel's list closes, so a sentence that began with an `@` goes on unhindered.
  if (groups.length === 0 && word.query.includes(" ")) return { offered: undefined, sendable };

  return {
    offered: {
      groups: groups.map((group) => ({
        title: group.title,
        glyph: GROUP_GLYPH[group.title],
        rows: group.rows.map(({ id, name, detail }) => ({ id, name, detail })),
      })),
      empty: groups.length === 0 ? MENTION_NO_MATCH : undefined,
      pick: (title, id) => {
        const row = groups
          .find((group) => group.title === title)
          ?.rows.find((each) => each.id === id);

        if (row === undefined) return;
        picked.current = [...picked.current, { name: row.name, target: row.target }];
        onWords(wordsWithPick(words, word.start, row.name));
        buzz(BUZZ.SELECTION);
      },
    },
    sendable,
  };
}
