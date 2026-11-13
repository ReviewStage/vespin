import { DEVICE_STANDING } from "@repo/features/agent-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  FOLLOWING_FACES,
  FOLLOWING_WORDS,
  followerMachinesSentence,
  followerRefusedNote,
  followerRoleWords,
  followersView,
} from "@repo/features/task-followers-model";
import type { TaskSummary } from "@repo/features/task-wire";
import { TASK_CALL_FAILURE, type TasksFollowersAnswer } from "@repo/features/tasks-view";
import type { WorkspaceMember } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import {
  ChipPopover,
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  type FootRow,
  HoverCard,
  HoverCardList,
  HoverCardNote,
  HoverCardRow,
  type MenuRow,
  STATUS_TONE,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  useConfirmDialog,
  VisuallyHidden,
} from "@repo/ui";
import { type Actor, actorName, personActor } from "@repo/ui/actor-model";
import { GLYPH } from "@repo/ui/icons";
import { ACTION_RESULT_STATUS, type ActionResult, type TaskFollowerWire } from "@repo/wire";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { type Unreached, unreachedAs } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { ACTOR_SIZE, ActorHead, ActorMark, ActorStack } from "../actor-ref.js";
import { ANSWER_ACCEPTED, useConfirmAct } from "../confirm-act.js";
import { type PresenceBook, presenceStanding, useDevicePresence } from "../device-presence.js";
import { confirmFailure } from "../failure-report.js";
import { useMemberDirectory } from "../member-directory.js";
import { memberRows } from "../member-rows.js";
import { useOpenPerson } from "../person-door.js";
import { useToast } from "../toast.js";
import { appStateQuery, selectFixtureStaged } from "../use-app-state.js";
import { useWorkspaceExperiment } from "../workspace-experiments.js";
import { DeviceStandingGlyph, STANDING_WORDS } from "./runs-on.js";

/**
 * following-chip.tsx -- the task page's Following chip: the faces of the task's followers, and the popover listing them, where the reader follows or stops and lets the task's agents use their machines or not.
 *
 * The chip stands after the assignee's while the task's workspace has
 * Following on, its faces the app's face pile (`ActorStack`), four and then
 * a count whose card names the rest, its words Following while the reader
 * follows the task and Follow while they do not. Its popover is one list
 * with no title, the reader first as You: each row a face, a name, a muted
 * Assignee on the assignee, and a laptop at its end where the task's agents
 * may use that person's machines, nothing where they may not. A press on a
 * row opens that person's page, where the window has one to open; each row
 * hangs the person's card: who they are, Assignee or Following, the
 * reader's own machines each with the Runs on menu's dot and its words for
 * where the machine stands, and what the task's agents may do on their
 * machines. Each other follower but the assignee has a ⋯ holding Remove
 * follower, which asks first, in the accent, since it reaches someone else.
 * Pinned under the list stand the reader's own switch and Unfollow, which
 * the assignee may not press, or Follow alone where the reader does not
 * follow, and then Add a follower, whose submenu lists every other member
 * of the workspace not following yet. A write is drawn on the task at once
 * (`compose-tasks.ts`), and a refusal said in a toast, or in the question
 * that asked.
 *
 * Note that a teammate's machines are not listed on their card, since the
 * window reads only the reader's own; machine routing reads them later.
 */

/** A follower write's answer as the window hears it: the host's, or one that never arrived. */
type FollowerAnswer = TasksFollowersAnswer | Unreached<typeof TASK_CALL_FAILURE.UNANSWERED>;

/** A follower write that never answered, settled as unanswered with the error beneath. */
const followerUnreached = unreachedAs(TASK_CALL_FAILURE.UNANSWERED);

/** What a reader hears for a row's laptop. */
const MACHINES_ON_HEARD = "Agents here may use their machines";

/** What the chip names someone the members read does not, while it is unread or failed. */
const UNNAMED = "Someone";

