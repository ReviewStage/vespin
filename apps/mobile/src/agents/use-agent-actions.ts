/**
 * use-agent-actions.ts -- what an agent's ⋯ menu does on its page: Copy link, Rename, Pin or Unpin, and Archive, asked first, and why the last of them did not take.
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
 */

import { ARCHIVE_FAILED } from "@repo/features/agent-refusal-words";
import { agentStillWriting } from "@repo/features/task-agents-model";
import { archiveStopWords } from "@repo/features/tasks-model";
import { ACT_KIND } from "@repo/host/acts";
import { selectAgentPinned } from "@repo/host/app-state-reads";
import { BUZZ, buzz } from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { setStringAsync } from "expo-clipboard";
import { useMemo, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useWrite } from "../use-write.js";
import { useFollowedAgent } from "./use-agent.js";

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
export function archiveQuestion(working: boolean): ArchiveQuestion {
  const stopWords = archiveStopWords(false);

  return working
    ? { title: stopWords.title, message: stopWords.body, act: stopWords.verb }
    : { title: ARCHIVE_AT_REST.title, message: undefined, act: ARCHIVE_AT_REST.act };
}

/** What the agent's menu does. */
export interface AgentActions {
  /** The agent's name as it stands, which Rename opens holding. */
  readonly title: string;
  readonly pinned: boolean;
  readonly copyLink: () => void;
  readonly rename: (title: string) => void;
  readonly pin: () => void;
  /** What Archive asks first, by where the agent stands now. */
  readonly archiveQuestion: ArchiveQuestion;
  /** Archives the agent, the question answered, and calls `onArchived` once the service took it. */
  readonly archive: (onArchived: () => void) => void;
  /** Why the last act did not take; none while none failed. */
  readonly note: string | undefined;
  readonly clearNote: () => void;
}

/** The menu of the agent `agentId` names, whose address on vespin.dev is `address`. */
export function useAgentActions(agentId: string, address: string): AgentActions {
  const acts = useHostActs();
  const write = useWrite();
  const agent = useFollowedAgent(agentId);
  const select = useMemo(() => selectAgentPinned(agentId), [agentId]);
  const { data: pinned = false } = useQuery({ ...appStateQuery, select });
  const [note, setNote] = useState<string | undefined>(undefined);
  const working = agent !== undefined && agentStillWriting(agent.status);

  /** Sends an act, saying `failed` where the service refused it or never answered, and buzzing as it lands. */
  const send = (
    sent: () => Promise<{ readonly failure: string } | object>,
    failed: string,
    onTaken?: () => void,
  ) => {
    setNote(undefined);
    write(sent, {
      refused: (answer) => ("failure" in answer ? failed : undefined),
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
    archiveQuestion: archiveQuestion(working),
    archive: (onArchived) =>
      send(
        () => acts[ACT_KIND.AGENTS_ARCHIVE]({ agentId, archived: true }),
        ACT_FAILED.ARCHIVE,
        onArchived,
      ),
    note,
    clearNote: () => setNote(undefined),
  };
}
