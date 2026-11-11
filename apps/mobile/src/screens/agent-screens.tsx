// agent-screens.tsx -- one agent's page, its transcript live under the system's header naming it, its held calls answered, and a page it showed, opened whole.

import { DENIES_WAITING } from "@repo/features/agent-approval-model";
import { type AgentOverviewPullRequest, PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import { PRODUCT_SURFACE } from "@repo/features/analytics";
import { LINK_DESTINATION, linkOf } from "@repo/features/link-grammar";
import { modelLabel } from "@repo/features/model-label";
import { cardTitle } from "@repo/features/plain-words";
import {
  MERGE_ACTION,
  MERGE_PRESS_WORDS,
  MERGE_WORDS,
  mergeActionFor,
} from "@repo/features/pull-request-model";
import { PULL_REQUEST_ACTION } from "@repo/features/pull-request-write-wire";
import { agentStillWriting } from "@repo/features/task-agents-model";
import { selectInboxReader, selectWorkspaces } from "@repo/host/app-state-reads";
import {
  AgentHead,
  AgentTranscript,
  AskNote,
  AttachedPictures,
  BAR_TITLE,
  Composer,
  ConfirmAsk,
  DOCK_ROOM,
  EmptyState,
  GlassDock,
  HeldCallBanner,
  NO_TOGGLES,
  QueuedLines,
  Screen,
  SealedPage,
  shownMediaIds,
  type TRANSCRIPT_ITEM,
  type TranscriptItem,
  type TranscriptToggles,
  toggledAt,
  transcriptItems,
  useColors,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  useAgentMedia,
  useAgentPullRequests,
  useAgentTranscript,
  useFollowedAgent,
  useOlderPages,
  usePageHtml,
  useTranscriptRetry,
} from "../agents/use-agent.js";
import { type AgentApprovals, useAgentApprovals } from "../agents/use-agent-approvals.js";
import { type AgentComposer, useAgentComposer } from "../agents/use-agent-composer.js";
import { appStateQuery } from "../host/app-state-query.js";
import { openInSafari, useOpenLink } from "../open-link.js";
import { usePullRequestsRead, usePullRequestWrites } from "../pull-requests/use-pull-request.js";
import { useSurfaceOpen } from "../surface-open.js";

/** What an agent is called where the list holds no title for it yet. */
const UNTITLED_AGENT = "Agent";

/** What the page's menu opens the agent on. */
const OPEN_ON_WEB = "Open on vespin.dev";

/** What stands in the transcript's place while it is read, and where it could not be, with what reads it again. */
const TRANSCRIPT_WORDS = {
  READING: "Reading the transcript",
  FAILED: "The transcript could not be read.",
  RETRY: "Try again",
} as const;

/** What a pull request's card offers beside Review where it may merge now, and what that asks first. */
const MERGE_WORD = "Merge";
const MERGE_QUESTION = "Merge this pull request?";

/** What stands in a page's place while it is read, and where it could not be. */
const PAGE_WORDS = {
  READING: "Reading the page",
  FAILED: "The page could not be read.",
} as const;

/** The agent's address on vespin.dev, under its workspace and its task, once the agent is read. */
function useAgentAddress(
  agentId: string,
  workspaceId: string | undefined,
  taskId: string | undefined,
): string {
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? [];
  const workspace = workspaces.find(({ id }) => id === workspaceId);
  const place =
    taskId === undefined
      ? { kind: LINK_DESTINATION.AGENT, agentId }
      : { kind: LINK_DESTINATION.AGENT, planId: taskId, agentId };
  return linkOf(place, workspace?.slug ?? workspace?.id ?? workspaceId ?? "");
}

/** The change a card's Merge sends, by what the pull request offers: merged at once by the first method the repository allows, or queued once ready where it merges through a queue; none where it offers neither. */
function cardMergeOf(pullRequest: AgentOverviewPullRequest | undefined) {
  const action = pullRequest === undefined ? undefined : mergeActionFor(pullRequest);
  const headSha = pullRequest?.merging?.headSha ?? "";
  const method = pullRequest?.merging?.methods[0];
  if (action === MERGE_ACTION.MERGE_WHEN_READY) {
    const request = { action: PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE, headSha } as const;
    return { words: MERGE_WORDS.MERGE_WHEN_READY, request };
  }
  if (action !== MERGE_ACTION.MERGE || method === undefined) return undefined;
  const request = { action: PULL_REQUEST_ACTION.MERGE, method, headSha } as const;
  return { words: MERGE_PRESS_WORDS[method], request };
}

/**
 * The question a card's Merge asks first, as the system's confirmation
 * dialog: the pull request by its number and title, and the merge in the
 * words its own screen's press says. Its answer sends the merge, which the
 * card then draws as GitHub took it; it goes as it is answered.
 */
function CardMergeAsk({
  agentId,
  pullRequest,
  onDone,
}: {
  readonly agentId: string;
  readonly pullRequest: AgentOverviewPullRequest;
  readonly onDone: () => void;
}) {
  const writes = usePullRequestWrites({ agentId, number: pullRequest.number });
  const merge = cardMergeOf(pullRequest);
  if (merge === undefined) return null;
  return (
    <ConfirmAsk
      title={MERGE_QUESTION}
      message={`#${pullRequest.number} ${pullRequest.title}`}
      act={merge.words}
      presented
      onAct={() => {
        onDone();
        void writes.write(merge.request);
      }}
      onDismiss={onDone}
    />
  );
}

/** The agent's composer at the page's foot: a call waiting on an answer, the queue, the pictures attached, and what did not go over the field, and Stop in Send's place while the agent works. */
function AgentComposerBar({
  composer,
  banner,
}: {
  readonly composer: AgentComposer;
  readonly banner: AgentApprovals["banner"];
}) {
  const head =
    banner === undefined &&
    composer.queued.length === 0 &&
    composer.paused === undefined &&
    composer.attached.length === 0 &&
    composer.note === undefined ? undefined : (
      <>
        {banner === undefined ? null : (
          <HeldCallBanner {...banner} denies={composer.sendQueues ? undefined : DENIES_WAITING} />
        )}
        <QueuedLines
          lines={composer.queued}
          paused={composer.paused}
          onSteer={composer.steer}
          onDelete={composer.remove}
        />
        <AttachedPictures pictures={composer.attached} onDetach={composer.detach} />
        {composer.note === undefined ? null : <AskNote words={composer.note} />}
      </>
    );
  return (
    <Composer
      placeholder={composer.placeholder}
      words={composer.words}
      onWords={composer.onWords}
      sendable={composer.sendable}
      onSend={composer.send}
      onAdd={composer.attach}
      onStop={composer.stop}
      stopping={composer.stopping}
      head={head}
    />
  );
}

/**
 * One agent's page: the system's header naming the agent in the ink, as
 * Messages names a conversation, since the transcript opens at its newest
 * row and its head scrolls away, its back button leading to the task, with
 * a menu that opens it on vespin.dev, over its transcript as one lazy list,
 * its head where the agent stands and the model it runs on. The transcript
 * is held live while the page is in focus, so a turn under way draws as it
 * moves, and its older pages are read as the reader scrolls up to them; one
 * that could not be read offers Try again. Each call opens in place, and
 * one the agent holds for an answer says so under its line with Deny and
 * Allow; a fold opens on what it holds, a page the agent showed opens
 * whole, and a pull request it opened opens its own screen, its card
 * offering Review, which opens it on GitHub, and Merge where it may merge
 * now, which asks first. Its composer floats over the transcript's foot:
 * while a call waits, a banner over its field answers the oldest, and says
 * that a message sent now denies it where Send would not queue it, and a
 * follow-up, with the photos the + attaches, steers the turn under way or
 * waits behind it as the member's Follow-up behavior says, and Stop stands
 * in Send's place while the agent works.
 */
export function AgentScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  useSurfaceOpen(PRODUCT_SURFACE.AGENT, id);
  const router = useRouter();
  const openLink = useOpenLink();
  const colors = useColors();
  const agent = useFollowedAgent(id);
  const pullRequests = useAgentPullRequests(id);
  const open = useMemo(
    () =>
      pullRequests
        .filter(({ state }) => state === PULL_REQUEST_STATE.OPEN)
        .map(({ number }) => number),
    [pullRequests],
  );
  const offers = usePullRequestsRead(id, open);
  // The pull request whose card's Merge is being asked about.
  const [merging, setMerging] = useState<number | undefined>(undefined);
  const asked = merging === undefined ? undefined : offers.get(merging);
  const held = useAgentTranscript(id);
  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });
  const address = useAgentAddress(id, agent?.workspaceId, agent?.planId);
  const [toggles, setToggles] = useState<TranscriptToggles>(NO_TOGGLES);
  const transcript = held?.rows;
  const status = agent?.status ?? transcript?.word?.status;
  const messages = transcript?.messages;
  const items = useMemo(
    () =>
      transcriptItems(messages ?? [], {
        writing: status !== undefined && agentStillWriting(status),
        readerId,
        toggles,
        now: Date.now(),
        pullRequests,
      }),
    [messages, status, readerId, toggles, pullRequests],
  );
  const mediaIds = useMemo(() => shownMediaIds(items), [items]);
  const approvals = useAgentApprovals(agent, id);
  const composer = useAgentComposer(id, agent, transcript, status, approvals.messageSent);
  const older = useOlderPages(id, transcript?.before);
  const retry = useTranscriptRetry(id);
  const media = useAgentMedia(id, mediaIds);
  const title = cardTitle(agent?.title ?? transcript?.word?.title ?? UNTITLED_AGENT);
  const failed = held?.failed === true || transcript?.failure !== undefined;
  const openPage = (item: Extract<TranscriptItem, { kind: typeof TRANSCRIPT_ITEM.PAGE }>) =>
    router.push({
      pathname: "/tasks/agent/[id]/page",
      params: { id, page: item.page, version: String(item.version), title: item.title },
    });
  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More">
          <Stack.Toolbar.MenuAction icon="safari" onPress={() => openInSafari(address)}>
            {OPEN_ON_WEB}
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      {/* Note that the transcript stands as the screen's root rather than in its SwiftUI host, since the list is React Native's own and sizes itself to the screen; the composer floats over its foot. */}
      <GlassDock bar={<AgentComposerBar composer={composer} banner={approvals.banner} />}>
        <AgentTranscript
          items={items}
          head={
            <AgentHead
              model={agent === undefined ? undefined : modelLabel(agent.model)}
              status={status}
            />
          }
          empty={{
            title: failed ? TRANSCRIPT_WORDS.FAILED : TRANSCRIPT_WORDS.READING,
            symbol: failed ? "exclamationmark.triangle" : "text.bubble",
            loading: !failed,
            action: failed ? { label: TRANSCRIPT_WORDS.RETRY, onPress: retry } : undefined,
          }}
          older={older}
          heldCall={approvals.heldCall}
          repository={agent?.repository}
          onOpenLink={openLink}
          onToggle={(item) => setToggles((held) => toggledAt(held, item))}
          onOpenPage={openPage}
          mediaSource={(pictureId) => media.get(pictureId)}
          onOpenElsewhere={() => openInSafari(address)}
          onOpenAddress={openInSafari}
          onOpenPullRequest={(item) =>
            router.push({
              pathname: "/tasks/agent/[id]/pull/[number]",
              params: { id, number: String(item.number) },
            })
          }
          pullRequestActs={(item) =>
            cardMergeOf(offers.get(item.number)) === undefined
              ? []
              : [{ label: MERGE_WORD, onPress: () => setMerging(item.number) }]
          }
          footRoom={DOCK_ROOM}
        />
      </GlassDock>
      {asked === undefined ? null : (
        <CardMergeAsk agentId={id} pullRequest={asked} onDone={() => setMerging(undefined)} />
      )}
    </>
  );
}

/** A page the agent showed, opened whole in the app's one web view, under the system's header naming it. */
export function AgentPageScreen() {
  const {
    id = "",
    page = "",
    version = "",
    title = "",
  } = useLocalSearchParams<{
    id: string;
    page: string;
    version: string;
    title: string;
  }>();
  const agent = useFollowedAgent(id);
  useSurfaceOpen(PRODUCT_SURFACE.PAGE, page);
  // Note that a page stands on the agent's task, read once the agent is.
  const read = usePageHtml(agent?.planId, page, Number(version));
  const named = "title" in read && read.title !== "" ? read.title : title;
  return (
    <>
      <Stack.Screen options={{ title: named }} />
      {/* Note that the page stands as the screen's root, outside its SwiftUI host, since the web view sizes itself to the screen. */}
      {"html" in read ? (
        <SealedPage html={read.html} title={named} />
      ) : (
        <Screen>
          <EmptyState
            title={"failed" in read ? PAGE_WORDS.FAILED : PAGE_WORDS.READING}
            symbol={"failed" in read ? "exclamationmark.triangle" : "macwindow"}
            loading={!("failed" in read)}
          />
        </Screen>
      )}
    </>
  );
}
