/**
 * use-agent-actions.ts -- what an agent's ⋯ menu does on its page: Copy link, Rename, Pin or Unpin, Archive, asked first, and Permanently delete, asked always, and why the last of them did not take.
 *
 * The panel's agent menu (`@repo/panel`'s `agent-actions.tsx`) on the phone,
 * Rewind and Fork left to the desktop and the web. Each act is sent as the
 * panel sends it (`AGENTS_RENAME`, `AGENTS_PIN`, `AGENTS_ARCHIVE`), and the
 * host draws it on the agent's row the moment it is asked, so the page reads
 * the name and the pin off the agent and a refusal the host takes back reads
 * back too, its words said over the composer. Copy link copies the agent's
 * address on vespin.dev. Archive asks first, in the panel's words where the
 * agent still works, since archiving it stops it and the work it is in the
 * middle of; note that the phone asks of an agent at rest too, as it has no
 * Undo to offer after, and once the agent is archived the page goes back to
 * where it was opened from, since the agent leaves its task's list.
 * Permanently delete (`AGENTS_DELETE`) always asks, in the panel's words
 * (`deleteAgentWords`), since nothing brings the agent back, and goes back
 * the same way once the service took it; a refusal is said over the
 * composer, in the panel's words for why.
 */

import {
  ARCHIVE_FAILED,
  ARCHIVE_NOT_READY,
  DELETE_FAILED,
} from "@repo/features/agent-refusal-words";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import { agentStillWriting } from "@repo/features/task-agents-model";
import {
  archiveStopWords,
  deleteAgentWords,
  type StopAgentsWords,
} from "@repo/features/tasks-model";
import { ACT_KIND } from "@repo/host/acts";
import { selectAgentPinned } from "@repo/host/app-state-reads";
import { BUZZ, buzz } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { setStringAsync } from "expo-clipboard";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useWrite } from "../use-write.js";
import { useFollowedAgent, useReadAgent } from "./use-agent.js";

/** Why each act did not take, said over the composer. */
const ACT_FAILED = {
  RENAME: "The agent could not be renamed.",
  PIN: "The agent could not be pinned.",
  UNPIN: "The agent could not be unpinned.",
  ARCHIVE: ARCHIVE_FAILED,
  COPY: "The link could not be copied.",
} as const;

/** What Archive asks of an agent at rest, its act repeating the title's verb and noun. */
const ARCHIVE_AT_REST = { title: archiveStopWords(false).title, act: "Archive agent" } as const;

/** What Archive asks first: its title, what it stops where the agent works, and its act. */
export interface ArchiveQuestion {
  readonly title: string;
  readonly message: string | undefined;
  readonly act: string;
}

/** What Archive asks of an agent by where it stands now: the panel's Stop and archive where it still works, which says what archiving stops, and Archive agent at rest. */
function archiveQuestion(working: boolean): ArchiveQuestion {
  const stopWords = archiveStopWords(false);

  return working
    ? { title: stopWords.title, message: stopWords.body, act: stopWords.verb }
    : { title: ARCHIVE_AT_REST.title, message: undefined, act: ARCHIVE_AT_REST.act };
}

/** What Archive asks of one agent, the way to raise it, and the way to answer it. */
export interface ArchiveAsk {
  /** What Archive asks, by where the agent stood when it was raised. */
  readonly question: ArchiveQuestion;
  /** Reads the agent `agentId` names afresh, and answers whether the question may stand: false where a later ask overtook this one. */
  readonly ask: (agentId: string) => Promise<boolean>;
  /** The question's act pressed: runs `archive` where the agent was asked about at work; where it was asked about at rest, reads it afresh and runs `archive` where it still rests, or asks again as Stop and archive (`present`) where it works or the read failed, unless a later ask began or the screen was left since. */
  readonly answered: (archive: () => void, present: () => void) => void;
}

/**
 * What Archive asks of the agent `agentId` names, read afresh before it's
 * raised, as the panel reads an agent again before archiving it
 * (`agent-archive.tsx`). Note that it asks Stop and archive where the fresh
 * read finds the agent at work, or where the read failed, because one that
 * started a turn since would otherwise be stopped without a word of it,
 * while a needless Stop and archive costs only its words. The question
 * keeps the words it was raised with while it stands, and an agent asked
 * about at rest is read again as the act is pressed and asked about again,
 * as Stop and archive, where it started a turn since, for the same reason.
 * Only the latest ask answers, so a slow read for one agent never stands
 * its question over another's, and leaving the screen lets go of an ask
 * still reading, so its question never comes up over another screen. Note
 * that a pressed act's own read is not an ask: a later ask, or leaving,
 * never drops an archive already confirmed, and only stops it being asked
 * about again.
 */
