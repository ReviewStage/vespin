import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  AGENT_FOLLOWER_FAILURE,
  type AgentFollowersAnswerView,
  MANAGER_PEOPLE_WORDS,
  managerFollowerMachinesSentence,
  managerFollowerRefusedNote,
  managerFollowerRole,
} from "@repo/features/agent-followers-view";
import type { AgentFollowerWire } from "@repo/features/agent-followers-wire";
import { machineLetsAgents } from "@repo/features/machine-live";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { FOLLOWING_WORDS } from "@repo/features/task-followers-model";
import { ACT_KIND } from "@repo/host/acts";
import {
  type MenuRow as PickedRow,
  SETTINGS_SKELETON_CONTROL,
  type SettingsRowSkeletonLayout,
  SettingsRowsSkeleton,
  SettingsRowValue,
  SettingsSection,
  STATUS_TONE,
} from "@repo/ui";
import { actorName, personActor } from "@repo/ui/actor-model";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { askAct, type Unreached, unreachedAs } from "../act.js";
import { actMutation } from "../act-mutations.js";
import { ACTOR_SIZE, ActorMark, actorMarkWidth, PersonName } from "../actor-ref.js";
import { machinesQuery } from "../live-reads.js";
import { useWorkspaceDirectory } from "../member-directory.js";
import { memberReadNote, memberRows } from "../member-rows.js";
import { QUERY_ROOT } from "../query-keys.js";
import { AddMenuButton } from "../settings/add-menu-button.js";
import { ReadFailed } from "../settings/marks.js";
import { MenuRow } from "../settings/menu-row.js";
import { SwitchRow } from "../settings/switch-row.js";
import { useToast } from "../toast.js";
import { appStateQuery, selectAccount } from "../use-app-state.js";

/**
 * manager-people-section.tsx -- Manager Settings › People: who follows the Manager, whether it may use each one's machines, the reader's own switch, and adding or removing a follower.
 *
 * A Manager's followers stand in for a task's, so the section says what the
 * task's Following popover says (`following-chip.tsx`) with the Manager in
 * the task's place: one row a follower, the reader's first, each with their
 * face, their name, You on the reader's own, Owner on the Manager's owner,
 * and a line saying whether the Manager may use their machines. A row's ⋯
 * holds Remove, or Unfollow on the reader's own; the owner's holds nothing,
 * since they always follow it with their machines on, so their Owner ends at
 * the row's edge as any row without a ⋯ does. Add person, at the
 * head, lists the workspace's members who do not follow yet, the reader as
 * You among them, as every people menu lists them (`memberRows`). Under the
 * list stands the reader's own switch, Let agents here use my machines,
 * which turns on a follow where they do not follow yet, and stands locked
 * on for the owner. The followers are read as the section shows (held
 * nowhere in the host), each write's answer laid over that read at once, and
 * a refusal said in a toast, as the popover's are.
 */

/**
 * A follower's row while the followers are read: their face at a card's
 * size, the line under the name, the role, and the ⋯. Note that it is
 * built as the skeleton draws, because the dialog that holds this section
 * is reached from the faces' own module, so their sizes are not read yet as
 * this module loads.
 */
function followerRowSkeleton(): SettingsRowSkeletonLayout {
  return {
    described: true,
    mark: actorMarkWidth(ACTOR_SIZE.CARD),
    controls: [SETTINGS_SKELETON_CONTROL.VALUE],
    end: [SETTINGS_SKELETON_CONTROL.MORE],
  };
}

/** How many rows stand for the followers while they are read: the owner, and one more. */
const FOLLOWERS_SKELETON_ROWS = 2;

/** A follower write's answer as the window hears it: the host's, or one that never arrived. */
type FollowerAnswer =
  | AgentFollowersAnswerView
  | Unreached<typeof AGENT_FOLLOWER_FAILURE.UNANSWERED>;

/** What the window draws for a follower write that never answered. */
const followerUnreached = unreachedAs(AGENT_FOLLOWER_FAILURE.UNANSWERED);

