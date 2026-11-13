/**
 * use-suggestions.ts -- the suggestions an agent wrote into its replies, as the phone reads, opens, and sends them, as the panel's do (`reply-button-link.tsx`, `suggestion-send.ts`).
 *
 * Each suggestion's button is read through the host behind the workspace's
 * Suggestions experiment, and the transcript draws it from that read: the
 * pill while it stands, or the chip of the agent it reached once a send of
 * it landed. A press never runs it but opens it filled in: a new agent's in
 * New agent on the task, with its brief and model, and a message's in the
 * running agent's own box. What the member sends from either goes through
 * the suggestion, once (`@repo/features/suggestion-model`), and a send's
 * answer lays the button as it now stands, so the reply draws it at once.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  AGENT_CALL_FAILURE,
  type ReplyButtonAnswerView,
  type ReplyButtonPressParams,
} from "@repo/features/agent-view";
import { iosAgentRoute } from "@repo/features/ios-app-links";
import {
  REPLY_BUTTON_ACTION,
  type ReplyButtonLink,
  type ReplyButtonView,
} from "@repo/features/reply-button-wire";
import {
  type DraftSuggestion,
  draftSuggestionOf,
  type SuggestionRefusal,
  type SuggestionSendResult,
  suggestionSendResult,
} from "@repo/features/suggestion-model";
import { unreachedAs } from "@repo/features/unreached";
import { ACT_KIND } from "@repo/host/acts";
import { selectWorkspaceExperiment } from "@repo/host/app-state-reads";
import { EXPERIMENT } from "@repo/settings";
import {
  markdownReplyButtons,
  SUGGESTION_LOOK,
  type SuggestionLook,
  TRANSCRIPT_ITEM,
  type TranscriptItem,
} from "@repo/ui-native";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback, useMemo } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";

/** The root of a suggestion's button read's key, under the account signed in, the agent whose reply holds it, and the button. */
const REPLY_BUTTON_QUERY = "reply-button";

/** No suggestion's links to read. */
const NO_LINKS: readonly ReplyButtonLink[] = [];

/** Only a suggestion's own address is read, so no moment or zone a date's chip counts from matters. */
const LINK_READING = { repository: null, now: 0, zone: "UTC" } as const;

/** A send that found no host to answer it, refused as unanswered. */
const unanswered = unreachedAs(AGENT_CALL_FAILURE.UNANSWERED);

/** The route params a press opens a suggestion's draft by: the agent whose reply holds it, and its button. */
export interface SuggestionParams {
  readonly suggestedBy?: string | undefined;
  readonly button?: string | undefined;
}

/** A suggestion's draft as a sheet or a box opens on it: what the send keeps, and the button as read, whose brief and model it lays in. */
export interface OpenedSuggestion {
  readonly suggestion: DraftSuggestion;
  readonly view: ReplyButtonView;
}

/** Each button once, across every message's words, so no read is asked twice. */
function eachButtonOnce(links: readonly ReplyButtonLink[]): readonly ReplyButtonLink[] {
  return links.filter(
    (link, at) =>
      links.findIndex(
        (each) => each.agentId === link.agentId && each.buttonId === link.buttonId,
      ) === at,
  );
}

/** The button a read answered, or none where it was refused or is unread. */
function viewOf(answer: ReplyButtonAnswerView | undefined): ReplyButtonView | undefined {
  return answer === undefined || "failure" in answer ? undefined : answer;
}

/** The account signed in, under which every button read is kept, so another account's never draws from them. */
function useAccountId(): string | undefined {
  const { data } = useQuery({
    ...appStateQuery,
    select: (state) => signedInAccountId(state.account),
  });

  return data;
}

/** A button's read: its key under the account, and the act that reads it. */
function buttonQuery(
  acts: ReturnType<typeof useHostActs>,
  accountId: string | undefined,
  link: Pick<ReplyButtonLink, "agentId" | "buttonId">,
) {
  return {
    queryKey: [REPLY_BUTTON_QUERY, accountId, link.agentId, link.buttonId],
    queryFn: () =>
      acts[ACT_KIND.AGENTS_REPLY_BUTTON]({ agentId: link.agentId, buttonId: link.buttonId }),
    retry: false,
  } as const;
}

/**
 * How each suggestion an agent's words hold stands, as the transcript draws
 * it: none while the workspace has Suggestions off or the button is unread,
 * which leaves the plain link; the pill a press opens filled in while it
 * stands; and the reached agent's chip, opening it, once a send landed.
 */
