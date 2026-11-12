/**
 * use-agent.ts -- one agent as its page reads it: the agent as the task list follows it, its transcript held live while the page shows, its older pages read as the reader scrolls up to them, the pictures and recordings it showed read into what the system draws them from, and a page it showed read whole.
 *
 * The transcript is held as the panel's tab holds it: its follow
 * (`ACT_KIND.AGENTS_TRANSCRIPT`) kept open on the host while the page is in
 * focus, opened again as it breaks (`@repo/host/follow-stream`), and the
 * host lays each page it reads on the document, which the page reads with
 * `selectTranscript` as the panel reads it with `transcriptQuery`. A
 * transcript the host still holds, as one shown lately, draws at once. A
 * part its page carried cut is read whole as its call opens, as the panel's
 * fold reads it (`ACT_KIND.AGENTS_PART`).
 */

import { type AgentPartCut, WHOLE_PART, type WholePartRead } from "@repo/features/agent-parts";
import { ARCHIVE_FAILED, STOP_FAILED } from "@repo/features/agent-refusal-words";
import { TRANSCRIPT_KIND } from "@repo/features/agent-view";
import type { AgentPullRequest, AgentStatus } from "@repo/features/agent-wire";
import { CONVERSATION_MEDIA_TYPE } from "@repo/features/conversation-picture-wire";
import { agentStillWriting } from "@repo/features/task-agents-model";
import { MP4_TYPE } from "@repo/features/video-signature";
import { ACT_KIND } from "@repo/host/acts";
import type { AppHostRead, AppStateSnapshot, AppTranscript } from "@repo/host/app-state";
import {
  type FollowedAgent,
  selectFollowedAgent,
  selectTranscript,
} from "@repo/host/app-state-reads";
import { BUZZ, latestStep, NO_TOGGLES, type OlderPages, transcriptItems } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cachedVideo } from "../cached-media.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs, useHostFollow } from "../host/host-provider.js";
import { useWrite } from "../use-write.js";

/** What an agent's recordings are named under among the app's caches. */
const AGENT_MEDIA_PREFIX = "agent";

