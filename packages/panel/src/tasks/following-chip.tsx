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
  MENU_ROW_WHY,
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
import { useState } from "react";
import { type Unreached, unreachedAs } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { ACTOR_SIZE, ActorHead, ActorMark, ActorStack } from "../actor-ref.js";
import { type PresenceBook, presenceStanding, useDevicePresence } from "../device-presence.js";
import { useMemberDirectory } from "../member-directory.js";
import { memberRows } from "../member-rows.js";
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
 * follows the task and Follow while they do not. Its popover is the
 * followers' checklist, as the reviewer picker is a pull request's: a
 * search field, then one list with no title, the reader first as You, each
 * follower checked, with a face, a name, a muted Assignee on the assignee,
 * and a laptop at its end where the task's agents may use that person's
 * machines. A press on a row adds or removes that person, the reader
 * themself among them, and the popover stays; the assignee stands checked
 * and dimmed, since they follow while assigned. Anyone the visit unchecked
 * stays listed, unchecked, in their place until the popover closes, so a
 * slip is one more press away from undone. Every other member of the
 * workspace is listed only once something is searched, by name or email,
 * so the list says who follows until the reader looks for someone to add.
 * Each row hangs the person's card: a follower's says Assignee or
 * Following, the reader's own machines each with the Runs on menu's dot and
 * its words for where the machine stands, and what the task's agents may do
 * on their machines. Pinned under the list stands the reader's own switch,
 * or Follow alone where they do not follow. A write is drawn on the task at
 * once (`compose-tasks.ts`), and a refusal said in a toast. Where the task
 * takes no change, the popover lists the followers alone.
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

/** The reader's follower writes on one task, each refusal said in a toast; a fixture run's go nowhere. The task's menu follows and unfollows through it too. */
export function useFollowerWrites(taskId: string) {
  const staged = useQuery({ ...appStateQuery, select: selectFixtureStaged }).data === true;
  const toast = useToast();
  const { mutateAsync: sendFollow } = useMutation(actMutation(ACT_KIND.TASKS_FOLLOW));
  const { mutateAsync: sendUnfollow } = useMutation(actMutation(ACT_KIND.TASKS_UNFOLLOW));

  const { mutateAsync: sendMachines } = useMutation(
    actMutation(ACT_KIND.TASKS_SET_FOLLOWER_MACHINES),
  );

  const { mutateAsync: sendAdd } = useMutation(actMutation(ACT_KIND.TASKS_ADD_FOLLOWER));
  const { mutateAsync: sendRemove } = useMutation(actMutation(ACT_KIND.TASKS_REMOVE_FOLLOWER));

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
    remove: (userId: string) => asked(() => sendRemove({ taskId, userId })),
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

/** The pinned row: the reader's own switch while they follow, or Follow where they do not. */
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
  ];
}

/**
 * The people the list holds this visit, by account id: the followers, the
 * reader first, until a press, and from the first press on the list as it
 * then stood, each follower added since after it, so a press moves no row
 * and someone unchecked keeps their place.
 */
function listedIds(followers: readonly string[], visit: readonly string[] | undefined): string[] {
  if (visit === undefined) return [...followers];

  return [...visit, ...followers.filter((id) => !visit.includes(id))];
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
  const { members, readerId } = useMemberDirectory();
  const view = followersView(followers, readerId);
  const actors = useFollowerActors(view.followers, task.assignee);
  const book = useDevicePresence(on && view.reader !== undefined);
  const writes = useFollowerWrites(task.id);
  // The list as the visit's first press found it, which holds its rows in place until the popover closes.
  const [visit, setVisit] = useState<readonly string[] | undefined>(undefined);

  if (!on) return null;

  const followerRows = new Map<string, MenuRow>(
    view.followers.map((follower, index) => {
      const actor = actors[index] ?? personActor(undefined, undefined, undefined);
      const you = follower === view.reader;

      return [
        follower.userId,
        {
          id: follower.userId,
          label: you ? FOLLOWING_WORDS.YOU : actorName(actor),
          icon: <ActorMark actor={actor} size={ACTOR_SIZE.INLINE} />,
          end: <RowEnd follower={follower} />,
          card: <FollowerCard follower={follower} actor={actor} you={you} book={book} />,
          // Note that the assignee's row says why by its own Assignee mark, so the dimmed row prints no second one.
          ...(follower.assignee && editable
            ? { disabled: FOLLOWING_WORDS.ASSIGNEE_STAYS, why: MENU_ROW_WHY.MARK }
            : undefined),
          replayMasked: !you,
        },
      ];
    }),
  );

  const memberRowsById = new Map<string, MenuRow>(
    memberRows(members, readerId).map((row) => [
      row.member.userId,
      {
        id: row.member.userId,
        label: row.actor.you ? FOLLOWING_WORDS.YOU : row.label,
        icon: row.icon,
        terms: row.terms,
        card: row.card,
        replayMasked: !row.actor.you,
      },
    ]),
  );

  const listed = editable
    ? listedIds(
        view.followers.map((follower) => follower.userId),
        visit,
      )
    : view.followers.map((follower) => follower.userId);

  const rows: readonly MenuRow[] = [
    ...listed.flatMap((id) => {
      const row = followerRows.get(id) ?? memberRowsById.get(id);

      return row === undefined ? [] : [row];
    }),
    // Note that everyone else is found by a search alone, so the list says who follows until the reader looks for someone.
    ...(editable
      ? [...memberRowsById.values()].flatMap((row) =>
          listed.includes(row.id) ? [] : [{ ...row, searchOnly: true }],
        )
      : []),
  ];

  const following = new Set(view.followers.map((follower) => follower.userId));

  const toggle = (userId: string) => {
    setVisit(listed.includes(userId) ? listed : [...listed, userId]);

    if (userId === readerId) return following.has(userId) ? writes.unfollow() : writes.follow();

    return following.has(userId) ? writes.remove(userId) : writes.add(userId);
  };

  const menu = editable
    ? {
        rows,
        checked: following,
        placeholder: FOLLOWING_WORDS.SEARCH,
        noMatch: FOLLOWING_WORDS.NO_MATCH,
        onPick: toggle,
        onClosed: () => setVisit(undefined),
        foot: footRows(view.reader, writes),
      }
    : { rows, noMatch: FOLLOWING_WORDS.NO_FOLLOWERS };

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
      menu={menu}
    />
  );
}