export function useSuggestionLooks(
  items: readonly TranscriptItem[],
  workspaceId: string | undefined,
  taskId: string | undefined,
): (link: ReplyButtonLink, words: string) => SuggestionLook | undefined {
  const acts = useHostActs();
  const router = useRouter();
  const accountId = useAccountId();

  const experimentSelect = useMemo(
    () => selectWorkspaceExperiment(workspaceId, EXPERIMENT.REPLY_BUTTONS),
    [workspaceId],
  );

  const { data: on = false } = useQuery({ ...appStateQuery, select: experimentSelect });

  const links = useMemo(() => {
    if (!on) return NO_LINKS;

    const words = items.flatMap((item) =>
      item.kind === TRANSCRIPT_ITEM.WORDS ? [item.words] : [],
    );

    return eachButtonOnce(words.flatMap((each) => markdownReplyButtons(each, LINK_READING)));
  }, [items, on]);

  const reads = useQueries({
    queries: links.map((link) => buttonQuery(acts, accountId, link)),
  });

  // Note that each read is kept by the agent and then its button, never by a key built from both.
  const views = new Map<string, Map<string, ReplyButtonView>>();

  links.forEach((link, at) => {
    const view = viewOf(reads[at]?.data);

    if (view === undefined) return;
    const byButton = views.get(link.agentId) ?? new Map<string, ReplyButtonView>();
    byButton.set(link.buttonId, view);
    views.set(link.agentId, byButton);
  });

  return (link, words) => {
    const view = views.get(link.agentId)?.get(link.buttonId);

    if (view === undefined) return undefined;
    const { action } = view;
    const reached = view.pressed?.agent;

    if (reached !== undefined && reached !== null) {
      return {
        look: SUGGESTION_LOOK.REACHED,
        suggests: action.kind,
        name: reached.title,
        onPress: () => router.push(iosAgentRoute(reached.id)),
      };
    }

    const params = { suggestedBy: link.agentId, button: link.buttonId };

    const onPress = () => {
      if (action.kind === REPLY_BUTTON_ACTION.START) {
        if (taskId !== undefined)
          router.push({ pathname: "/start-agent", params: { task: taskId, ...params } });

        return;
      }

      if (view.sendTo !== null) {
        router.push({ pathname: "/tasks/agent/[id]", params: { id: view.sendTo.id, ...params } });
      }
    };

    return {
      look: SUGGESTION_LOOK.OFFERED,
      suggests: action.kind,
      label: view.label || words,
      onPress,
    };
  };
}

/**
 * The suggestion a draft was opened on by its route's params, from the
 * button as the transcript read it: none where the params name none, the
 * button is unread, or a send of it already reached an agent, as the pill
 * stands offered until then, so a claim still out sends through it again
 * and hears why where it can't.
 */
export function useOpenedSuggestion({
  suggestedBy,
  button,
}: SuggestionParams): OpenedSuggestion | undefined {
  const acts = useHostActs();
  const accountId = useAccountId();
  const link = { agentId: suggestedBy ?? "", buttonId: button ?? "" };

  const { data } = useQuery({
    ...buttonQuery(acts, accountId, link),
    enabled: suggestedBy !== undefined && button !== undefined,
  });

  const view = viewOf(data);

  if (view === undefined || (view.pressed?.agent ?? null) !== null) return undefined;

  return { suggestion: draftSuggestionOf(link, view.action, view.label), view };
}

/**
 * Sends a suggestion's draft through it, once, and lays the button as the
 * send left it, so the reply draws it as the agent it reached at once. It
 * answers what the send came to (`suggestionSendResult`), a refusal said in
 * the caller's words (`refusal`).
 */
export function useSuggestionSender(): (
  params: ReplyButtonPressParams,
  refusal: SuggestionRefusal,
) => Promise<SuggestionSendResult> {
  const acts = useHostActs();
  const queries = useQueryClient();
  const accountId = useAccountId();

  return useCallback(
    async (params, refusal) => {
      const answer = await acts[ACT_KIND.AGENTS_REPLY_BUTTON_PRESS](params).catch(unanswered);

      if (!("failure" in answer)) {
        queries.setQueryData(buttonQuery(acts, accountId, params).queryKey, answer);
      }

      return suggestionSendResult(answer, refusal);
    },
    [acts, queries, accountId],
  );
}