/** The reader's follower writes on one task, each refusal said in a toast; a fixture run's go nowhere. */
function useFollowerWrites(taskId: string) {
  const staged = useQuery({ ...appStateQuery, select: selectFixtureStaged }).data === true;
  const toast = useToast();
  const { mutateAsync: sendFollow } = useMutation(actMutation(ACT_KIND.TASKS_FOLLOW));
  const { mutateAsync: sendUnfollow } = useMutation(actMutation(ACT_KIND.TASKS_UNFOLLOW));

  const { mutateAsync: sendMachines } = useMutation(
    actMutation(ACT_KIND.TASKS_SET_FOLLOWER_MACHINES),
  );

  const { mutateAsync: sendAdd } = useMutation(actMutation(ACT_KIND.TASKS_ADD_FOLLOWER));

  const asked = (sent: () => Promise<TasksFollowersAnswer>) => {
    if (staged) return;
    void sent()
      .catch(followerUnreached)
      .then((answer: FollowerAnswer) => {
        if (!("failure" in answer)) return;
        toast({
          replayUnmasked: true,
          words: followerRefusedNote(answer.failure),
          tone: STATUS_TONE.DANGER,
          failure: { surface: FAILURE_SURFACE.TASK_FOLLOW, cause: answer, about: { taskId } },
        });
      });
  };

  return {
    follow: () => asked(() => sendFollow({ taskId })),
    unfollow: () => asked(() => sendUnfollow({ taskId })),
    setMachines: (machines: boolean) => asked(() => sendMachines({ taskId, machines })),
    add: (userId: string) => asked(() => sendAdd({ taskId, userId })),
  };
}

/** A removal's answer as its question reads it: carried, or refused with the notice's words. */
function removalAnswer(answer: TasksFollowersAnswer): ActionResult {
  return "failure" in answer
    ? { status: ACTION_RESULT_STATUS.REJECTED, reason: followerRefusedNote(answer.failure) }
    : ANSWER_ACCEPTED;
}

/** What Remove follower asks before it takes `name` away. */
function removalQuestion(name: string): DialogQuestion {
  return {
    title: `Remove ${name} as a follower?`,
    body: "They stop following this task, and its agents can no longer use their machines. You can add them again, with their machines off.",
    verb: "Remove",
    running: "Removing…",
    loss: CONFIRM_LOSS.AFFECTS_OTHERS,
    replayUnmasked: true,
    titleReplayMasked: true,
  };
}

/**
 * Remove follower's question for one task: whom it asks about, set by
 * `ask`, and the dialog that asks; a fixture run's removal goes nowhere.
 */
function useFollowerRemoval(taskId: string, followers: readonly TaskFollowerWire[]) {
  const staged = useQuery({ ...appStateQuery, select: selectFixtureStaged }).data === true;
  const [asked, setAsked] = useState<{ taskId: string; userId: string; name: string } | undefined>(
    undefined,
  );
  const mutation = useMutation(actMutation(ACT_KIND.TASKS_REMOVE_FOLLOWER));

  const act = useConfirmAct(mutation, {
    send: () =>
      staged || asked === undefined
        ? Promise.resolve()
        : mutation.mutateAsync({ taskId: asked.taskId, userId: asked.userId }),
    answered: removalAnswer,
    failed: (error) => ({ status: ACTION_RESULT_STATUS.REJECTED, reason: error.message }),
  });

  // Note that the question goes once its follower or its task does, as one asked on another task would remove someone there.
  const here = asked !== undefined && asked.taskId === taskId;
  const following = here && followers.some((each) => each.userId === asked.userId);

  const confirm = useConfirmDialog(
    { subject: following || mutation.isPending, surfaceOpen: true },
    act,
    confirmFailure(FAILURE_SURFACE.TASK_FOLLOW, { taskId }),
  );

  return {
    ask: (userId: string, name: string) => {
      setAsked({ taskId, userId, name });
      confirm.ask();
    },
    dialog: (
      <ConfirmDialog
        open={here}
        confirm={confirm}
        question={removalQuestion(asked?.name ?? UNNAMED)}
      />
    ),
  };
}