/** Says on the console a read the host refused, which the page draws without. */
function refused(what: string): (cause: unknown) => void {
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
 * The agent's latest step (`latestStep`), read off the transcript the host
 * still holds for it, as one shown lately, and never followed for it, so a
 * row's preview reads what the app already has, as the panel's card reads
 * its step from what a tab holds; none where the host holds none.
 */
export function useHeldAgentStep(agentId: string, status: AgentStatus): string | undefined {
  const select = useMemo(
    () => selectTranscript({ kind: TRANSCRIPT_KIND.AGENT, agentId }),
    [agentId],
  );

  const messages = useQuery({ ...appStateQuery, select }).data?.rows?.messages;

  return useMemo(() => {
    if (messages === undefined) return undefined;

    // Note that the reader and the pull requests are left out, since a step is never a line sent or a card opened.
    const items = transcriptItems(messages, {
      writing: agentStillWriting(status),
      readerId: undefined,
      toggles: NO_TOGGLES,
      now: Date.now(),
      pullRequests: NO_PULL_REQUESTS,
    });

    return latestStep(items);
  }, [messages, status]);
}

/** An agent row's acts, as the panel's row menu offers them: Stop while it works, and Archive, once asked, each buzzing as it lands or is refused. */
export function useAgentRowActs(): {
  readonly stop: (agentId: string) => void;
  readonly archive: (agentId: string) => void;
} {
  const acts = useHostActs();
  const write = useWrite();

  return useMemo(
    () => ({
      stop: (agentId) => {
        write(() => acts[ACT_KIND.AGENTS_STOP]({ agentId }), {
          refused: (answer) => ("failure" in answer ? STOP_FAILED : undefined),
          unanswered: STOP_FAILED,
          retry: true,
          went: BUZZ.SUCCESS,
        });
      },
      archive: (agentId) => {
        write(() => acts[ACT_KIND.AGENTS_ARCHIVE]({ agentId, archived: true }), {
          refused: (answer) => ("failure" in answer ? ARCHIVE_FAILED : undefined),
          unanswered: ARCHIVE_FAILED,
          retry: true,
          went: BUZZ.SUCCESS,
        });
      },
    }),
    [acts, write],
  );
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
      const forget = (cause: unknown) => {
        if (asked.current.agentId === agentId) held.delete(pictureId);
        refused("A picture the agent showed")(cause);
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

/** A cut part's whole read as held: the size it was asked at, and how it stands. */
interface HeldPart {
  readonly bytes: number;
  readonly read: WholePartRead;
}

/** The whole reads asked of one agent's parts, by message and then index. */
type HeldParts = ReadonlyMap<string, ReadonlyMap<number, HeldPart>>;

/** `held` with one part's read set. */
function withPart(held: HeldParts, cut: AgentPartCut, read: WholePartRead): HeldParts {
  const message = new Map(held.get(cut.messageId)).set(cut.index, { bytes: cut.bytes, read });

  return new Map(held).set(cut.messageId, message);
}

/** What the page reads a transcript's cut parts whole through. */
export interface WholeParts {
  /** How a cut part's whole read stands; none where it was not asked at the size its page says. */
  readonly read: (cut: AgentPartCut) => WholePartRead | undefined;
  /** Asks for each part not asked yet at the size its page says. */
  readonly ask: (cuts: readonly AgentPartCut[]) => void;
}

/**
 * How each part its page carried cut stands read whole, read once through
 * the host as its call opens, as the panel's fold reads it
 * (`ACT_KIND.AGENTS_PART`). A read is held as of the size its page said, so
 * a part that grew since is read again, and one that failed stays failed,
 * its two ends drawn. A read that lands once another agent's page stands is
 * let go.
 */
export function useWholeParts(agentId: string): WholeParts {
  const acts = useHostActs();

  // Note that the reads are held apart from what is drawn, so an ask made twice before the first is drawn is sent once.
  const held = useRef<{ readonly agentId: string; parts: HeldParts }>({
    agentId,
    parts: new Map(),
  });

  const [drawn, setDrawn] = useState<{ readonly agentId: string; readonly parts: HeldParts }>({
    agentId,
    parts: new Map(),
  });

  const ask = useCallback(
    (cuts: readonly AgentPartCut[]) => {
      // Note that the reads of another agent's page are let go as this one's are first asked.
      if (held.current.agentId !== agentId) held.current = { agentId, parts: new Map() };

      const settle = (cut: AgentPartCut, read: WholePartRead) => {
        if (held.current.agentId !== agentId) return;
        held.current.parts = withPart(held.current.parts, cut, read);
        setDrawn({ agentId, parts: held.current.parts });
      };

      for (const cut of cuts) {
        if (held.current.parts.get(cut.messageId)?.get(cut.index)?.bytes === cut.bytes) continue;
        settle(cut, { state: WHOLE_PART.READING });

        acts[ACT_KIND.AGENTS_PART]({ agentId, messageId: cut.messageId, index: cut.index }).then(
          (answer) =>
            settle(
              cut,
              "part" in answer
                ? { state: WHOLE_PART.WHOLE, part: answer.part }
                : { state: WHOLE_PART.FAILED },
            ),
          (cause: unknown) => {
            refused("A part of the transcript")(cause);
            settle(cut, { state: WHOLE_PART.FAILED });
          },
        );
      }
    },
    [acts, agentId],
  );

  const parts = drawn.agentId === agentId ? drawn.parts : undefined;

  const read = useCallback(
    (cut: AgentPartCut) => {
      const part = parts?.get(cut.messageId)?.get(cut.index);

      return part?.bytes === cut.bytes ? part.read : undefined;
    },
    [parts],
  );

  return useMemo(() => ({ read, ask }), [read, ask]);
}

/** How a page's read stands: on its way, read with its HTML, or not answered. */
export type PageRead =
  | { readonly reading: true }
  | { readonly html: string; readonly title: string }
  | { readonly failed: true };

/** One version of a page the agent showed on its task, read whole once through the host (`ACT_KIND.TASKS_PAGE_HTML`) as its frame reads it on the Mac; reading until the task is known. */
export function usePageHtml(taskId: string | undefined, pageId: string, version: number): PageRead {
  const acts = useHostActs();
  const [read, setRead] = useState<PageRead>({ reading: true });
  useEffect(() => {
    let current = true;
    setRead({ reading: true });

    if (taskId === undefined) return;
    acts[ACT_KIND.TASKS_PAGE_HTML]({ taskId, pageId, version }).then(
      (answer) => {
        if (!current) return;
        setRead(
          "page" in answer
            ? { html: answer.page.html, title: answer.page.title }
            : { failed: true },
        );
      },
      (cause: unknown) => {
        refused("The page")(cause);

        if (current) setRead({ failed: true });
      },
    );

    return () => {
      current = false;
    };
  }, [acts, taskId, pageId, version]);

  return read;
}

/** The older read asked last: of which agent, below where, and whether it failed. */
interface OlderAsk {
  readonly agentId: string;
  readonly before: string;
  readonly failed: boolean;
}

/**
 * The pages of the agent's transcript older than the oldest message the host
 * holds, read one at a time as the reader scrolls up to it, as the panel's
 * tab reads them (`ACT_KIND.AGENTS_TRANSCRIPT_OLDER`): the host lays each
 * before the messages it holds while they still begin where it was asked,
 * which moves where the next is read below and ends the read. A read that
 * did not answer says so until Try again asks it again, which a scroll never
 * does, even one that lands before the failure is drawn; one the host did not lay,
 * since newer messages took their place meanwhile, may be asked again at
 * once, as may one whose cursor comes back after a rewind. None where
 * nothing older stands.
 */
export function useOlderPages(agentId: string, before: string | undefined): OlderPages | undefined {
  const acts = useHostActs();
  const [asked, setAsked] = useState<OlderAsk | undefined>(undefined);
  // Note that the read out is held apart from what is drawn, since the list may ask twice before it draws the first ask.
  const out = useRef<OlderAsk | undefined>(undefined);

  const read = useCallback(
    (again: boolean) => {
      if (before === undefined) return;
      const held = out.current;

      // Note that an ask out is never asked twice, and one that failed is asked again by Try again alone.
      if (
        held !== undefined &&
        held.agentId === agentId &&
        held.before === before &&
        (!held.failed || !again)
      ) {
        return;
      }

      const ask: OlderAsk = { agentId, before, failed: false };
      out.current = ask;
      setAsked(ask);

      // An answer settles the ask it answers alone, never a newer one.
      const settle = (next: OlderAsk | undefined) => {
        if (out.current !== ask) return;
        out.current = next;
        setAsked(next);
      };

      acts[ACT_KIND.AGENTS_TRANSCRIPT_OLDER]({ kind: TRANSCRIPT_KIND.AGENT, agentId, before }).then(
        (answer) => {
          if ("failure" in answer) settle({ ...ask, failed: true });
          else if (!answer.landed) settle(undefined);
        },
        (cause: unknown) => {
          refused("An older page of the transcript")(cause);
          settle({ ...ask, failed: true });
        },
      );
    },
    [acts, agentId, before],
  );

  // Note that an ask that landed is let go once the cursor moves past it, and only then, so a rewind that brings the cursor back reads it anew while the landing still holds off a second read.
  useEffect(() => {
    const held = out.current;

    if (held === undefined || held.failed) return;

    if (held.agentId === agentId && held.before === before) return;
    out.current = undefined;
    setAsked(undefined);
  }, [agentId, before]);

  if (before === undefined) return undefined;
  const here = asked !== undefined && asked.agentId === agentId && asked.before === before;

  return {
    reading: here && !asked.failed,
    failed: here && asked.failed,
    onRead: () => read(false),
    onRetry: () => read(true),
  };
}

/** Reads the agent's transcript anew where it could not be read, as the panel's Try again does (`ACT_KIND.AGENTS_TRANSCRIPT_RETRY`). */
export function useTranscriptRetry(agentId: string): () => void {
  const acts = useHostActs();

  return useCallback(() => {
    acts[ACT_KIND.AGENTS_TRANSCRIPT_RETRY]({ kind: TRANSCRIPT_KIND.AGENT, agentId }).catch(
      refused("Reading the transcript again"),
    );
  }, [acts, agentId]);
}