/** A Manager's followers as the section reads and writes them: the read, and each write, whose answer is laid over the read or said in a toast. */
function useManagerFollowers(agentId: string) {
  const queries = useQueryClient();
  const toast = useToast();
  const key = [QUERY_ROOT.MANAGER_FOLLOWERS, agentId];

  const read = useQuery({
    queryKey: key,
    queryFn: () => askAct(ACT_KIND.AGENTS_FOLLOWERS, { agentId }),
    retry: false,
  });

  const { mutateAsync: sendFollow } = useMutation(actMutation(ACT_KIND.AGENTS_FOLLOW));
  const { mutateAsync: sendUnfollow } = useMutation(actMutation(ACT_KIND.AGENTS_UNFOLLOW));

  const { mutateAsync: sendMachines } = useMutation(
    actMutation(ACT_KIND.AGENTS_SET_FOLLOWER_MACHINES),
  );

  const { mutateAsync: sendAdd } = useMutation(actMutation(ACT_KIND.AGENTS_ADD_FOLLOWER));
  const { mutateAsync: sendRemove } = useMutation(actMutation(ACT_KIND.AGENTS_REMOVE_FOLLOWER));

  // Note that a write answers the followers whole, so its answer stands in the read's place; a refusal leaves the read as it stood.
  const asked = (sent: () => Promise<AgentFollowersAnswerView>): Promise<boolean> =>
    sent()
      .catch(followerUnreached)
      .then(async (answer: FollowerAnswer) => {
        if (!("failure" in answer)) {
          // Note that a read still under way is canceled first, so its older followers cannot land over the write's.
          await queries.cancelQueries({ queryKey: key, exact: true });
          queries.setQueryData(key, answer);

          return true;
        }

        toast({
          replayUnmasked: true,
          words: managerFollowerRefusedNote(answer.failure),
          tone: STATUS_TONE.DANGER,
          failure: { surface: FAILURE_SURFACE.MANAGER_SETTINGS, cause: answer, about: { agentId } },
        });

        return false;
      });

  return {
    read,
    follow: () => asked(() => sendFollow({ agentId })),
    unfollow: () => asked(() => sendUnfollow({ agentId })),
    setMachines: (machines: boolean) => asked(() => sendMachines({ agentId, machines })),
    add: (userId: string) => asked(() => sendAdd({ agentId, userId })),
    remove: (userId: string) => asked(() => sendRemove({ agentId, userId })),
  };
}

type FollowerWrites = ReturnType<typeof useManagerFollowers>;

/** The followers the reader's list draws: the reader's own first, then the rest as the service ordered them, the owner first. */
function readerFirst(
  followers: readonly AgentFollowerWire[],
  readerId: string | undefined,
): readonly AgentFollowerWire[] {
  const reader = followers.filter((each) => each.userId === readerId);

  return [...reader, ...followers.filter((each) => each.userId !== readerId)];
}

/** One follower's row: their face, name, and whether the Manager may use their machines, Owner on the owner, and Remove or Unfollow behind its ⋯. */
function FollowerRow({
  follower,
  workspaceId,
  readerId,
  writes,
}: {
  follower: AgentFollowerWire;
  workspaceId: string | undefined;
  readerId: string | undefined;
  writes: FollowerWrites;
}): React.JSX.Element {
  const { members, former } = useWorkspaceDirectory(
    workspaceId === undefined ? undefined : { id: workspaceId },
  );

  const name = members?.find((member) => member.userId === follower.userId)?.name;

  const actor = personActor(
    name === undefined ? undefined : { userId: follower.userId, name },
    members,
    readerId,
    former,
  );

  const you = follower.userId === readerId;
  const shown = you ? FOLLOWING_WORDS.YOU : actorName(actor);
  const whose = you ? "your" : actorName(actor, { possessive: true });

  const acts = follower.owner
    ? []
    : [
        you
          ? { label: FOLLOWING_WORDS.UNFOLLOW, onSelect: () => void writes.unfollow() }
          : {
              label: MANAGER_PEOPLE_WORDS.REMOVE,
              danger: true,
              onSelect: () => void writes.remove(follower.userId),
            },
      ];

  return (
    <MenuRow
      thing={shown}
      actions={acts}
      row={{
        leading: (
          <ReplayMask>
            <ActorMark actor={actor} size={ACTOR_SIZE.CARD} />
          </ReplayMask>
        ),
        label: <PersonName name={name ?? actorName(actor)} you={you} />,
        description: <ReplayMask>{managerFollowerMachinesSentence(follower, whose)}</ReplayMask>,
        control: follower.owner ? (
          <SettingsRowValue>{managerFollowerRole(follower)}</SettingsRowValue>
        ) : null,
      }}
    />
  );
}

