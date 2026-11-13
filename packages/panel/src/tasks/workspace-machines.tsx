import { signedInAccountId } from "@repo/credentials/snapshot";
import { DEVICE_STANDING } from "@repo/features/agent-wire";
import { DEVICE_PLATFORM_NAME } from "@repo/features/device-platform";
import { ENTITY_KIND } from "@repo/features/entity-kind";
import { type WorkspaceMachine, workspaceOfSlug } from "@repo/features/workspace-wire";
import { ACT_KIND } from "@repo/host/acts";
import { HoverCard, HoverCardHead, HoverCardNote } from "@repo/ui";
import { personActor } from "@repo/ui/actor-model";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { Duration } from "effect";
import type { ReactNode } from "react";
import { askAct } from "../act.js";
import { ACTOR_SIZE, ActorMark } from "../actor-ref.js";
import { EntityGlyph } from "../entities/entity-glyph.js";
import { useMemberDirectory } from "../member-directory.js";
import { QUERY_ROOT } from "../query-keys.js";
import { appStateQuery, selectAccount, selectWorkspaces } from "../use-app-state.js";
import { DeviceGlyph, DeviceStandingGlyph } from "./runs-on.js";

/**
 * workspace-machines.tsx -- the machines of a workspace's members, as the `@` list offers them and a machine's chip draws one: its platform's glyph wearing its online dot, its owner's face, its name, and its card.
 *
 * A machine is mentioned by its id alone (`@repo/features/mention-link`),
 * so what its chip draws beside the name it was written with, its
 * platform, whose it is, and whether it is online, is read here, once per
 * workspace and shared by every chip and list that draws one
 * (`ACT_KIND.WORKSPACE_MACHINES_READ`). A machine is drawn as the agent's
 * Default machine menu draws one (`agent-machines.tsx`): its platform's
 * glyph wearing the online or offline dot of every list of places
 * (`runs-on.tsx`'s `DeviceStandingGlyph`), a bare Mac's while the read is
 * out, and, before its name, its owner's face where it is a teammate's,
 * since the reader's own needs no saying whose it is.
 */

/** How long a workspace's machines read stands before a place drawing them reads it again: about as long as a machine stays online once its app stops listening, so a dot is never long out of date. */
const FRESH_FOR = Duration.seconds(30);

/** What a machine's card says where the workspace's machines read names it not: removed, or of someone who left. */
const UNLISTED_WORDS = "No longer one of the workspace's machines";

/** The machines of a workspace's members, read once per workspace and kept a few minutes. */
function workspaceMachinesQuery(workspaceId: string | undefined) {
  return queryOptions({
    queryKey: [QUERY_ROOT.WORKSPACE_MACHINES, workspaceId],
    queryFn: () =>
      workspaceId === undefined
        ? Promise.reject(new Error("No workspace is listed."))
        : askAct(ACT_KIND.WORKSPACE_MACHINES_READ, { workspaceId }),
    enabled: workspaceId !== undefined,
    staleTime: Duration.toMillis(FRESH_FOR),
    retry: false,
  });
}

/** A workspace's machines as a place reads them: as read, whether the read is out, whether it failed, and the press that reads them again. */
interface WorkspaceMachines {
  readonly machines: readonly WorkspaceMachine[];
  readonly reading: boolean;
  readonly failed: boolean;
  readonly retry: () => void;
}

/** The machines of the workspace given, read while `asked`; none while it is not. */
export function useWorkspaceMachines(
  workspaceId: string | undefined,
  asked = true,
): WorkspaceMachines {
  const read = useQuery({
    ...workspaceMachinesQuery(workspaceId),
    enabled: asked && workspaceId !== undefined,
  });

  return {
    machines: read.data?.machines ?? [],
    reading: asked && workspaceId !== undefined && read.isPending,
    failed: read.isError && !read.isFetching,
    retry: () => void read.refetch(),
  };
}

