// agent-screens.tsx -- one agent's page, its transcript live under the system's header, and a page it showed, opened whole.

import { iosAppRouteOf } from "@repo/features/ios-app-links";
import { LINK_DESTINATION, linkOf } from "@repo/features/link-grammar";
import { modelLabel } from "@repo/features/model-label";
import { cardTitle } from "@repo/features/plain-words";
import { agentStillWriting } from "@repo/features/task-agents-model";
import { selectInboxReader, selectTasks, selectWorkspaces } from "@repo/host/app-state-reads";
import {
  AgentHead,
  AgentTranscript,
  BAR_TITLE,
  EmptyState,
  type MarkdownPlace,
  NO_TOGGLES,
  PATH_PART,
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
import { openURL } from "expo-linking";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import {
  type PagePlace,
  useAgentMedia,
  useAgentPullRequests,
  useAgentTranscript,
  useFollowedAgent,
  usePageHtml,
} from "../agents/use-agent.js";
import { appStateQuery } from "../host/app-state-query.js";

/** What an agent is called where the list holds no title for it yet. */
const UNTITLED_AGENT = "Agent";

/** What the page's menu opens the agent on. */
const OPEN_ON_WEB = "Open on vespin.dev";

/** What stands in the transcript's place while it is read, and where it could not be. */
const TRANSCRIPT_WORDS = {
  READING: "Reading the transcript",
  FAILED: "The transcript could not be read.",
} as const;

/** What stands in a page's place while it is read, and where it could not be. */
const PAGE_WORDS = {
  READING: "Reading the page",
  FAILED: "The page could not be read.",
} as const;

function opened(address: string): void {
  openURL(address).catch((error: unknown) => console.error("The address did not open.", error));
}

/** A link a message names opened where it goes: a place the app draws on its own screen, and anything else in Safari. */
function useOpenPlace(): (place: MarkdownPlace) => void {
  const router = useRouter();
  return (place) => {
    const route = iosAppRouteOf(place.place);
    if (route === undefined) opened(place.href);
    else router.push(route);
  };
}

/** The name of the task the agent works on, by its id, as the list holds it; none for an agent on no task, or before the list holds it. */
function useTaskName(taskId: string | null | undefined): string | undefined {
  const { data } = useQuery({
    ...appStateQuery,
    select: (state) => selectTasks(state).tasks.find(({ id }) => id === taskId)?.name,
  });
  return data;
}

/** The agent's address on vespin.dev, under its workspace, its task's where it has one. */
function useAgentAddress(
  agentId: string,
  workspaceId: string | undefined,
  taskId: string | null | undefined,
): string {
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data ?? [];
  const workspace = workspaces.find(({ id }) => id === workspaceId);
  const place =
    taskId === null || taskId === undefined
      ? { kind: LINK_DESTINATION.AGENT, agentId }
      : { kind: LINK_DESTINATION.AGENT, planId: taskId, agentId };
  return linkOf(place, workspace?.slug ?? workspace?.id ?? workspaceId ?? "");
}

/**
 * One agent's page: the system's header holding its path, the task it works
 * on and the agent, small and muted, with a menu that opens it on
 * vespin.dev, over its transcript as one lazy list, its head the agent's
 * title, where it stands, and the model it runs on. The
 * transcript is held live while the page is in focus, so a turn under way
 * draws as it moves; each call opens in place, a fold opens on what it
 * holds, a page the agent showed opens whole, and a pull request it opened
 * opens on GitHub.
 */
export function AgentScreen() {
  const { id = "" } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const openPlace = useOpenPlace();
  const colors = useColors();
  const agent = useFollowedAgent(id);
  const pullRequests = useAgentPullRequests(id);
  const held = useAgentTranscript(id);
  const { data: readerId } = useQuery({ ...appStateQuery, select: selectInboxReader });
  const taskName = useTaskName(agent?.planId);
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
          title: [...(taskName === undefined ? [] : [taskName]), title].join(PATH_PART),
          headerTitleStyle: { ...BAR_TITLE.PATH, color: colors.TEXT_MUTED },
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Menu icon="ellipsis" accessibilityLabel="More">
          <Stack.Toolbar.MenuAction icon="safari" onPress={() => opened(address)}>
            {OPEN_ON_WEB}
          </Stack.Toolbar.MenuAction>
        </Stack.Toolbar.Menu>
      </Stack.Toolbar>
      {/* Note that the transcript stands as the screen's root rather than in its SwiftUI host, since the list is React Native's own and sizes itself to the screen. */}
      <AgentTranscript
        items={items}
        head={
          <AgentHead
            title={title}
            model={agent === undefined ? undefined : modelLabel(agent.model)}
            status={status}
          />
        }
        empty={
          <EmptyState
            title={failed ? TRANSCRIPT_WORDS.FAILED : TRANSCRIPT_WORDS.READING}
            symbol={failed ? "exclamationmark.triangle" : "text.bubble"}
          />
        }
        repository={agent?.repository}
        onOpenPlace={openPlace}
        onToggle={(item) => setToggles((held) => toggledAt(held, item))}
        onOpenPage={openPage}
        mediaSource={(pictureId) => media.get(pictureId)}
        onOpenElsewhere={() => opened(address)}
        onOpenAddress={opened}
      />
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
  // Note that a page stands on the agent's task, or on the agent where it works on none.
  const place: PagePlace =
    agent?.planId === null || agent?.planId === undefined
      ? { agentId: id }
      : { taskId: agent.planId };
  const read = usePageHtml(place, page, Number(version));
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
          />
        </Screen>
      )}
    </>
  );
}
