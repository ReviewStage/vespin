import { messageFailureWords, startFailureWords } from "@repo/features/agent-refusal-words";
import { isAgentCallFailure, type ReplyButtonAnswerView } from "@repo/features/agent-view";
import { ENTITY_KIND } from "@repo/features/entity-kind";
import { LINK_DESTINATION, linkOf } from "@repo/features/link-grammar";
import { effortLabel } from "@repo/features/model-effort";
import { modelLabel } from "@repo/features/model-label";
import {
  REPLY_BUTTON_ACTION,
  type ReplyButtonLink as ReadButtonLink,
  type ReplyButtonView,
} from "@repo/features/reply-button-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import { REPLY_BUTTON_KIND, ReplyButton, STATUS_TONE } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { askAct } from "../act.js";
import { useCoarsePointer } from "../coarse-pointer.js";
import { EntityGlyph } from "../entities/entity-glyph.js";
import { QUERY_ROOT } from "../query-keys.js";
import { usePhoneRoom } from "../stage-room.js";
import { showToast } from "../toast.js";
import { useWorkspaceExperiment } from "../workspace-experiments.js";
import { linkChip } from "./mention-chip.js";
import { useMentionDoors } from "./task-mentions.js";
import { useWordsWorkspaceId } from "./use-link-standing.js";

/**
 * reply-button-link.tsx -- a button an agent wrote into its reply as a link (`@repo/features/reply-button-wire`), drawn as the button, or as the chip of the agent its press reached.
 *
 * The transcript hands every link of a button's shape here
 * (`transcript-blocks.tsx`'s `MentionElement`). Where the words' workspace
 * has Reply buttons on and the service reads the button, it is drawn as
 * `@repo/ui`'s `ReplyButton`: a pointer's rest hangs what it does over its
 * brief and a press runs it; a finger or a phone's width opens the brief
 * first. Once pressed, by this member or another, it is the chip of the
 * agent it started or sent to, which opens that agent. Off, or unread, it
 * is the plain link it is written as, to the agent whose reply holds it, so
 * a reader still reaches that agent and nothing is pressed. A press refused
 * says why in a toast and leaves the button to press again.
 */

/** What a press that did not run says where no refusal of a start's or a send's names why. */
const PRESS_REFUSED = "The button didn't run. Try again.";

/** The button as the service answers it, by its agent and its id. */
const replyButtonQuery = (agentId: string, buttonId: string) =>
  queryOptions({
    queryKey: [QUERY_ROOT.REPLY_BUTTON, agentId, buttonId],
    queryFn: () => askAct(ACT_KIND.AGENTS_REPLY_BUTTON, { agentId, buttonId }),
    retry: false,
  });

/** Where a press runs, one line: a start's repository, branch, and model, or the agent a send goes to. */
function whereOf(view: ReplyButtonView): string {
  const { action } = view;
  if (action.kind === REPLY_BUTTON_ACTION.SEND) {
    return view.sendTo === null ? "To an agent" : `To ${view.sendTo.title}`;
  }
  const model =
    action.model === undefined
      ? "Your default model"
      : `${modelLabel(action.model)} ${action.effort === undefined ? "" : effortLabel(action.effort)}`.trim();
  return [view.repository ?? "No repository", action.branch ?? "Default branch", model].join(" · ");
}

/** The brief a press hands on: a start's prompt, or a send's words. */
function briefOf(view: ReplyButtonView): string {
  return view.action.kind === REPLY_BUTTON_ACTION.START ? view.action.prompt : view.action.text;
}

/** What a press refused says: a send's refusal as a message's, a start's as a Start's, and any other as a press that did not run. */
function pressFailureWords(read: ReplyButtonAnswerView | undefined, failure: string): string {
  if (!isAgentCallFailure(failure)) return PRESS_REFUSED;
  const sends =
    read !== undefined && !("failure" in read) && read.action.kind === REPLY_BUTTON_ACTION.SEND;
  return sends ? messageFailureWords(failure) : startFailureWords(failure);
}

export function ReplyButtonLink({
  link,
  words,
  plain,
}: {
  link: ReadButtonLink;
  /** The words the agent wrote it with, its label. */
  words: string;
  /** The plain link to draw where no button is: off, unread, or refused. */
  plain: (href: string) => ReactNode;
}): ReactNode {
  const { agentId, buttonId, workspace } = link;
  const workspaceId = useWordsWorkspaceId({ taskId: undefined, workspace });
  const on = useWorkspaceExperiment(workspaceId, EXPERIMENT.REPLY_BUTTONS);
  const doors = useMentionDoors();
  const coarse = useCoarsePointer();
  const phone = usePhoneRoom();
  const queries = useQueryClient();
  const query = replyButtonQuery(agentId, buttonId);
  const read = useQuery({ ...query, enabled: on });
  const press = useMutation({
    mutationFn: () => askAct(ACT_KIND.AGENTS_REPLY_BUTTON_PRESS, { agentId, buttonId }),
    onSuccess: (answer) => {
      if ("failure" in answer) {
        showToast({
          words: pressFailureWords(read.data, answer.failure),
          replayUnmasked: true,
          tone: STATUS_TONE.DANGER,
          failure: {
            surface: FAILURE_SURFACE.AGENT_REPLY_BUTTON_PRESS,
            cause: answer,
            act: ACT_KIND.AGENTS_REPLY_BUTTON_PRESS,
          },
        });
        return;
      }
      queries.setQueryData(query.queryKey, answer);
    },
  });
  const agentHref = linkOf({ kind: LINK_DESTINATION.AGENT, agentId }, workspace);
  const view = read.data;
  if (!on || view === undefined || "failure" in view) return plain(agentHref);
  const reached = view.pressed?.agent;
  if (reached !== undefined && reached !== null) {
    const href = linkOf({ kind: LINK_DESTINATION.AGENT, agentId: reached.id }, workspace);
    return linkChip(href, reached.title, doors) ?? plain(href);
  }
  const starts = view.action.kind === REPLY_BUTTON_ACTION.START;
  return (
    <ReplyButton
      label={view.label || words}
      kind={starts ? REPLY_BUTTON_KIND.START : REPLY_BUTTON_KIND.SEND}
      glyph={starts ? <EntityGlyph kind={ENTITY_KIND.AGENT} /> : <GLYPH.SEND />}
      where={whereOf(view)}
      brief={briefOf(view)}
      pressing={press.isPending || (view.pressed !== null && view.pressed.agent === null)}
      confirmFirst={coarse || phone}
      onPress={() => press.mutate()}
    />
  );
}
