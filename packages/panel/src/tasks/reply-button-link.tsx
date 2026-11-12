import { LINK_DESTINATION, linkOf } from "@repo/features/link-grammar";
import {
  REPLY_BUTTON_ACTION,
  type ReplyButtonLink as ReadButtonLink,
  type ReplyButtonView,
} from "@repo/features/reply-button-wire";
import {
  draftSuggestionOf,
  suggestedChoice,
  suggestedWords,
} from "@repo/features/suggestion-model";
import { EXPERIMENT } from "@repo/settings";
import {
  AVATAR_SIZE,
  HOVER_CARD_ROW_LOOK,
  HoverCardRow,
  RepositoryPicture,
  SUGGESTION_KIND,
  Suggestion,
  SuggestionSent,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useOfferedModels } from "../account-choices.js";
import { DRAFT_PLACE, useDraftWriter } from "../composer-drafts.js";
import { HarnessMark } from "../harness-marks.js";
import { useRepositoryPictures } from "../repository-pictures.js";
import { useWorkspaceExperiment } from "../workspace-experiments.js";
import { providerOf } from "./agent-model.js";
import { useSuggestDoor } from "./fork-action.js";
import { linkChip } from "./mention-chip.js";
import { ModelLabel } from "./model-label.js";
import { replyButtonQuery } from "./suggestion-send.js";
import { useMentionDoors } from "./task-mentions.js";
import { useWordsWorkspaceId } from "./use-link-standing.js";
import { useOpenPlace } from "./use-open-link.js";

/**
 * reply-button-link.tsx -- a suggestion an agent wrote into its reply as a link (`@repo/features/reply-button-wire`), drawn as the suggestion, or as the chip of the agent it reached.
 *
 * The transcript hands every link of a suggestion's shape here
 * (`transcript-blocks.tsx`'s `MentionElement`). Where the words' workspace
 * has Suggestions on and the service reads it, it is drawn as `@repo/ui`'s
 * `Suggestion`: resting on it hangs what it suggests, and a press never runs
 * it but opens it filled in. A new agent's opens the task's draft
 * (`useSuggestDoor`), its brief in the box and its model on the chip; a
 * message's fills the running agent's own box and opens that agent. Either
 * draft wears a Suggested by chip, and its send goes through the
 * suggestion, once (`suggestion-send.ts`). Where no draft opens here, as in
 * a worker's tab, a press opens the agent whose reply holds it, whose tab
 * does. Once sent, by this member or another, it is that agent's own chip,
 * hanging its card, with Started or Sent after it. Off, or unread, it is the
 * plain link it is written as, to the agent whose reply holds it.
 */

/** Where a new agent would run, as an agent's card says it: its repository with its owner's picture, its branch, and its model with its harness's mark, each a row. */
function WhereRows({ view }: { view: ReplyButtonView }): ReactNode {
  const pictures = useRepositoryPictures();
  const models = useOfferedModels().data?.models ?? [];
  const { action } = view;

  if (action.kind !== REPLY_BUTTON_ACTION.START) return null;
  const provider = action.model === undefined ? undefined : providerOf(action.model);

  return (
    <>
      {view.repository === null ? null : (
        <HoverCardRow
          look={HOVER_CARD_ROW_LOOK.DETAIL}
          glyph={
            <RepositoryPicture
              repository={view.repository}
              pictures={pictures}
              size={AVATAR_SIZE.MARK}
            />
          }
          label={<ReplayMask>{view.repository}</ReplayMask>}
        />
      )}
      <HoverCardRow
        look={HOVER_CARD_ROW_LOOK.DETAIL}
        glyph={<GLYPH.BRANCH />}
        label={
          action.branch === undefined ? (
            <ReplayUnmask>Default branch</ReplayUnmask>
          ) : (
            <ReplayMask>{action.branch}</ReplayMask>
          )
        }
      />
      {action.model === undefined || action.effort === undefined ? null : (
        <HoverCardRow
          look={HOVER_CARD_ROW_LOOK.DETAIL}
          glyph={provider === undefined ? undefined : <HarnessMark provider={provider} />}
          label={
            <ModelLabel choice={{ model: action.model, effort: action.effort }} models={models} />
          }
        />
      )}
    </>
  );
}

export function ReplyButtonLink({
  link,
  words,
  plain,
}: {
  link: ReadButtonLink;
  /** The words the agent wrote it with, its label. */
  words: string;
  /** The plain link to draw where no suggestion is: off, unread, or refused. */
  plain: (href: string) => ReactNode;
}): ReactNode {
  const { agentId, buttonId, workspace } = link;
  const workspaceId = useWordsWorkspaceId({ taskId: undefined, workspace });
  const on = useWorkspaceExperiment(workspaceId, EXPERIMENT.REPLY_BUTTONS);
  const doors = useMentionDoors();
  const suggestDoor = useSuggestDoor();
  const openPlace = useOpenPlace();
  const writer = useDraftWriter();
  const read = useQuery({ ...replyButtonQuery(agentId, buttonId), enabled: on });
  const agentHref = linkOf({ kind: LINK_DESTINATION.AGENT, agentId }, workspace);
  const view = read.data;

  if (!on || view === undefined || "failure" in view) return plain(agentHref);
  const { action } = view;
  const label = view.label || words;
  const reached = view.pressed?.agent;

  if (reached !== undefined && reached !== null) {
    const href = linkOf({ kind: LINK_DESTINATION.AGENT, agentId: reached.id }, workspace);

    const after = (
      <SuggestionSent
        kind={
          action.kind === REPLY_BUTTON_ACTION.START ? SUGGESTION_KIND.START : SUGGESTION_KIND.SEND
        }
      />
    );

    return linkChip(href, reached.title, doors, undefined, after) ?? plain(href);
  }

  const suggestion = draftSuggestionOf(link, action, label);

  // Note that a press only fills a draft in and opens it, never sends: a new agent's in the task's draft, where this tab opens one, and a message's in its agent's own box.
  const open = () => {
    if (action.kind === REPLY_BUTTON_ACTION.START) {
      if (suggestDoor === undefined) {
        openPlace?.({ kind: LINK_DESTINATION.AGENT, agentId });

        return;
      }

      suggestDoor(suggestion, action.prompt, suggestedChoice(action));

      return;
    }

    const to = view.sendTo;

    if (to === null) return;
    writer.update({ kind: DRAFT_PLACE.AGENT, planId: to.taskId, agentId: to.id }, (was) =>
      was.suggestion?.buttonId === buttonId
        ? was
        : { ...was, text: suggestedWords(was.text, action.text), suggestion },
    );
    openPlace?.({ kind: LINK_DESTINATION.AGENT, planId: to.taskId, agentId: to.id });
  };

  const target =
    view.sendTo === null
      ? undefined
      : linkChip(
          linkOf({ kind: LINK_DESTINATION.AGENT, agentId: view.sendTo.id }, workspace),
          view.sendTo.title,
          doors,
        );

  return action.kind === REPLY_BUTTON_ACTION.START ? (
    <Suggestion
      label={label}
      kind={SUGGESTION_KIND.START}
      where={<WhereRows view={view} />}
      brief={action.prompt}
      onPress={open}
    />
  ) : (
    <Suggestion
      label={label}
      kind={SUGGESTION_KIND.SEND}
      target={target}
      brief={action.text}
      onPress={open}
    />
  );
}
