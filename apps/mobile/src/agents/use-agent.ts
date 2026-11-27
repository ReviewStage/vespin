/**
 * use-agent.ts -- one agent as its page reads it: the agent as the task list follows it, its transcript held live while the page shows, a Manager's chat held beside it, its older pages read as the reader scrolls up to them, the pictures and recordings it showed read into what the system draws them from, and a page it showed read whole.
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

import { signedInAccountId } from "@repo/credentials/snapshot";
import { type AgentPartCut, WHOLE_PART, type WholePartRead } from "@repo/features/agent-parts";
import {
  ARCHIVE_FAILED,
  ARCHIVE_NOT_READY,
  DELETE_FAILED,
  PIN_FAILED,
  RENAME_FAILED,
  STOP_FAILED,
  UNARCHIVE_FAILED,
} from "@repo/features/agent-refusal-words";
import {
  AGENT_CALL_FAILURE,
  type AgentPageAnswerView,
  type AgentTranscriptOlderAnswer,
  TRANSCRIPT_KIND,
} from "@repo/features/agent-view";
import {
  type AgentPullRequest,
  type AgentStatus,
  base64Bytes,
  type ListedAgent,
  listedAgentOfPage,
} from "@repo/features/agent-wire";
import { PRODUCT_PICTURE_FROM, PRODUCT_PICTURE_KIND } from "@repo/features/analytics";
import { isPlayedType } from "@repo/features/conversation-picture-wire";
import { MANAGER_FACE_FAILED, type ManagerFace } from "@repo/features/manager-face";
import { agentStillWriting } from "@repo/features/task-agents-model";
import { TASKS_READ } from "@repo/features/tasks-view";
import { MP4_TYPE } from "@repo/features/video-signature";
import { ACT_KIND } from "@repo/host/acts";
import type {
  AppHostRead,
  AppManagerChat,
  AppStateSnapshot,
  AppTranscript,
} from "@repo/host/app-state";
import {
  type FollowedAgent,
  selectManagerChat,
  selectTranscript,
} from "@repo/host/app-state-reads";
import {
  BUZZ,
  latestStep,
  type MediaReads,
  mediaReads,
  NO_TOGGLES,
  type OlderPages,
  type ShownFile,
  transcriptItems,
} from "@repo/ui-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { randomUUID } from "expo-crypto";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  cachedFile,
  cachedPicture,
  cachedPlayed,
  downloadedMedia,
  KEPT_MEDIA,
  keptMedia,
} from "../cached-media.js";
import { appStateQuery } from "../host/app-state-query.js";
import {
  useHostActs,
  useHostFollow,
  useTaskListCollections,
  useTaskListRow,
} from "../host/host-provider.js";
import { type PictureShown, usePictureShownCount } from "../picture-shown.js";
import { useWrite, WRITE_SUBJECT } from "../use-write.js";

/** What an agent's recordings are named under among the app's caches. */
const AGENT_MEDIA_PREFIX = "agent";

/** No media read yet, held as one value so a page that holds none reads the same each time. */
const NO_SOURCES: ReadonlyMap<string, string | null> = new Map();

/** The most pictures and recordings an agent's page keeps drawn from, those its rows on screen ask for among them; the oldest beyond it are let go. */
const MEDIA_KEPT = 24;

/** What a file a member sent an agent is written under in the app's caches, beside its line's message. */
const SENT_FILE_PREFIX = "sent";

/** Where each file the agent's sent lines carried was written, by the line's message, then the file's place on it; `null` where it could not be. */
type SentFiles = ReadonlyMap<string, ReadonlyMap<string, string | null>>;

/** Where a sent line's file was written, by the line's message and the file's place on it, and what writes one again that could not be. */
interface SentFileSources {
  readonly source: (message: string, key: string) => string | null | undefined;
  readonly retry: (message: string, key: string) => void;
}

/** Says on the console a read the host refused, which the page draws without. */
function refused(what: string): (cause: unknown) => void {
  return (error) => console.error(`${what} did not land.`, error);
}

/** The key one agent's own read is held under, by its id. */
const AGENT_PAGE_QUERY = "agent-page";

/** Whether the host has read the task list once, so an agent it doesn't hold is one it never will, rather than one on its way. */
function selectTasksRead(state: AppStateSnapshot): boolean {
  return state.tasks.listStatus === TASKS_READ.READY;
}

