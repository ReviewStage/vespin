/**
 * use-agent.ts -- one agent as its page reads it: the agent as the task list follows it, its transcript held live while the page shows, the pictures and recordings it showed read into what the system draws them from, and a page it showed read whole.
 *
 * The transcript is held as the panel's tab holds it: its follow
 * (`ACT_KIND.AGENTS_TRANSCRIPT`) kept open on the host while the page is in
 * focus, opened again as it breaks (`@repo/host/follow-stream`), and the
 * host lays each page it reads on the document, which the page reads with
 * `selectTranscript` as the panel reads it with `transcriptQuery`. A
 * transcript the host still holds, as one shown lately, draws at once.
 */

import { TRANSCRIPT_KIND } from "@repo/features/agent-view";
import type { AgentPullRequest } from "@repo/features/agent-wire";
import { CONVERSATION_MEDIA_TYPE } from "@repo/features/conversation-picture-wire";
import { MP4_TYPE } from "@repo/features/video-signature";
import { ACT_KIND } from "@repo/host/acts";
import type { AppHostRead, AppStateSnapshot, AppTranscript } from "@repo/host/app-state";
import {
  type FollowedAgent,
  selectFollowedAgent,
  selectTranscript,
} from "@repo/host/app-state-reads";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cachedVideo } from "../cached-media.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs, useHostFollow } from "../host/host-provider.js";

/** What an agent's recordings are named under among the app's caches. */
const AGENT_MEDIA_PREFIX = "agent";

/** Says on the console a read the host refused, which the page draws without. */
function refused(what: string): (error: unknown) => void {
  return (error) => console.error(`${what} did not land.`, error);
}

/** The agent as the task list follows it, by its id; none until the list holds it. */
export function useFollowedAgent(agentId: string): FollowedAgent | undefined {
  const select = useMemo(() => selectFollowedAgent(agentId), [agentId]);
  return useQuery({ ...appStateQuery, select }).data;
}

/** No pull requests, held as one value so a list that holds none reads the same each time. */
const NO_PULL_REQUESTS: readonly AgentPullRequest[] = [];

/** The pull requests the agent opened, as the task list holds them now; none before it holds them. */
export function useAgentPullRequests(agentId: string): readonly AgentPullRequest[] {
  const select = useMemo(
    () => (state: AppStateSnapshot) =>
      (state.tasks.agentPullRequests ?? [])
        .filter((each) => each.agentId === agentId)
        .map(({ pullRequest }) => pullRequest),
    [agentId],
  );
  return useQuery({ ...appStateQuery, select }).data ?? NO_PULL_REQUESTS;
}

/**
 * The agent's own transcript as the host holds it, held followed while the
 * page is in focus and let go as it leaves, as the panel's tab holds its
 * own while it shows; none before the host holds it.
 */
export function useAgentTranscript(agentId: string): AppHostRead<AppTranscript> | undefined {
  const acts = useHostActs();
  const follow = useHostFollow();
  useFocusEffect(
    useCallback(
      () =>
        follow(
          () => acts[ACT_KIND.AGENTS_TRANSCRIPT]({ kind: TRANSCRIPT_KIND.AGENT, agentId }),
          () => undefined,
        ),
      [acts, follow, agentId],
    ),
  );
  const select = useMemo(
    () => selectTranscript({ kind: TRANSCRIPT_KIND.AGENT, agentId }),
    [agentId],
  );
  return useQuery({ ...appStateQuery, select }).data;
}

/**
 * What each picture and recording the agent showed is drawn from, by its
 * id, read once through the host as the panel reads one
 * (`ACT_KIND.AGENTS_PICTURE`): a picture as a `data:` address, and a
 * recording, its MP4 copy where the service kept one, as a file of the
 * app's caches, written whole before it is drawn, since the system's player
 * reads a file; one on its way, or that could not be read, is absent. Note
 * that each is asked for once while the agent's page stands, however often
 * the transcript moves, and that one whose read failed is asked for again on
 * its next change.
 */
export function useAgentMedia(
  agentId: string,
  ids: readonly string[],
): ReadonlyMap<string, string> {
  const acts = useHostActs();
  const [sources, setSources] = useState<ReadonlyMap<string, string>>(new Map());
  // The agent the pictures were asked for, and the pictures asked for of it.
  const asked = useRef<{ readonly agentId: string; readonly ids: Set<string> }>({
    agentId,
    ids: new Set(),
  });
  useEffect(() => {
    if (asked.current.agentId !== agentId) {
      asked.current = { agentId, ids: new Set() };
      setSources(new Map());
    }
    const held = asked.current.ids;
    for (const pictureId of ids) {
      if (held.has(pictureId)) continue;
      held.add(pictureId);
      // A read that fails is forgotten, so the transcript's next change asks for it again.
      const forget = (error: unknown) => {
        if (asked.current.agentId === agentId) held.delete(pictureId);
        refused("A picture the agent showed")(error);
      };
      // Note that a recording is asked for as its MP4 copy, which the system's player plays, where the service kept one.
      acts[ACT_KIND.AGENTS_PICTURE]({ agentId, pictureId, playable: MP4_TYPE })
        .then(async (read) => {
          if (!("base64" in read)) throw new Error(`The picture was not read: ${read.failure}.`);
          const source =
            read.contentType === CONVERSATION_MEDIA_TYPE.WEBM || read.contentType === MP4_TYPE
              ? await cachedVideo(AGENT_MEDIA_PREFIX, pictureId, read.contentType, read.base64)
              : `data:${read.contentType};base64,${read.base64}`;
          // A read that lands once another agent's page stands is that agent's no longer.
          if (asked.current.agentId !== agentId) return;
          setSources((shown) => new Map(shown).set(pictureId, source));
        })
        .catch(forget);
    }
  }, [acts, agentId, ids]);
  return sources;
}

/** Where a page stands: the task it was shown on, or the agent on no task that showed it. */
export type PagePlace = { readonly taskId: string } | { readonly agentId: string };

/** How a page's read stands: on its way, read with its HTML, or not answered. */
export type PageRead =
  | { readonly reading: true }
  | { readonly html: string; readonly title: string }
  | { readonly failed: true };

/** One version of a page the agent showed, read whole once through the host (`ACT_KIND.TASKS_PAGE_HTML`) as its frame reads it on the Mac. */
export function usePageHtml(place: PagePlace, pageId: string, version: number): PageRead {
  const acts = useHostActs();
  const [read, setRead] = useState<PageRead>({ reading: true });
  const taskId = "taskId" in place ? place.taskId : undefined;
  const agentId = "agentId" in place ? place.agentId : undefined;
  useEffect(() => {
    let current = true;
    setRead({ reading: true });
    const where = taskId === undefined ? { agentId: agentId ?? "" } : { taskId };
    acts[ACT_KIND.TASKS_PAGE_HTML]({ ...where, pageId, version }).then(
      (answer) => {
        if (!current) return;
        setRead(
          "page" in answer
            ? { html: answer.page.html, title: answer.page.title }
            : { failed: true },
        );
      },
      (error: unknown) => {
        refused("The page")(error);
        if (current) setRead({ failed: true });
      },
    );
    return () => {
      current = false;
    };
  }, [acts, taskId, agentId, pageId, version]);
  return read;
}
