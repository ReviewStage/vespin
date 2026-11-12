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
import { ACT_KIND } from "@repo/host/acts";
import { EXPERIMENT } from "@repo/settings";
import {
  ChipPopover,
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
  VisuallyHidden,
} from "@repo/ui";
import { type Actor, actorName, personActor } from "@repo/ui/actor-model";
import { GLYPH } from "@repo/ui/icons";
import type { TaskFollowerWire } from "@repo/wire";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type Unreached, unreachedAs } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { ACTOR_SIZE, ActorHead, ActorMark, ActorStack } from "../actor-ref.js";
import { type PresenceBook, presenceStanding, useDevicePresence } from "../device-presence.js";
import { useMemberDirectory } from "../member-directory.js";
import { useToast } from "../toast.js";
import { appStateQuery, selectFixtureStaged } from "../use-app-state.js";
import { useWorkspaceExperiment } from "../workspace-experiments.js";
import { DeviceStandingGlyph } from "./runs-on.js";

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
 * row changes nothing; each hangs the person's card: who they are, Assignee
 * or Following, the reader's own machines each with the Runs on menu's dot
 * and Online or Offline, and what the task's agents may do on their
 * machines. Pinned under the list stand the reader's own switch and
 * Unfollow, which the assignee may not press, or Follow alone where the
 * reader does not follow. A write is drawn on the task at once
 * (`compose-tasks.ts`), and a refusal said in a toast.
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

/** Where one of the reader's machines stands, as its card says it: Online, or Offline for anything else. */
function machineWords(book: PresenceBook, deviceId: string): string {
  return presenceStanding(book, deviceId) === DEVICE_STANDING.ONLINE
    ? FOLLOWING_WORDS.ONLINE
    : FOLLOWING_WORDS.OFFLINE;
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
          {machines.map((host) => (
            <li key={host.id}>
              <HoverCardRow
                glyph={
                  <DeviceStandingGlyph
                    device={host}
                    standing={presenceStanding(book, host.id) ?? DEVICE_STANDING.CHECKING}
                    hinted={false}
                  />
                }
                label={host.name}
                end={machineWords(book, host.id)}
              />
            </li>
          ))}
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

/** The pinned rows: the reader's switch and Unfollow, the assignee's dimmed, or Follow alone where they do not follow. */
function footRows(
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
  const on = useWorkspaceExperiment(task.workspaceId, EXPERIMENT.FOLLOWING);
  const shown = on && task.followers !== undefined;
  const { readerId } = useMemberDirectory();
  const view = followersView(task.followers ?? [], readerId);
  const actors = useFollowerActors(view.followers, task.assignee);
  const book = useDevicePresence(shown && view.reader !== undefined);
  const writes = useFollowerWrites(task.id);

  if (!shown) return null;

  const rows: readonly MenuRow[] = view.followers.map((follower, index) => {
    const actor = actors[index] ?? personActor(undefined, undefined, undefined);
    const you = follower === view.reader;

    return {
      id: follower.userId,
      label: you ? FOLLOWING_WORDS.YOU : actorName(actor),
      icon: <ActorMark actor={actor} size={ACTOR_SIZE.INLINE} />,
      end: <RowEnd follower={follower} />,
      card: <FollowerCard follower={follower} actor={actor} you={you} book={book} />,
      replayMasked: !you,
    };
  });

  return (
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
      menu={{
        rows,
        noMatch: "No followers",
        foot: editable ? footRows(view.reader, writes) : undefined,
      }}
    />
  );
}