/** The account signed in, whose reads an agent's own read is kept under; none while signed out. */
function selectAccountId(state: AppStateSnapshot): string | undefined {
  return signedInAccountId(state.account);
}

/**
 * One agent's own read (`AGENTS_PAGE`), as the panel's `agentPageQueryOptions`
 * asks it: every ask reads afresh, and a failure is never tried again on its
 * own. Note that it's kept under the account that read it, because the
 * session's one query client outlives a sign-out, and another account must
 * never be shown a page read for the last.
 */
function agentPageQuery(acts: ReturnType<typeof useHostActs>, accountId: string, agentId: string) {
  return {
    queryKey: [AGENT_PAGE_QUERY, accountId, agentId],
    queryFn: () => acts[ACT_KIND.AGENTS_PAGE]({ agentId }),
    retry: false,
  } as const;
}

/** The agent an answer to its own read carries, in the list's shape; none where it could not be read. */
function agentOfAnswer(answer: AgentPageAnswerView): ListedAgent | undefined {
  return "failure" in answer ? undefined : listedAgentOfPage(answer.agent);
}

/** The agent as the task list follows it, by its id; none until the list holds it. */
export function useFollowedAgent(agentId: string): FollowedAgent | undefined {
  return useTaskListRow(useTaskListCollections().agents, agentId);
}

/**
 * The agent a page draws, by its id: as the task list follows it, or, for
 * one the list doesn't hold, such as an archived agent or a teammate's a
 * link names, as its own read answered once the list was read without it,
 * as the panel's agent page reads one. Note that such a read is taken once
 * and followed by nothing, so it names the agent and its place, while what
 * acts on the agent or follows its turn reads the list alone
 * (`useFollowedAgent`) and its status is the transcript's to say.
 */
export function useShownAgent(agentId: string): FollowedAgent | undefined {
  const acts = useHostActs();
  const listed = useFollowedAgent(agentId);
  const { data: read = false } = useQuery({ ...appStateQuery, select: selectTasksRead });
  const { data: accountId } = useQuery({ ...appStateQuery, select: selectAccountId });

  const page = useQuery({
    ...agentPageQuery(acts, accountId ?? "", agentId),
    enabled: read && listed === undefined && agentId !== "" && accountId !== undefined,
    select: agentOfAnswer,
  }).data;

  return listed ?? page;
}

/** Reads one agent afresh by its id, whether the list holds it or not; none where it could not be read. */
export function useReadAgent(): (agentId: string) => Promise<ListedAgent | undefined> {
  const acts = useHostActs();
  const queryClient = useQueryClient();
  const { data: accountId } = useQuery({ ...appStateQuery, select: selectAccountId });

  return useCallback(
    (agentId: string) =>
      accountId === undefined
        ? Promise.resolve(undefined)
        : queryClient
            .fetchQuery(agentPageQuery(acts, accountId, agentId))
            .then(agentOfAnswer, () => undefined),
    [acts, accountId, queryClient],
  );
}

/** No pull requests, held as one value so a list that holds none reads the same each time. */
const NO_PULL_REQUESTS: readonly AgentPullRequest[] = [];

