/**
 * follow-offer-dock.tsx -- the row docked over an agent's box that offers to add the person the reader's line just mentioned as a follower of the task.
 *
 * One line, the height of the pull request's and the Inbox's rows and on the
 * same card: the person's face, "Add Charles Lin as a follower?", Not now,
 * and Add. Whom it offers is `follow-offer.ts`'s to say. Add asks the service to add
 * them (their machines off), and the row goes once the task's followers
 * name them; Not now is kept for that person on that task on the account,
 * one of its view choices (`VIEW_CHOICE_KEY.FOLLOW_OFFERS_DECLINED`), so no
 * device asks about them there again, the newest tasks' alone.
 */

import { FAILURE_SURFACE, failureAboutOf } from "@repo/features/shown-failure";
import { FOLLOWING_WORDS, followerRefusedNote } from "@repo/features/task-followers-model";
import type { FollowerCallFailure } from "@repo/features/tasks-view";
import {
  VIEW_CHOICE_KEY,
  VIEW_CHOICE_LIST_BOUNDS,
  type ViewChoiceValue,
} from "@repo/features/view-choice-wire";
import { ACT_KIND } from "@repo/host/acts";
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
import { Schema } from "effect";
import { type ReactNode, useState } from "react";
import { askAct, toastActFailure } from "../act.js";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { useMemberDirectory } from "../member-directory.js";
import { useTaskListCollections, useTaskListRow } from "../task-list-collections.js";
import { showToast } from "../toast.js";
import { selectFixtureStaged, useAppStateSlice } from "../use-app-state.js";
import { keptKey, useKeptLeaving } from "../use-kept.js";
import { useAccountChoice } from "../view-choices.js";
import { COMPOSER_DOCK_CLASS } from "./agent-composer.js";
import { type FollowOfferInput, followOffer } from "./follow-offer.js";

/** What the row says. */
const FOLLOW_OFFER_WORDS = {
  LABEL: FOLLOWING_WORDS.ADD_FOLLOWER,
  NOT_NOW: "Not now",
  ADD: "Add",
  ADDING: "Adding",
  ask: (name: string) => `Add ${name} as a follower?`,
} as const;

/** The people turned down on each task, by the task's id, each by account id. */
const storedDeclined = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Array(Schema.String)),
);

/** Where an earlier build kept the people turned down in this window's storage, moved up to the account once. */
const KEPT_DECLINED = keptKey("app.followOffersDeclined", storedDeclined);

/** The people turned down, by task, newest task first, as the account keeps them. */
type Declined = ViewChoiceValue<typeof VIEW_CHOICE_KEY.FOLLOW_OFFERS_DECLINED>;

/** The newest `most` of `items`, newest last as they are kept here. */
function newest<A>(items: readonly A[], most: number): A[] {
  return items.slice(Math.max(0, items.length - most));
}

/** The act Add asks, as a failure it raises names it. */
const ADD_ACT = { surface: FAILURE_SURFACE.ACT, act: ACT_KIND.TASKS_ADD_FOLLOWER } as const;

/** No one turned down on a task, one list for every draw. */
const NO_ONE: readonly string[] = [];

/** No one turned down anywhere, one list for every draw. */
const NONE_DECLINED: Declined = [];

/** The people an earlier build kept turned down, by task, as the account keeps them, the bound's worth of them. */
function movedDeclined(kept: Readonly<Record<string, readonly string[]>>): Declined {
  return Object.entries(kept)
    .slice(0, VIEW_CHOICE_LIST_BOUNDS.DECLINED_TASKS)
    .map(([taskId, userIds]) => ({
      taskId,
      userIds: newest(userIds, VIEW_CHOICE_LIST_BOUNDS.DECLINED_PEOPLE),
    }));
}

/** `declined` with `userId` turned down on `taskId`: the task first, the person its newest, and the oldest past each bound let go. */
function declinedWith(declined: Declined, taskId: string, userId: string): Declined {
  const was = declined.find((each) => each.taskId === taskId)?.userIds ?? NO_ONE;

  const userIds = newest(
    [...was.filter((each) => each !== userId), userId],
    VIEW_CHOICE_LIST_BOUNDS.DECLINED_PEOPLE,
  );

  return [{ taskId, userIds }, ...declined.filter((each) => each.taskId !== taskId)].slice(
    0,
    VIEW_CHOICE_LIST_BOUNDS.DECLINED_TASKS,
  );
}

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

/** The task as the listed tasks hold it, its workspace and followers read; none for a task not listed. */
function useListedTask(taskId: string) {
  return useTaskListRow(useTaskListCollections().tasks, taskId);
}

/**
 * The offer to add a person the reader's newest line to the agent mentioned
 * as a follower of the task, over its box; nothing while there is none to
 * offer.
 */
export function FollowOfferDock({
  taskId,
  messages,
  pending,
  readerId,
}: Pick<FollowOfferInput, "messages" | "pending" | "readerId"> & { taskId: string }): ReactNode {
  const task = useListedTask(taskId);
  const { members, former } = useMemberDirectory();
  const [left, forgetLeft] = useKeptLeaving(KEPT_DECLINED);

  const { value: declined, change: changeDeclined } = useAccountChoice(
    VIEW_CHOICE_KEY.FOLLOW_OFFERS_DECLINED,
    null,
    NONE_DECLINED,
    useAppStateSlice(selectFixtureStaged) === true,
    [left === undefined ? undefined : movedDeclined(left), forgetLeft],
  );

  const [adding, setAdding] = useState<string | undefined>(undefined);

  const offered = followOffer({
    messages,
    pending,
    readerId,
    followers: task?.followers,
    members,
    declined: declined.find((each) => each.taskId === taskId)?.userIds ?? NO_ONE,
  });

  // Note that only a member is ever offered (`followOffer`), so the name is theirs as the directory reads it.
  const member = members?.find((each) => each.userId === offered);

  if (offered === undefined || member === undefined) return null;
  const actor = personActor(member, members, readerId, former);

  const decline = () => changeDeclined((held) => declinedWith(held, taskId, offered));

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