/** A follower as the window draws them, read against the workspace's members, the assignee by the name the task carries. */
function useFollowerActors(
  followers: readonly TaskFollowerWire[],
  assignee: TaskSummary["assignee"],
): readonly Actor[] {
  const { members, readerId, former } = useMemberDirectory();

  return followers.map((follower) => {
    const name =
      members?.find((member) => member.userId === follower.userId)?.name ??
      (assignee?.userId === follower.userId ? assignee.name : UNNAMED);

    return personActor({ userId: follower.userId, name }, members, readerId, former);
  });
}

/** A follower's card: who they are and Assignee or Following, the reader's own machines with where each stands, and what the task's agents may do on their machines. */
function FollowerCard({
  follower,
  actor,
  you,
  book,
}: {
  follower: TaskFollowerWire;
  actor: Actor;
  you: boolean;
  book: PresenceBook;
}): React.JSX.Element {
  const machines = you ? [...book.hosts.values()] : [];
  const whose = you ? "your" : actorName(actor, { possessive: true });

  return (
    <HoverCard data-follower-card="">
      <ActorHead actor={actor} sub={followerRoleWords(follower)} />
      {machines.length === 0 ? null : (
        <HoverCardList label="Machines">
          {machines.map((host) => {
            // Note that the card names a machine's standing as the Runs on menu does, its words matching its dot.
            const standing = presenceStanding(book, host.id) ?? DEVICE_STANDING.CHECKING;

            return (
              <li key={host.id}>
                <HoverCardRow
                  glyph={<DeviceStandingGlyph device={host} standing={standing} hinted={false} />}
                  label={host.name}
                  end={STANDING_WORDS[standing]}
                />
              </li>
            );
          })}
        </HoverCardList>
      )}
      <HoverCardNote>{followerMachinesSentence(follower, whose)}</HoverCardNote>
    </HoverCard>
  );
}

/** A follower's row's end: a muted Assignee on the assignee, then a laptop where the task's agents may use their machines. */
function RowEnd({ follower }: { follower: TaskFollowerWire }): React.JSX.Element {
  return (
    <>
      {follower.assignee ? (
        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {FOLLOWING_WORDS.ASSIGNEE}
        </Text>
      ) : null}
      {follower.machines ? (
        <>
          <GLYPH.DESKTOP />
          <VisuallyHidden>{MACHINES_ON_HEARD}</VisuallyHidden>
        </>
      ) : null}
    </>
  );
}

/**
 * Add a follower: a submenu of the workspace's members who do not follow
 * the task, the reader left to Follow, each as every people menu lists
 * them; dimmed where no one is left to add.
 */
function addFollowerRow(
  members: readonly WorkspaceMember[] | undefined,
  readerId: string | undefined,
  followers: readonly TaskFollowerWire[],
  add: (userId: string) => void,
): FootRow {
  const rows = memberRows(members, readerId)
    .filter(
      ({ member, actor }) => !actor.you && !followers.some((each) => each.userId === member.userId),
    )
    .map((row) => ({
      id: row.member.userId,
      label: row.label,
      icon: row.icon,
      detail: row.detail,
      terms: row.terms,
      card: row.card,
      replayMasked: true,
    }));

  return {
    id: "add-follower",
    label: FOLLOWING_WORDS.ADD_FOLLOWER,
    icon: <GLYPH.ADD aria-hidden="true" />,
    disabled:
      members !== undefined && rows.length === 0 ? FOLLOWING_WORDS.EVERYONE_FOLLOWS : undefined,
    submenu: {
      label: FOLLOWING_WORDS.ADD_FOLLOWER,
      rows,
      value: undefined,
      onPick: add,
      stays: true,
    },
  };
}

