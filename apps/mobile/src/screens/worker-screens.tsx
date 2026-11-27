// worker-screens.tsx -- one of an agent's workers, pushed from its delegation's row: its transcript read whole and followed while it works, as the panel's subagent tab stands it.

import { agentStateWords } from "@repo/features/glyph-state";
import { cardTitle } from "@repo/features/plain-words";
import { agentStillWriting } from "@repo/features/task-agents-model";
import { workerLines } from "@repo/features/transcript-lines";
import { selectInboxReader } from "@repo/host/app-state-reads";
import {
  AgentTranscript,
  BAR_TITLE,
  BUTTON_LOOK,
  delegatedWorker,
  GLYPH,
  NO_TOGGLES,
  openCuts,
  StackSubtitle,
  shownMediaIds,
  type TranscriptItem,
  type TranscriptToggles,
  toggledAt,
  transcriptItems,
  useColors,
  useWindowSizeClass,
  WINDOW_SIZE_CLASS,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  useAgentMedia,
  useAgentTranscript,
  useFollowedAgent,
  useHeldTranscript,
  useOlderPages,
  useShownAgent,
  useTranscriptRetry,
  useWholeParts,
} from "../agents/use-agent.js";
import { usePlaceAddress } from "../agents/use-suggestions.js";
import { appStateQuery } from "../host/app-state-query.js";
import { openInSafari, useOpenLink } from "../open-link.js";
import { useOnOwnTab } from "../tab-route.js";

/** No row, while the worker's transcript is not read yet, the same array every render so nothing read off the rows reads again. */
const NO_ROWS: readonly TranscriptItem[] = [];

/** No pull request, which a worker never opens, the same array every render. */
const NO_PULL_REQUESTS = [] as const;

/** What the page says while it reads the worker's transcript, where it could not, and what the bar names a worker by where nothing names its job. */
const WORKER_WORDS = {
  READING: "Reading the transcript",
  FAILED: "The transcript could not be read.",
  RETRY: "Try again",
  SUBAGENT: "Subagent",
} as const;

/**
 * One of an agent's workers, named by the route's `id`, the agent, and
 * `call`, the delegation that started it: its transcript, read under the
 * agent and the call and followed while the page is in focus, drawn as an
 * agent's is (`transcriptItems`), opening on the task it was handed
 * (`workerLines`), with Working… at its end while it works; and no composer,
 * dock, or menu, since nothing is sent to a worker, as the panel's subagent
 * tab stands it. Its bar names the job, as the delegation's row names it,
 * with where the worker stands and the pair it runs on under it, as an
 * agent's page says them, read from the agent's own page beneath it, which
 * the host still holds. It is pushed over the agent's page on the agent's
 * own stack in every window, as its shown pages and its chat's threads are,
 * so its back button leads to the agent. A worker of its own opens no page,
 * and folds open on its task and its answer, as the panel's does.
 */
export function WorkerScreen() {
  const { id = "", call = "" } = useLocalSearchParams<{ id: string; call: string }>();
  const colors = useColors();
  const router = useRouter();
  const onOwnTab = useOnOwnTab();
  const agent = useFollowedAgent(id);
  const shown = useShownAgent(id);
  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });
  const held = useAgentTranscript(id, call);
  const transcript = held?.rows;
  const messages = transcript?.messages;
  const owner = useHeldTranscript(id)?.rows;
  const standing = owner?.word?.subagents?.find((each) => each.callId === call);

  const delegated = useMemo(
    () => (owner === undefined ? undefined : delegatedWorker(owner.messages, call, standing)),
    [owner, call, standing],
  );

  // Note that the worker's own page says where it stands, and the agent's what it was handed and runs on, which the worker's says nothing of.
  const status = transcript?.word?.status ?? standing?.status;
  const writing = status !== undefined && agentStillWriting(status);
  const [toggles, setToggles] = useState<TranscriptToggles>(NO_TOGGLES);
  const whole = useWholeParts(id, call);
  const openLink = useOpenLink(shown?.workspaceId);
  const placeAddress = usePlaceAddress(shown?.workspaceId);
  const retry = useTranscriptRetry(id, call);
  const older = useOlderPages(id, transcript?.before, call);

  const items = useMemo(
    () =>
      messages === undefined
        ? NO_ROWS
        : transcriptItems(workerLines(delegated?.task ?? "", messages), {
            writing,
            readerId,
            toggles,
            now: Date.now(),
            pullRequests: NO_PULL_REQUESTS,
            wholePart: whole.read,
            placeAddress,
            worker: true,
          }),
    [messages, delegated?.task, writing, readerId, toggles, whole.read, placeAddress],
  );

  // A call opened on an answer its page carried cut reads it whole, under the worker.
  const cuts = useMemo(() => openCuts(items), [items]);
  useEffect(() => whole.ask(cuts), [whole, cuts]);
  // Note that every picture, recording, and clip the worker showed is read as a file under the worker, since a picture's own address names the agent's alone.
  const mediaIds = useMemo(() => shownMediaIds(items), [items]);
  const media = useAgentMedia(id, mediaIds, call);
  const failed = held?.failed === true || transcript?.failure !== undefined;
  const regular = useWindowSizeClass() === WINDOW_SIZE_CLASS.REGULAR;

  const title =
    delegated?.job ?? (cardTitle(transcript?.word?.title ?? "") || WORKER_WORDS.SUBAGENT);

  const subtitle = [status === undefined ? undefined : agentStateWords(status), delegated?.pair]
    .filter((each) => each !== undefined && each !== "")
    .join(" · ");

  return (
    <>
      <Stack.Screen
        options={{ title, headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT } }}
      />
      {/* Note that where the worker stands and its pair stand under its job as the bar's own subtitle, as an agent's page says them under its name. */}
      <StackSubtitle words={subtitle} leading={regular} />
      <AgentTranscript
        items={items}
        head={null}
        empty={{
          title: failed ? WORKER_WORDS.FAILED : WORKER_WORDS.READING,
          symbol: failed ? GLYPH.FAILED : GLYPH.AGENT,
          loading: !failed,
          action: failed
            ? { label: WORKER_WORDS.RETRY, look: BUTTON_LOOK.BORDERED, onPress: retry }
            : undefined,
        }}
        older={older}
        repository={agent?.repository}
        onOpenLink={openLink}
        onToggle={(item) => setToggles((was) => toggledAt(was, item))}
        onOpenPage={(item) =>
          router.push({
            pathname: onOwnTab("/tasks/agent/[id]/page"),
            params: { id, page: item.page, version: String(item.version), title: item.title },
          })
        }
        mediaSource={(mediaId) => media.sources.get(mediaId)}
        onRetryMedia={media.retry}
        onOpenAddress={openInSafari}
      />
    </>
  );
}