/** The pull requests the agent opened, as the task list holds them now; none before it holds them. */
export function useAgentPullRequests(agentId: string): readonly AgentPullRequest[] {
  const listed = useTaskListRow(useTaskListCollections().agentPullRequests, agentId);

  return useMemo(() => (listed === undefined ? NO_PULL_REQUESTS : [listed.pullRequest]), [listed]);
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

/** An agent row's acts, as the panel's row menu offers them: Stop while it works, Rename, a Manager's Change face, Archive and Permanently delete, each once asked, and Pin or Unpin, each buzzing as it lands or is refused. */
export function useAgentRowActs(): {
  readonly stop: (agentId: string) => void;
  readonly rename: (agentId: string, title: string) => void;
  readonly changeFace: (agentId: string, face: ManagerFace) => void;
  readonly archive: (agentId: string) => void;
  readonly unarchive: (agentId: string) => void;
  readonly remove: (agentId: string) => void;
  readonly pin: (agentId: string, pinned: boolean) => void;
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
      rename: (agentId, title) => {
        write(() => acts[ACT_KIND.AGENTS_RENAME]({ agentId, title }), {
          refused: (answer) => ("failure" in answer ? RENAME_FAILED : undefined),
          unanswered: RENAME_FAILED,
          // Note that the name is its agent's subject, so a later Rename holds off a stale Try again.
          subject: { kind: WRITE_SUBJECT.AGENT_NAME, id: agentId },
          retry: true,
          went: BUZZ.SUCCESS,
        });
      },
      // Note that the host draws the face at once and takes it back should the service refuse it, so a refusal is said in the failure notice, the menu being gone, as the panel says it in a toast.
      changeFace: (agentId, face) => {
        write(() => acts[ACT_KIND.AGENTS_FACE]({ agentId, face }), {
          refused: (answer) => ("failure" in answer ? MANAGER_FACE_FAILED : undefined),
          unanswered: MANAGER_FACE_FAILED,
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
      unarchive: (agentId) => {
        write(() => acts[ACT_KIND.AGENTS_ARCHIVE]({ agentId, archived: false }), {
          refused: (answer) => ("failure" in answer ? UNARCHIVE_FAILED : undefined),
          unanswered: UNARCHIVE_FAILED,
          retry: true,
          went: BUZZ.SUCCESS,
        });
      },
      remove: (agentId) => {
        write(() => acts[ACT_KIND.AGENTS_DELETE]({ agentId }), {
          // Note that an agent still starting its turn cannot be deleted yet, which the panel says in its own words.
          refused: (answer) =>
            "failure" in answer
              ? answer.failure === AGENT_CALL_FAILURE.AGENT_NOT_READY
                ? ARCHIVE_NOT_READY
                : DELETE_FAILED
              : undefined,
          unanswered: DELETE_FAILED,
          retry: true,
          went: BUZZ.SUCCESS,
        });
      },
      pin: (agentId, pinned) => {
        const failed = pinned ? PIN_FAILED.PIN : PIN_FAILED.UNPIN;
        write(() => acts[ACT_KIND.AGENTS_PIN]({ agentId, pinned }), {
          refused: (answer) => ("failure" in answer ? failed : undefined),
          unanswered: failed,
          // Note that the pin is its agent's subject, so a later Pin or Unpin holds off a stale Try again.
          subject: { kind: WRITE_SUBJECT.AGENT_PIN, id: agentId },
          retry: true,
          went: BUZZ.SELECTION,
        });
      },
    }),
    [acts, write],
  );
}

/** Whose transcript a page reads: the agent's own, or, naming the delegation call that started one, a worker's under it, as the panel's tab names it (`TRANSCRIPT_KIND`). */
function transcriptKey(agentId: string, callId: string | undefined) {
  return callId === undefined
    ? { kind: TRANSCRIPT_KIND.AGENT, agentId }
    : { kind: TRANSCRIPT_KIND.AGENT, agentId, callId };
}

/**
 * The agent's own transcript as the host holds it, or one of its workers'
 * where `callId` names the delegation that started it, held followed while
 * the page is in focus and let go as it leaves, as the panel's tab holds its
 * own while it shows; none before the host holds it.
 */
export function useAgentTranscript(
  agentId: string,
  callId?: string,
): AppHostRead<AppTranscript> | undefined {
  const acts = useHostActs();
  const follow = useHostFollow();
  useFocusEffect(
    useCallback(
      () =>
        follow(
          () => acts[ACT_KIND.AGENTS_TRANSCRIPT](transcriptKey(agentId, callId)),
          () => undefined,
        ),
      [acts, follow, agentId, callId],
    ),
  );

  const select = useMemo(() => selectTranscript(transcriptKey(agentId, callId)), [agentId, callId]);

  return useQuery({ ...appStateQuery, select }).data;
}

/**
 * The agent's own transcript as the host still holds it, never followed for
 * it, so a page under the agent, such as a worker's, reads where each of its
 * workers stands from what the agent's page already holds; none where the
 * host holds none.
 */
export function useHeldTranscript(agentId: string): AppHostRead<AppTranscript> | undefined {
  const select = useMemo(() => selectTranscript(transcriptKey(agentId, undefined)), [agentId]);

  return useQuery({ ...appStateQuery, select }).data;
}

/**
 * A Manager's chat as the host holds it (`ACT_KIND.AGENTS_MANAGER_CHAT_FOLLOW`),
 * held followed while the page is in focus and shows a Manager, as the
 * transcript is held; none before the host holds it, or for an agent that is
 * no Manager.
 */
export function useManagerChat(
  agentId: string,
  manager: boolean,
): AppHostRead<AppManagerChat> | undefined {
  const acts = useHostActs();
  const follow = useHostFollow();
  useFocusEffect(
    useCallback(
      () =>
        manager
          ? follow(
              () => acts[ACT_KIND.AGENTS_MANAGER_CHAT_FOLLOW]({ agentId }),
              () => undefined,
            )
          : undefined,
      [acts, follow, agentId, manager],
    ),
  );

  const select = useMemo(() => selectManagerChat(agentId), [agentId]);
  const held = useQuery({ ...appStateQuery, select }).data;

  return manager ? held : undefined;
}

/** Reads a Manager's chat again after its read failed, as Try again asks it. */
export function useManagerChatRetry(agentId: string): () => void {
  const acts = useHostActs();

  return useCallback(() => {
    acts[ACT_KIND.AGENTS_MANAGER_CHAT_RETRY]({ agentId }).catch(
      refused("Reading the Manager's chat again"),
    );
  }, [acts, agentId]);
}

/** Waits `ms` milliseconds, as a failed media read pauses before it is tried again. */
function paused(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Says a media read that failed in one line of words, the cause's own among
 * them, since React Native writes a console error to the device's log
 * (`com.facebook.react.log`, category `javascript`) in a release build too,
 * and an error handed beside the words may reach it without its message.
 */
function mediaReadFailed(agentId: string, pictureId: string, cause: unknown, again: boolean): void {
  const why = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);

  const next = again
    ? "it is tried again shortly"
    : "it is read again on the transcript's next change";

  console.error(
    `A picture the agent showed did not land (agent ${agentId}, picture ${pictureId}); ${next}. ${why}`,
  );
}

/** One picture, recording, or sound clip the agent showed, or a worker of it where `callId` names the delegation that started it, read through the host into what it is drawn from. */
async function agentMediaSource(
  acts: ReturnType<typeof useHostActs>,
  agentId: string,
  pictureId: string,
  shown: PictureShown,
  callId: string | undefined,
): Promise<string> {
  const picture = callId === undefined ? { agentId, pictureId } : { agentId, pictureId, callId };
  const askedAt = performance.now();
  // Note that one shown before draws from the file its first read wrote, asking the host nothing.
  const kept = keptMedia(AGENT_MEDIA_PREFIX, pictureId);

  if (kept !== undefined) {
    if (kept.kind === KEPT_MEDIA.PICTURE) shown(PRODUCT_PICTURE_FROM.KEPT, askedAt, kept.bytes);

    return kept.uri;
  }

  // Note that one read the first time is downloaded by the phone straight into its file, its bytes never crossing into JavaScript; a host that downloads none, or a download that read nothing, reads it as bytes below.
  const downloaded = await downloadedMedia(AGENT_MEDIA_PREFIX, pictureId, randomUUID(), (path) =>
    acts[ACT_KIND.AGENTS_PICTURE_FILE]({ ...picture, playable: MP4_TYPE, path }).then((answer) =>
      "contentType" in answer ? answer.contentType : undefined,
    ),
  );

  if (downloaded !== undefined) {
    if (downloaded.kind === KEPT_MEDIA.PICTURE)
      shown(PRODUCT_PICTURE_FROM.DOWNLOADED, askedAt, downloaded.bytes);

    return downloaded.uri;
  }

  // Note that a recording, or an Ogg clip, is asked for as its MP4 copy, which the system's player plays, where the service kept one; anything else is answered as it is.
  const read = await acts[ACT_KIND.AGENTS_PICTURE]({ ...picture, playable: MP4_TYPE });

  if (!("base64" in read)) throw new Error(`The picture was not read: ${read.failure}.`);

  if (isPlayedType(read.contentType)) {
    return cachedPlayed(AGENT_MEDIA_PREFIX, pictureId, read.contentType, read.base64);
  }

  // Note that a picture is written to the app's caches and drawn from its file, so the page holds its address rather than its bytes, and the system's image cache holds what it decodes; a type no file can be named for keeps its `data:` address.
  const written = await cachedPicture(AGENT_MEDIA_PREFIX, pictureId, read.contentType, read.base64);

  shown(PRODUCT_PICTURE_FROM.READ, askedAt, base64Bytes(read.base64));

  return written ?? `data:${read.contentType};base64,${read.base64}`;
}

/** What an agent's pictures and recordings are drawn from, by id, and what reads one that failed again. */
export interface AgentMedia {
  readonly sources: ReadonlyMap<string, string | null>;
  readonly retry: (pictureId: string) => void;
}

/**
 * What each picture, recording, and sound clip the agent showed is drawn
 * from, by its id: the file an earlier read wrote under the app's caches,
 * this launch's or one before it (`keptMedia`), or else read once through
 * the host as the panel reads one (`ACT_KIND.AGENTS_PICTURE`), a worker's
 * under its agent where `callId` names the delegation that started it: a picture
 * written to a file of the caches, or a `data:` address where its type names
 * none, and a
 * recording or a clip, its MP4 copy where the service kept one, as a file of
 * the app's caches, written whole before it is drawn, since the system's
 * player reads a file; one on its way is absent, and one whose every try
 * failed is `null`, which its Try again (`retry`) reads again. Note
 * that each is asked for once while the agent's page stands, however often
 * the transcript moves; that one whose read failed is tried again on its
 * own a few times after a pause (`mediaReads`), since a transcript that
 * never moves, as the fixture's, would never ask again, and then on the
 * transcript's next change; and that each failure is written to the
 * device's log.
 */
export function useAgentMedia(
  agentId: string,
  ids: readonly string[],
  callId?: string,
): AgentMedia {
  const acts = useHostActs();
  const pictureShown = usePictureShownCount(PRODUCT_PICTURE_KIND.AGENT);

  const [shown, setShown] = useState<{
    readonly agentId: string;
    readonly sources: ReadonlyMap<string, string | null>;
  }>({ agentId, sources: new Map() });

  // Each source standing for the agent, `source` for an id, or none to stand it on its way again.
  const stand = (pictureId: string, source: string | null | undefined) =>
    setShown((held) => {
      const sources = new Map(held.agentId === agentId ? held.sources : undefined);

      if (source === undefined) sources.delete(pictureId);
      else sources.set(pictureId, source);

      return { agentId, sources };
    });

  const [reads, setReads] = useState<MediaReads | undefined>(undefined);

  // Note that the agent's reads stand while its page does, and are let go as another agent's page stands or the page leaves, so none that lands after is drawn.
  useEffect(() => {
    const standing = mediaReads({
      read: (pictureId) => agentMediaSource(acts, agentId, pictureId, pictureShown, callId),
      landed: (pictureId, source) => stand(pictureId, source),
      // Note that a read whose every try failed stands failed, so it says so with Try again rather than spinning on.
      failed: (pictureId, cause, again) => {
        mediaReadFailed(agentId, pictureId, cause, again);

        if (!again) stand(pictureId, null);
      },
      pause: paused,
    });

    setReads(standing);

    return () => standing.stop();
  }, [acts, agentId, pictureShown, callId]);

  useEffect(() => reads?.ask(ids), [reads, ids]);

  // Note that the pictures drawn from are kept to the newest few beyond those asked for now, each a picture's bytes, and the rest let go, read again as their rows come back.
  useEffect(() => {
    const asked = new Set(ids);
    const loose = [...shown.sources.keys()].filter((id) => !asked.has(id));
    const over = shown.sources.size - MEDIA_KEPT;

    if (over <= 0 || loose.length === 0) return;
    const gone = loose.slice(0, over);
    reads?.forget(gone);
    setShown((held) => {
      const sources = new Map(held.sources);

      for (const id of gone) sources.delete(id);

      return { agentId: held.agentId, sources };
    });
  }, [ids, shown, reads]);

  const retry = (pictureId: string) => {
    stand(pictureId, undefined);
    // Note that a read whose every try failed is let go (`mediaReads`), so asking for it again reads it afresh.
    reads?.ask([pictureId]);
  };

  return { sources: shown.agentId === agentId ? shown.sources : NO_SOURCES, retry };
}

/**
 * Where each file the agent's sent lines carried was written for its chip,
 * by the line's message and the file's place on it: the line's own bytes,
 * written once under the app's caches (`cachedFile`), each in a folder of
 * its own place, since two files of one line may share a name, and the PDF
 * viewer and the share sheet open a file on the device. One being written
 * is absent, and one that could not be written is `null`, which its chip
 * says, offering `retry`. Note that each is written once while the page
 * stands, however often the transcript moves, and that a write that lands
 * after the page left is dropped.
 */
export function useSentFiles(files: readonly ShownFile[]): SentFileSources {
  const [written, setWritten] = useState<SentFiles>(new Map());
  const [round, setRound] = useState(0);
  const asked = useRef(new Map<string, Set<string>>());
  const standing = useRef(true);

  useEffect(() => {
    standing.current = true;

    return () => {
      standing.current = false;
    };
  }, []);

  useEffect(() => {
    const land = (message: string, key: string, source: string | null) => {
      if (!standing.current) return;

      setWritten((held) => {
        const next = new Map(held);
        next.set(message, new Map(held.get(message)).set(key, source));

        return next;
      });
    };

    for (const { message, file } of files) {
      const keys = asked.current.get(message) ?? new Set<string>();

      if (keys.has(file.key) || file.base64 === undefined) continue;
      keys.add(file.key);
      asked.current.set(message, keys);

      cachedFile(SENT_FILE_PREFIX, message, file.name, file.mediaType, file.base64, file.key).then(
        (source) => land(message, file.key, source),
        (cause: unknown) => {
          console.error(`A file sent to the agent was not written (message ${message}). ${cause}`);
          land(message, file.key, null);
        },
      );
    }
    // Note that `round` is read so a retry, which forgets the file's ask, writes it again.
  }, [files, round]);

  const retry = (message: string, key: string) => {
    asked.current.get(message)?.delete(key);
    setWritten((held) => {
      const next = new Map(held);
      const kept = new Map(held.get(message));
      kept.delete(key);
      next.set(message, kept);

      return next;
    });
    setRound((at) => at + 1);
  };

  return { source: (message, key) => written.get(message)?.get(key), retry };
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
 * (`ACT_KIND.AGENTS_PART`), a worker's under its agent where `callId`
 * names the delegation that started it. A read is held as of the size its
 * page said, so a part that grew since is read again, and one that failed
 * stays failed, its two ends drawn. A read that lands once another agent's
 * page stands is let go.
 */
export function useWholeParts(agentId: string, callId?: string): WholeParts {
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

      // Note that an answer lands only while the part is still asked at the size it was asked at, so an older read never overwrites a newer one.
      const land = (cut: AgentPartCut, read: WholePartRead) => {
        if (held.current.parts.get(cut.messageId)?.get(cut.index)?.bytes !== cut.bytes) return;
        settle(cut, read);
      };

      for (const cut of cuts) {
        if (held.current.parts.get(cut.messageId)?.get(cut.index)?.bytes === cut.bytes) continue;
        settle(cut, { state: WHOLE_PART.READING });

        const part = { agentId, messageId: cut.messageId, index: cut.index };

        acts[ACT_KIND.AGENTS_PART](callId === undefined ? part : { ...part, callId }).then(
          (answer) =>
            land(
              cut,
              "part" in answer
                ? { state: WHOLE_PART.WHOLE, part: answer.part }
                : { state: WHOLE_PART.FAILED },
            ),
          (cause: unknown) => {
            refused("A part of the transcript")(cause);
            land(cut, { state: WHOLE_PART.FAILED });
          },
        );
      }
    },
    [acts, agentId, callId],
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
type PageRead =
  | { readonly reading: true }
  | { readonly html: string; readonly title: string }
  | { readonly failed: true };

/** The version a page is read at where its opener named none, as a link opens it: the newest the service holds. */
export const PAGE_NEWEST = "newest";

/** A page's read as it stands, and the ask to read it again after it failed. */
export interface PageHtml {
  readonly read: PageRead;
  readonly again: () => void;
}

/**
 * One version of a page the agent showed on its task, or its newest
 * (`PAGE_NEWEST`), read whole once through the host
 * (`ACT_KIND.TASKS_PAGE_HTML`) as its frame reads it on the Mac; reading
 * until the task is known, and read again on `again` after a read that
 * failed. A version named after the newest was read is read only where it
 * is not the one the newest read answered, so a link's page, read at once,
 * is not read again when the task's pages name the same version.
 */
export function usePageHtml(
  taskId: string | undefined,
  pageId: string,
  version: number | typeof PAGE_NEWEST | undefined,
): PageHtml {
  const acts = useHostActs();
  const [read, setRead] = useState<PageRead>({ reading: true });
  // The version the page last read answered, which a version named after it is told apart from.
  const standing = useRef<number | undefined>(undefined);
  // Note that each ask to read again counts up, which the read below depends on, so Try again reads the page anew rather than leaving the failure standing.
  const [asked, setAsked] = useState(0);
  const again = useCallback(() => setAsked((was) => was + 1), []);
  useEffect(() => {
    let current = true;

    if (version !== PAGE_NEWEST && version !== undefined && version === standing.current) return;
    setRead({ reading: true });
    standing.current = undefined;

    if (taskId === undefined || version === undefined) return;
    const named = version === PAGE_NEWEST ? {} : { version };
    acts[ACT_KIND.TASKS_PAGE_HTML]({ taskId, pageId, ...named }).then(
      (answer) => {
        if (!current) return;

        if ("page" in answer) standing.current = answer.page.version;
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
  }, [acts, taskId, pageId, version, asked]);

  return { read, again };
}

/** The older read asked last: of which agent, below where, and whether it failed. */
interface OlderAsk<Before> {
  readonly agentId: string;
  readonly before: Before;
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
 * once, as may one whose cursor comes back after a rewind. A worker's, where
 * `callId` names the delegation that started it, is read the same way. None
 * where nothing older stands.
 */
export function useOlderPages(
  agentId: string,
  before: string | undefined,
  callId?: string,
): OlderPages | undefined {
  const acts = useHostActs();

  const ask = useCallback(
    (at: string) =>
      acts[ACT_KIND.AGENTS_TRANSCRIPT_OLDER]({ ...transcriptKey(agentId, callId), before: at }),
    [acts, agentId, callId],
  );

  return useOlderReads(agentId, before, ask, "An older page of the transcript");
}

/**
 * The pages of a Manager's chat older than the oldest message the host
 * holds, read one at a time as the reader scrolls up to them
 * (`ACT_KIND.AGENTS_MANAGER_CHAT_OLDER`), on the terms the transcript's
 * older pages are read (`useOlderPages`); none where nothing older stands.
 */
export function useOlderChatPages(
  agentId: string,
  before: number | undefined,
): OlderPages | undefined {
  const acts = useHostActs();

  const ask = useCallback(
    (at: number) => acts[ACT_KIND.AGENTS_MANAGER_CHAT_OLDER]({ agentId, before: at }),
    [acts, agentId],
  );

  return useOlderReads(agentId, before, ask, "An older page of the Manager's chat");
}

/** One older read below `before`, asked by `ask`, as `useOlderPages` reads them; `what` names it where it fails. */
function useOlderReads<Before extends string | number>(
  agentId: string,
  before: Before | undefined,
  ask: (before: Before) => Promise<AgentTranscriptOlderAnswer>,
  what: string,
): OlderPages | undefined {
  const [asked, setAsked] = useState<OlderAsk<Before> | undefined>(undefined);
  // Note that the read out is held apart from what is drawn, since the list may ask twice before it draws the first ask.
  const out = useRef<OlderAsk<Before> | undefined>(undefined);

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

      const asking: OlderAsk<Before> = { agentId, before, failed: false };
      out.current = asking;
      setAsked(asking);

      // An answer settles the ask it answers alone, never a newer one.
      const settle = (next: OlderAsk<Before> | undefined) => {
        if (out.current !== asking) return;
        out.current = next;
        setAsked(next);
      };

      ask(before).then(
        (answer) => {
          if ("failure" in answer) settle({ ...asking, failed: true });
          else if (!answer.landed) settle(undefined);
        },
        (cause: unknown) => {
          refused(what)(cause);
          settle({ ...asking, failed: true });
        },
      );
    },
    [ask, agentId, before, what],
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

/** Reads the agent's transcript anew where it could not be read, or a worker's where `callId` names the delegation that started it, as the panel's Try again does (`ACT_KIND.AGENTS_TRANSCRIPT_RETRY`). */
export function useTranscriptRetry(agentId: string, callId?: string): () => void {
  const acts = useHostActs();

  return useCallback(() => {
    acts[ACT_KIND.AGENTS_TRANSCRIPT_RETRY](transcriptKey(agentId, callId)).catch(
      refused("Reading the transcript again"),
    );
  }, [acts, agentId, callId]);
}
