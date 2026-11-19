/**
 * repository-default.ts -- the repository a new start stands on before one is picked, as New task and New Manager both open on it.
 *
 * A pick stands as picked: a repository, or none (`null`, No repository
 * picked). Until one is made the card stands on the newest repository the
 * account's tasks were about lately that the chip's read lists, else the
 * first the read lists, else none. A pick, a preset, or the recent default a
 * read does not list is dropped, so a later read listing it does not bring
 * it back and the default falls to the next; a read made before the
 * workspace resolved, or for the one before a switch still under way, judges
 * none. A switch of workspace lets the pick go, in the render that brings
 * it, since a repository of one workspace is none of another's; the scope
 * first resolving keeps a pick made before the workspaces were read. Note
 * that a repository is not started on before the read lands unless the
 * workspace's GitHub reaches it, because the service would refuse it.
 */

import { workspaceReaches } from "@repo/features/tasks-model";
import type { Workspace } from "@repo/features/workspace-wire";
import { useState } from "react";
import type { RepositoryChooser } from "./repository-chip.js";

/** The repositories a read did not list, before any read. */
const NONE_DROPPED: readonly string[] = [];

/** Whether two names are one repository, as GitHub spells it or not. */
function sameRepository(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/** A card's repository: what it stands on, its pick, and what its chip hands back. */
export interface RepositoryDefault {
  /** The repository the card starts on now, or none. */
  readonly repository: string | null;
  /** The pick as made: a repository, none picked (`null`), or no pick yet (`undefined`). */
  readonly chosen: string | null | undefined;
  /** Whether the chip's reads judge the pick, so one they do not list may be dropped. */
  readonly judged: boolean;
  /** Picks a repository, or none. */
  readonly choose: (repository: string | null) => void;
  /** Drops a repository the workspace's GitHub does not reach, letting the pick go. */
  readonly drop: (repository: string) => void;
  /** Hears the repositories the chip's read lists (`onListed`). */
  readonly onListed: (listed: readonly string[]) => void;
}

/** The card's repository over `repositories`, in `workspace`, starting on `preset` where one is given; see the module's head. */
export function useRepositoryDefault(
  repositories: RepositoryChooser,
  workspace: Pick<Workspace, "github"> | undefined,
  preset: string | null | undefined,
): RepositoryDefault {
  const [chosen, setChosen] = useState<string | null | undefined>(preset);
  // The repositories the chip's last read listed, an App's and a member's token's alike.
  const [listed, setListed] = useState<readonly string[] | undefined>(undefined);
  // The repositories a read did not list, which the default passes over from then on.
  const [dropped, setDropped] = useState<readonly string[]>(NONE_DROPPED);
  const [scope, setScope] = useState(repositories.scope);

  if (repositories.scope !== scope) {
    setListed(undefined);

    if (scope !== undefined) {
      setChosen(undefined);
      setDropped(NONE_DROPPED);
    }

    setScope(repositories.scope);
  }

  const isListed = (name: string) =>
    listed === undefined || listed.some((each) => sameRepository(each, name));

  const kept = (name: string) => !dropped.some((each) => sameRepository(each, name));

  // Note that a null chosen is No repository picked, and an undefined one is no pick yet, which
  // falls to the newest recent repository still kept, then to the first the read lists.
  const fallback =
    repositories.recent.find((each) => kept(each) && isListed(each)) ?? listed?.find(kept) ?? null;

  const candidate = chosen === undefined ? fallback : chosen;
  const judged = repositories.scope !== undefined && repositories.scope === scope;

  const unlisted = [candidate, ...repositories.recent].filter(
    (each): each is string => each !== null && kept(each) && !isListed(each),
  );

  if (judged && unlisted.length > 0) {
    setDropped([...dropped, ...unlisted]);

    if (chosen !== undefined && chosen !== null) setChosen(undefined);
  }

  const repository =
    candidate !== null &&
    (!isListed(candidate) ||
      (listed === undefined && workspace !== undefined && !workspaceReaches(workspace, candidate)))
      ? null
      : candidate;

  return {
    repository,
    chosen,
    judged,
    choose: setChosen,
    drop: (name: string) => {
      setDropped((was) => (was.some((each) => sameRepository(each, name)) ? was : [...was, name]));
      setChosen(undefined);
    },
    onListed: setListed,
  };
}