/** The machine a chip names as read, and whether the workspace's machines were read at all. */
interface MachineRead {
  readonly machine: WorkspaceMachine | undefined;
  readonly read: boolean;
}

/** The machine a chip names, as the workspace its link was written under reads it; none while unread, or where the read names it not. */
function useMachine(machineId: string, slug: string): MachineRead {
  const workspaces = useQuery({ ...appStateQuery, select: selectWorkspaces }).data;
  const workspace = workspaces === undefined ? undefined : workspaceOfSlug(workspaces, slug);
  const read = useQuery(workspaceMachinesQuery(workspace?.id));

  return {
    machine: read.data?.machines.find((each) => each.id === machineId),
    read: read.data !== undefined,
  };
}

/** Who reads the window: the members around the caller say it, else the account signed in. */
function useReaderId(): string | undefined {
  const directory = useMemberDirectory();
  const account = useQuery({ ...appStateQuery, select: selectAccount }).data;

  return directory.readerId ?? signedInAccountId(account);
}

/** A machine's owner's face as the members around it draw them; none for the reader's own machine. */
export function MachineOwnerFace({ userId }: { userId: string }): ReactNode {
  const { members, former } = useMemberDirectory();
  const readerId = useReaderId();

  if (userId === readerId) return null;
  const name = members?.find((member) => member.userId === userId)?.name ?? "";

  return (
    <ActorMark
      actor={personActor({ userId, name }, members, readerId, former)}
      size={ACTOR_SIZE.INLINE}
    />
  );
}

/** A machine as every list of places draws it: its platform's glyph wearing its online or offline dot. */
export function MachineGlyph({ machine }: { machine: WorkspaceMachine }): React.JSX.Element {
  return (
    <DeviceStandingGlyph
      device={machine}
      standing={machine.online ? DEVICE_STANDING.ONLINE : DEVICE_STANDING.OFFLINE}
    />
  );
}

/** A machine's chip's mark: its glyph wearing its dot, a bare Mac's while the machine is unread. */
export function MachineMark({ machineId, workspace }: { machineId: string; workspace: string }) {
  const { machine } = useMachine(machineId, workspace);

  return machine === undefined ? (
    <DeviceGlyph device={undefined} />
  ) : (
    <MachineGlyph machine={machine} />
  );
}

/** What stands before a machine's chip's name: its owner's face, where it is a teammate's. */
export function MachineChipOwner({
  machineId,
  workspace,
}: {
  machineId: string;
  workspace: string;
}): ReactNode {
  const { machine } = useMachine(machineId, workspace);

  return machine === undefined ? null : <MachineOwnerFace userId={machine.userId} />;
}

/** A machine's card: its glyph and name, whose it is and what it is under it, or that the workspace no longer lists it. */
export function MachineChipCard({
  machineId,
  workspace,
  name,
}: {
  machineId: string;
  workspace: string;
  name: string;
}): React.JSX.Element {
  const { machine, read } = useMachine(machineId, workspace);
  const { members } = useMemberDirectory();
  const readerId = useReaderId();
  const kind = machine === undefined ? undefined : DEVICE_PLATFORM_NAME[machine.platform];
  const owner = members?.find((member) => member.userId === machine?.userId)?.name;
  const yours = machine !== undefined && machine.userId === readerId;

  const sub =
    kind === undefined
      ? undefined
      : yours
        ? `Your ${kind}`
        : owner === undefined
          ? kind
          : `${owner}'s ${kind}`;

  return (
    <HoverCard data-mention-card="">
      <HoverCardHead
        glyph={
          machine === undefined ? (
            <EntityGlyph kind={ENTITY_KIND.MACHINE} />
          ) : (
            <MachineGlyph machine={machine} />
          )
        }
        name={name}
        sub={sub}
      />
      {read && machine === undefined ? <HoverCardNote>{UNLISTED_WORDS}</HoverCardNote> : null}
    </HoverCard>
  );
}