/** Add person: the workspace's members who do not follow the Manager yet, the reader as You, each added at a pick. */
function AddPerson({
  followers,
  workspaceId,
  writes,
}: {
  followers: readonly AgentFollowerWire[];
  workspaceId: string | undefined;
  writes: FollowerWrites;
}): React.JSX.Element {
  const directory = useWorkspaceDirectory(
    workspaceId === undefined ? undefined : { id: workspaceId },
  );

  const following = new Set(followers.map((each) => each.userId));

  const rows: readonly PickedRow[] = memberRows(directory.members, directory.readerId).flatMap(
    (row) =>
      following.has(row.member.userId)
        ? []
        : [
            {
              id: row.member.userId,
              label: row.actor.you ? FOLLOWING_WORDS.YOU : row.label,
              icon: row.icon,
              terms: row.terms,
              card: row.card,
              replayMasked: !row.actor.you,
            },
          ],
  );

  const pick = (userId: string) =>
    void (userId === directory.readerId ? writes.follow() : writes.add(userId));

  return (
    <AddMenuButton
      label={MANAGER_PEOPLE_WORDS.ADD}
      placeholder={MANAGER_PEOPLE_WORDS.SEARCH}
      noMatch={FOLLOWING_WORDS.NO_MATCH}
      rows={rows}
      note={memberReadNote(directory)}
      onOpen={directory.refused ? directory.retry : undefined}
      onPick={pick}
      replayUnmasked
    />
  );
}

/** The reader's own switch: on where they let the Manager use their machines, a follow where they do not follow yet, and locked on for the owner. */
function OwnMachines({
  reader,
  writes,
}: {
  reader: AgentFollowerWire | undefined;
  writes: FollowerWrites;
}): React.JSX.Element {
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const machines = useQuery(machinesQuery(accountId));
  // Note that nothing is said until the machines are read, so the switch never flashes None set up.
  const noneSetUp = machines.data !== undefined && !machines.data.some(machineLetsAgents);

  const turn = (on: boolean) => {
    // Note that a follow starts with the machines off, so turning the switch on where the reader does not follow follows first.
    if (reader === undefined) {
      if (on) void writes.follow().then((followed) => followed && writes.setMachines(true));

      return;
    }

    void writes.setMachines(on);
  };

  return (
    <SwitchRow
      label={FOLLOWING_WORDS.MACHINES}
      labelReplayUnmasked
      detail={noneSetUp ? FOLLOWING_WORDS.NONE_SET_UP : undefined}
      checked={reader?.machines ?? false}
      locked={reader?.owner === true ? MANAGER_PEOPLE_WORDS.OWNER_MACHINES : undefined}
      onChange={turn}
    />
  );
}

/** Manager Settings › People, for the Manager `agentId` of the workspace `workspaceId`. */
export function ManagerPeopleSection({
  agentId,
  workspaceId,
}: {
  agentId: string;
  workspaceId: string | undefined;
}): React.JSX.Element {
  const writes = useManagerFollowers(agentId);

  const { readerId } = useWorkspaceDirectory(
    workspaceId === undefined ? undefined : { id: workspaceId },
  );

  const answer = writes.read.data;
  const followers = answer === undefined || "failure" in answer ? undefined : answer.followers;

  const list =
    followers !== undefined ? (
      readerFirst(followers, readerId).map((follower) => (
        <FollowerRow
          key={follower.userId}
          follower={follower}
          workspaceId={workspaceId}
          readerId={readerId}
          writes={writes}
        />
      ))
    ) : answer === undefined && !writes.read.isError ? (
      <SettingsRowsSkeleton
        label={MANAGER_PEOPLE_WORDS.READING}
        rows={Array.from({ length: FOLLOWERS_SKELETON_ROWS }, followerRowSkeleton)}
      />
    ) : (
      <ReadFailed
        line={MANAGER_PEOPLE_WORDS.UNREAD}
        surface={FAILURE_SURFACE.MANAGER_SETTINGS}
        about={{ agentId }}
        onRetry={() => void writes.read.refetch()}
      />
    );

  return (
    <>
      <SettingsSection
        title={MANAGER_PEOPLE_WORDS.HEAD}
        caption={MANAGER_PEOPLE_WORDS.CAPTION}
        action={
          followers === undefined ? undefined : (
            <AddPerson followers={followers} workspaceId={workspaceId} writes={writes} />
          )
        }
      >
        {list}
      </SettingsSection>
      {followers === undefined ? null : (
        <SettingsSection>
          <OwnMachines
            reader={followers.find((each) => each.userId === readerId)}
            writes={writes}
          />
        </SettingsSection>
      )}
    </>
  );
}