/** The reader's own pinned rows: their switch and Unfollow, the assignee's dimmed, or Follow alone where they do not follow. */
function ownRows(
  reader: TaskFollowerWire | undefined,
  writes: ReturnType<typeof useFollowerWrites>,
): readonly FootRow[] {
  if (reader === undefined) {
    return [
      {
        id: "follow",
        label: FOLLOWING_WORDS.FOLLOW,
        icon: <GLYPH.SHOW aria-hidden="true" />,
        onPress: writes.follow,
      },
    ];
  }

  return [
    {
      id: "machines",
      label: FOLLOWING_WORDS.MACHINES,
      icon: <GLYPH.DESKTOP aria-hidden="true" />,
      toggle: { on: reader.machines, onToggle: () => writes.setMachines(!reader.machines) },
    },
    {
      id: "unfollow",
      label: FOLLOWING_WORDS.UNFOLLOW,
      icon: <GLYPH.HIDE aria-hidden="true" />,
      disabled: reader.assignee ? FOLLOWING_WORDS.ASSIGNEE_STAYS : undefined,
      onPress: writes.unfollow,
    },
  ];
}

/**
 * The Following chip for a task, while its workspace has Following on and
 * the task carries its followers; nothing otherwise. Where the task takes no
 * change (`editable` false) its popover lists the followers alone.
 */
export function FollowingChip({
  task,
  editable,
}: {
  task: Pick<TaskSummary, "id" | "workspaceId" | "assignee" | "followers">;
  editable: boolean;
}): React.JSX.Element | null {
  // Note that a task carries no followers while its workspace has Following off, so nothing is read for one.
  if (task.followers === undefined) return null;

  return <FollowingShown task={task} followers={task.followers} editable={editable} />;
}

/** The chip for a task that carries its followers, while the workspace has Following on. */
function FollowingShown({
  task,
  followers,
  editable,
}: {
  task: Pick<TaskSummary, "id" | "workspaceId" | "assignee">;
  followers: readonly TaskFollowerWire[];
  editable: boolean;
}): React.JSX.Element | null {
  const on = useWorkspaceExperiment(task.workspaceId, EXPERIMENT.FOLLOWING);
  const { members, readerId, workspaceId } = useMemberDirectory();
  const openPerson = useOpenPerson();
  const view = followersView(followers, readerId);
  const actors = useFollowerActors(view.followers, task.assignee);
  const book = useDevicePresence(on && view.reader !== undefined);
  const writes = useFollowerWrites(task.id);
  const removal = useFollowerRemoval(task.id, followers);

  if (!on) return null;

  const rows: readonly MenuRow[] = view.followers.map((follower, index) => {
    const actor = actors[index] ?? personActor(undefined, undefined, undefined);
    const you = follower === view.reader;
    const name = actorName(actor);
    // Note that the reader leaves by Unfollow and the assignee stays while assigned, so neither row offers Remove.
    const removable = editable && !you && !follower.assignee;

    return {
      id: follower.userId,
      label: you ? FOLLOWING_WORDS.YOU : name,
      icon: <ActorMark actor={actor} size={ACTOR_SIZE.INLINE} />,
      end: <RowEnd follower={follower} />,
      card: <FollowerCard follower={follower} actor={actor} you={you} book={book} />,
      actions: removable
        ? {
            thing: FOLLOWING_WORDS.FOLLOWER_THING,
            rows: [{ id: "remove", label: FOLLOWING_WORDS.REMOVE }],
            onPick: () => removal.ask(follower.userId, name),
          }
        : undefined,
      replayMasked: !you,
    };
  });

  const foot = editable
    ? [...ownRows(view.reader, writes), addFollowerRow(members, readerId, followers, writes.add)]
    : undefined;

  // Note that a pick opens the follower's page where the window has one, and changes nothing where it has none.
  const onPick =
    openPerson === undefined
      ? undefined
      : (userId: string) => openPerson(userId, undefined, workspaceId);

  return (
    <>
      <ChipPopover
        label={FOLLOWING_WORDS.CHIP}
        glyph={
          actors.length === 0 ? (
            <GLYPH.SHOW aria-hidden="true" />
          ) : (
            <ActorStack
              actors={actors}
              drawn={FOLLOWING_FACES}
              faces={actors.map(() => ({}))}
              label={FOLLOWING_WORDS.CHIP}
            />
          )
        }
        words={view.chipWords}
        menu={{ rows, noMatch: "No followers", onPick, foot }}
      />
      {removal.dialog}
    </>
  );
}
