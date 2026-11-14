import type { AgentSummary } from "@repo/features/agent-wire";
import {
  DESCRIPTION_ACTOR,
  type DescriptionEditor,
  type DescriptionRevisionLine,
} from "@repo/features/task-wire";
import type { FormerMember, WorkspaceMember } from "@repo/features/workspace-wire";
import {
  ACTOR_KIND,
  ACTOR_STATE,
  type Actor,
  APP_ACTOR,
  actorName,
  type PersonActor,
  personActor,
  SOMEONE_REASON,
} from "@repo/ui/actor-model";
import { TAB_WORDS } from "@repo/ui/tab-strip-model";
import { providerOf } from "./agent-model.js";

/**
 * description-history-model.ts -- the version history's words for each revision, and how a revision's sections open; a version drawn against another is `@repo/features/description-version-diff`.
 *
 * A revision is drawn under its writer the way the rest of the window draws
 * them (`@repo/ui/actor-model`): the app's face for the notetaker, the reader by their
 * account's picture as You, a teammate as the workspace's members list them,
 * a coding agent by its harness and title, and Earlier for the description as it
 * stood before its history began. Its line says
 * what it did: how many changes its saves made, or which version a restore
 * brought back. A version drawn against another, its changes marked, is
 * `@repo/features/description-version-diff`, which the iPhone draws too. A section's
 * "Edited by" names the save that last changed it, which is found
 * as the revision it moved on. Everything here is pure.
 */

/**
 * The one reading the history, as their account names them: none while no
 * account is signed in. The id is what tells their revisions from a
 * teammate's; without one, nobody is drawn as them.
 */
export interface HistoryReader {
  readonly id: string | undefined;
  readonly name: string | undefined;
  readonly pictureUrl: string | undefined;
  /** The workspace's members as last read, which add a teammate's picture and say who has left; none while unread. */
  readonly members?: readonly WorkspaceMember[];
  /** Who the workspace's work names but left, whose pictures they keep, grayed; none while unread. */
  readonly former?: readonly FormerMember[];
}

/**
 * The member a person's revision names, as its row draws them: the reader,
 * by their own name and picture, where it is theirs; a teammate as the members read lists
 * them, or as a former member where it no longer does; someone unnamed
 * where the service names nobody.
 */
function personOf(by: DescriptionEditor | undefined, reader: HistoryReader): Actor {
  const yours = by !== undefined && reader.id !== undefined && by.userId === reader.id;

  if (!yours) return personActor(by, reader.members, undefined, reader.former);

  const you: PersonActor = {
    kind: ACTOR_KIND.PERSON,
    userId: reader.id,
    name: reader.name ?? "",
    you: true,
  };

  return reader.pictureUrl === undefined ? you : { ...you, pictureUrl: reader.pictureUrl };
}

/**
 * Who wrote a revision: a member, the reader as You only where the revision
 * names them; the app; a coding agent by the title its row has now, wearing
 * the harness of the agent the line names among the task's `agents`, or no
 * harness where the agent is not among them; or the description before history.
 */
export function revisionAuthorOf(
  line: Pick<DescriptionRevisionLine, "lastEdit" | "agentId">,
  reader: HistoryReader,
  agents: readonly Pick<AgentSummary, "id" | "model">[],
): Actor {
  const { lastEdit } = line;

  switch (lastEdit.actor) {
    case DESCRIPTION_ACTOR.DEVELOPER:
      return personOf(lastEdit.by, reader);
    case DESCRIPTION_ACTOR.NOTETAKER:
      return APP_ACTOR;
    case DESCRIPTION_ACTOR.AGENT: {
      const agent = agents.find((each) => each.id === line.agentId);

      return {
        kind: ACTOR_KIND.AGENT,
        name: lastEdit.label ?? TAB_WORDS.AGENT,
        provider: agent === undefined ? undefined : providerOf(agent.model),
        state: ACTOR_STATE.REST,
      };
    }

    case DESCRIPTION_ACTOR.EARLIER:
      return { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.EARLIER };
  }
}

/**
 * The revision that made the save at `at`, among revisions read newest
 * first: the oldest whose latest save is at or after it. A save moves its
 * revision's latest save on to its own moment or just past it, and every
 * revision older than that one last moved before the save, so the first
 * revision older than the save stands just past the one that made it.
 * Nothing where every revision read is at or after the save and an older
 * page is still to be read (`complete` false), since the one that made it
 * may stand there; the oldest where none is.
 */
export function revisionOfSave(
  revisions: readonly DescriptionRevisionLine[],
  at: number,
  complete: boolean,
): number | undefined {
  const before = revisions.findIndex((line) => line.lastEdit.at < at);

  if (before === -1) return complete ? revisions.at(-1)?.seq : undefined;

  // A save newer than the newest revision is the newest's, as close as the history comes.
  return (revisions[before - 1] ?? revisions[before])?.seq;
}

/** Whether a revision's row opens the sections it changed: one whose saves made more than one change, never a restore or the description before history. */
export function opensSections(line: DescriptionRevisionLine): boolean {
  return (
    line.changes > 1 &&
    line.restoredFrom === undefined &&
    line.lastEdit.actor !== DESCRIPTION_ACTOR.EARLIER
  );
}

/** What a section is called in a revision's list: its heading, or Opening for the words before the document's first heading. */
export function sectionName(heading: string): string {
  return heading === "" ? "Opening" : heading;
}

/** Where a revision was written, which its Open goes to. */
export const REVISION_SOURCE = {
  AGENT: "agent",
} as const;

/** The place that wrote a revision: an agent's tab. */
export type RevisionSource = {
  readonly kind: typeof REVISION_SOURCE.AGENT;
  readonly agentId: string;
};

/**
 * Where a revision's Open goes: an agent's tab where the line names the
 * agent, and nowhere for the developer's own, a restore, the app's own saves,
 * whose work no tab draws, or the description before history.
 */
export function revisionSource(
  line: Pick<DescriptionRevisionLine, "lastEdit" | "agentId">,
): RevisionSource | undefined {
  const { lastEdit } = line;

  if (lastEdit.actor === DESCRIPTION_ACTOR.AGENT && line.agentId !== undefined) {
    return { kind: REVISION_SOURCE.AGENT, agentId: line.agentId };
  }

  return undefined;
}

/** What a revision's Open says: the agent's tab by its writer's name. */
export function sourceLabel(_source: RevisionSource, author: Actor): string {
  return `Open ${actorName(author)}`;
}
