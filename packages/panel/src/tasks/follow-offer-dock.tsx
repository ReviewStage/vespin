/**
 * follow-offer-dock.tsx -- the row docked over an agent's box that offers to add the person the reader's line just mentioned as a follower of the task.
 *
 * One line, the height of the pull request's and the Inbox's rows and on the
 * same card: the person's face, "Add Charles Lin as a follower?", Not now,
 * and Add. Whom it offers is `follow-offer.ts`'s to say; it stands only
 * while the task's workspace has Following on. Add asks the service to add
 * them (their machines off), and the row goes once the task's followers
 * name them; Not now is kept for that person on that task in this window's
 * own storage, so it never asks about them there again.
 */

import { FAILURE_SURFACE, failureAboutOf } from "@repo/features/shown-failure";
import { followerRefusedNote } from "@repo/features/task-followers-model";
import type { FollowerCallFailure } from "@repo/features/tasks-view";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import {
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  Inline,
  LIST_VARIANT,
  List,
  ListRow,
  STATUS_TONE,
} from "@repo/ui";
import { personActor } from "@repo/ui/actor-model";
import { useQuery } from "@tanstack/react-query";
import { Schema } from "effect";
import { type ReactNode, useCallback, useState } from "react";
import { askAct, toastActFailure } from "../act.js";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { useMemberDirectory } from "../member-directory.js";
import { showToast } from "../toast.js";
import { appStateQuery, selectListedTasks } from "../use-app-state.js";
import { keptKey, useKept } from "../use-kept.js";
import { useWorkspaceExperiment } from "../workspace-experiments.js";
import { COMPOSER_DOCK_CLASS } from "./agent-composer.js";
import { type FollowOfferInput, followOffer } from "./follow-offer.js";

/** What the row says. */
const FOLLOW_OFFER_WORDS = {
  LABEL: "Add a follower",
  NOT_NOW: "Not now",
  ADD: "Add",
  ADDING: "Adding",
  ask: (name: string) => `Add ${name} as a follower?`,
} as const;

/** The people turned down on each task, by the task's id, each by account id. */
const storedDeclined = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Array(Schema.String)),
);

const KEPT = { DECLINED: keptKey("app.followOffersDeclined", storedDeclined) } as const;

/** The act Add asks, as a failure it raises names it. */
const ADD_ACT = { surface: FAILURE_SURFACE.ACT, act: ACT_KIND.TASKS_ADD_FOLLOWER } as const;

/** No one turned down anywhere, one record for every draw. */
const NONE_DECLINED: Readonly<Record<string, readonly string[]>> = {};

/** No one turned down on a task, one list for every draw. */
const NO_ONE: readonly string[] = [];

/** An add the service answered without taking, said in a FAILED toast as a refused press is. */
function addRefused(
  failure: FollowerCallFailure,
  payload: { taskId: string; userId: string },
): void {
  showToast({
    words: followerRefusedNote(failure),
    tone: STATUS_TONE.DANGER,
    failure: { ...ADD_ACT, cause: failure, about: failureAboutOf(payload) },
  });
}

/** The task's workspace and followers, as the listed tasks hold them; none for a task not listed. */
function useListedTask(taskId: string) {
  const select = useCallback(
    (state: Parameters<typeof selectListedTasks>[0]) => {
      const task = selectListedTasks(state).tasks.find((each) => each.id === taskId);

      return task === undefined
        ? undefined
        : { workspaceId: task.workspaceId, followers: task.followers };
    },
    [taskId],
  );

  return useQuery({ ...appStateQuery, select }).data;
}

/**
 * The offer to add a person the reader's newest line to the agent mentioned
 * as a follower of the task, over its box; nothing while there is none to
 * offer or the task's workspace has Following off.
 */
export function FollowOfferDock({
  taskId,
  messages,
  pending,
  readerId,
}: Pick<FollowOfferInput, "messages" | "pending" | "readerId"> & { taskId: string }): ReactNode {
  const task = useListedTask(taskId);
  const following = useWorkspaceExperiment(task?.workspaceId, EXPERIMENT.FOLLOWING);
  const { members, former } = useMemberDirectory();
  const [declined, , changeDeclined] = useKept(KEPT.DECLINED, NONE_DECLINED);
  const [adding, setAdding] = useState<string | undefined>(undefined);

  const offered = following
    ? followOffer({
        messages,
        pending,
        readerId,
        followers: task?.followers,
        members,
        declined: declined[taskId] ?? NO_ONE,
      })
    : undefined;

  // Note that only a member is ever offered (`followOffer`), so the name is theirs as the directory reads it.
  const member = members?.find((each) => each.userId === offered);

  if (offered === undefined || member === undefined) return null;
  const actor = personActor(member, members, readerId, former);

  const decline = () =>
    changeDeclined((kept) => ({
      ...kept,
      [taskId]: [...(kept[taskId] ?? NO_ONE).filter((each) => each !== offered), offered],
    }));

  // Note that the row goes once the task's followers name them, so the press is only busy until the service answers.
  const add = async () => {
    const payload = { taskId, userId: offered };
    setAdding(offered);

    try {
      const answer = await askAct(ACT_KIND.TASKS_ADD_FOLLOWER, payload);

      if ("failure" in answer) addRefused(answer.failure, payload);
    } catch (cause) {
      toastActFailure({ ...ADD_ACT, cause, about: failureAboutOf(payload) });
    } finally {
      setAdding(undefined);
    }
  };

  const busy = adding === offered;

  return (
    <div className={`agent-follow-offer-dock ${COMPOSER_DOCK_CLASS}`}>
      <List label={FOLLOW_OFFER_WORDS.LABEL} variant={LIST_VARIANT.CARD} fingerTall>
        <ListRow
          leading={<ActorMark actor={actor} size={ACTOR_SIZE.INLINE} />}
          title={FOLLOW_OFFER_WORDS.ask(member.name)}
          titleReplayMasked
          actions={
            <Inline wrap={false}>
              <Button
                size={BUTTON_SIZE.COMPACT}
                variant={BUTTON_VARIANT.QUIET}
                disabled={busy}
                onClick={decline}
              >
                {FOLLOW_OFFER_WORDS.NOT_NOW}
              </Button>
              <Button
                size={BUTTON_SIZE.COMPACT}
                variant={BUTTON_VARIANT.OUTLINE}
                busy={busy}
                busyLabel={FOLLOW_OFFER_WORDS.ADDING}
                onClick={() => void add()}
              >
                {FOLLOW_OFFER_WORDS.ADD}
              </Button>
            </Inline>
          }
        />
      </List>
    </div>
  );
}