export function useArchiveAsk(agentId: string): ArchiveAsk {
  const readAgent = useReadAgent();
  const [askedWorking, setAskedWorking] = useState(false);
  const latest = useRef(0);

  // Note that leaving the screen overtakes every ask still reading, as a later ask would.
  useFocusEffect(
    useCallback(
      () => () => {
        latest.current += 1;
      },
      [],
    ),
  );

  /** Whether the agent a fresh read found works: at work, or unread, where the read failed. */
  const works = (asked: string): Promise<boolean> =>
    readAgent(asked).then((fresh) => fresh === undefined || agentStillWriting(fresh.status));

  /** Reads the agent `asked` names afresh and keeps where it stands for the question: whether it works, or none where a later ask overtook this one. */
  const read = (asked: string): Promise<boolean | undefined> => {
    latest.current += 1;
    const mine = latest.current;

    return works(asked).then((working) => {
      if (latest.current !== mine) return undefined;
      setAskedWorking(working);

      return working;
    });
  };

  return {
    question: archiveQuestion(askedWorking),
    ask: (asked) => read(asked).then((working) => working !== undefined),
    answered: (archive, present) => {
      if (askedWorking) {
        archive();

        return;
      }

      // Note that an agent asked about at rest is read again as the act is pressed, since a turn begun since may not have reached the list yet.
      const pressed = latest.current;

      void works(agentId).then((working) => {
        if (!working) {
          archive();

          return;
        }

        if (latest.current !== pressed) return;
        setAskedWorking(true);
        present();
      });
    },
  };
}

/** What the agent's menu does. */
export interface AgentActions {
  /** The agent's name as it stands, which Rename opens holding. */
  readonly title: string;
  readonly pinned: boolean;
  readonly copyLink: () => void;
  readonly rename: (title: string) => void;
  readonly pin: () => void;
  /** What Archive asks first, by where the agent stands now, read afresh as it's raised. */
  readonly archiveAsk: ArchiveAsk;
  /** Archives the agent, the question answered, and calls `onArchived` once the service took it. */
  readonly archive: (onArchived: () => void) => void;
  /** What Permanently delete asks first of the agent, named as its page names it `name`. */
  readonly deleteQuestion: (name: string) => StopAgentsWords;
  /** Deletes the agent for good, the question answered, and calls `onDeleted` once the service took it. */
  readonly remove: (onDeleted: () => void) => void;
  /** Why the last act did not take; none while none failed. */
  readonly note: string | undefined;
  readonly clearNote: () => void;
}

/** The menu of the agent `agentId` names, whose address on vespin.dev is `address`, none before its workspace is known. */
export function useAgentActions(agentId: string, address: string | undefined): AgentActions {
  const acts = useHostActs();
  const write = useWrite();
  const agent = useFollowedAgent(agentId);
  const select = useMemo(() => selectAgentPinned(agentId), [agentId]);
  const { data: pinned = false } = useQuery({ ...appStateQuery, select });
  const [note, setNote] = useState<string | undefined>(undefined);
  const archiveAsk = useArchiveAsk(agentId);

  /** Sends an act, saying `failed` where the service refused it or never answered, and buzzing as it lands. */
  const send = (
    sent: () => Promise<{ readonly failure: string } | object>,
    failed: string,
    onTaken?: () => void,
    refusedAs: (failure: string) => string = () => failed,
  ) => {
    setNote(undefined);
    write(sent, {
      refused: (answer) => ("failure" in answer ? refusedAs(answer.failure) : undefined),
      unanswered: failed,
      inPlace: setNote,
      went: BUZZ.SUCCESS,
    }).then((went) => {
      if (went) onTaken?.();
    });
  };

  return {
    title: agent?.title ?? "",
    pinned,
    copyLink: () => {
      setNote(undefined);

      if (address === undefined) return;
      setStringAsync(address)
        .then(() => buzz(BUZZ.SUCCESS))
        .catch((cause: unknown) => {
          console.error(ACT_FAILED.COPY, cause);
          setNote(ACT_FAILED.COPY);
        });
    },
    rename: (title) => {
      if (title === "" || title === agent?.title) return;
      send(() => acts[ACT_KIND.AGENTS_RENAME]({ agentId, title }), ACT_FAILED.RENAME);
    },
    pin: () =>
      send(
        () => acts[ACT_KIND.AGENTS_PIN]({ agentId, pinned: !pinned }),
        pinned ? ACT_FAILED.UNPIN : ACT_FAILED.PIN,
      ),
    archiveAsk,
    archive: (onArchived) =>
      send(
        () => acts[ACT_KIND.AGENTS_ARCHIVE]({ agentId, archived: true }),
        ACT_FAILED.ARCHIVE,
        onArchived,
      ),
    deleteQuestion: (name) => deleteAgentWords(name, agent?.archivedAt !== undefined),
    remove: (onDeleted) =>
      send(
        () => acts[ACT_KIND.AGENTS_DELETE]({ agentId }),
        DELETE_FAILED,
        onDeleted,
        // Note that an agent still starting its turn cannot be deleted yet, which the panel says in its own words.
        (failure) =>
          failure === AGENT_CALL_FAILURE.AGENT_NOT_READY ? ARCHIVE_NOT_READY : DELETE_FAILED,
      ),
    note,
    clearNote: () => setNote(undefined),
  };
}
