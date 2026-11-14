import { signedInAccountId } from "@repo/credentials/snapshot";
import { computerAppNamed } from "@repo/features/agent-parts";
import type { CallMachine } from "@repo/features/tool-call-model";
import { MacAppCard } from "@repo/ui";
import { PICTURE_STATE } from "@repo/ui/picture-read";
import { useQuery } from "@tanstack/react-query";
import { machinesQuery } from "../live-reads.js";
import { appStateQuery, selectAccount } from "../use-app-state.js";
import { useComputerApps, useKeptPicture } from "./agent-pictures.js";
import { useAllowedAppIcon, useMacAppIcon } from "./mac-apps.js";
import { OnMachine } from "./transcript-blocks.js";
import { useWorkspaceMachines } from "./workspace-machines.js";

/**
 * mac-app-card.tsx -- the card an app on a machine hangs wherever a chip names it, an `@` mention's and the stack's of the apps an agent is using alike, filled in from what the window reads (`MacAppCard`).
 *
 * The card names the machine the app is on by the chip every tool call row
 * ends in (`OnMachine`), so that chip hangs the machine's own card and its
 * press does what it does there. Whether the machine lets agents use the
 * app unasked is its owner's setting, so it is said only where the machine
 * is one of the reader's own, as the account's machines read names it
 * (`LIVE_READ.MACHINES`), by the app's bundle id or its name as the machine
 * keeps it. Note that an app allowed once is allowed for one command alone,
 * so there is nothing standing for this agent to say of it, and that a call
 * keeps no time of its own, so the card says nothing of when the app was
 * last used.
 */

/** A machine as the card names it: its id and its name. */
type CardMachine = Pick<CallMachine, "id" | "name">;

/** Whether the reader's own machine named always lets agents use the app, by any of its spellings; none where the machine is not the reader's, is unread, or never said. */
function useAlwaysAllowed(
  machineId: string | undefined,
  spellings: readonly (string | undefined)[],
): boolean | undefined {
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const machines = useQuery(machinesQuery(machineId === undefined ? undefined : accountId)).data;
  const settings = machines?.find((machine) => machine.id === machineId)?.settings;

  if (settings === undefined) return undefined;

  return spellings.some(
    (spelled) => spelled !== undefined && settings.alwaysAllowedApps.includes(spelled),
  );
}

/**
 * The address of an app's icon, by its bundle id or its name: as this Mac
 * draws it, else as one of the reader's machines that allows it posted it,
 * else the icon a `computer` call kept for it (`kept`); none until one lands.
 */
export function useMacAppIconAddress(app: string, kept: string | undefined): string | undefined {
  const onMac = useMacAppIcon(app);
  const posted = useAllowedAppIcon(app);
  const own = onMac ?? posted;
  const keptState = useKeptPicture(own === undefined ? kept : undefined);

  return own ?? (keptState.kind === PICTURE_STATE.READY ? keptState.url : undefined);
}

/** An app's card as the window fills it in: its machine's chip where its machine is known, and whether that machine always allows it where it is the reader's own. */
export function MacAppChipCard({
  name,
  bundleId,
  iconSrc,
  machine,
  inUse = false,
}: {
  name: string;
  bundleId: string | undefined;
  iconSrc: string | undefined;
  machine: CardMachine | undefined;
  inUse?: boolean | undefined;
}): React.JSX.Element {
  const alwaysAllowed = useAlwaysAllowed(machine?.id, [bundleId, name]);

  return (
    <MacAppCard
      name={name}
      bundleId={bundleId}
      iconSrc={iconSrc}
      inUse={inUse}
      machine={machine === undefined ? undefined : <OnMachine machine={machine} />}
      alwaysAllowed={alwaysAllowed}
    />
  );
}

/**
 * The card an `@` mention of an app hangs: the app as the conversation's
 * `computer` calls named it on the machine the mention names, else on any,
 * and that machine by the name a call or the workspace's machines give it.
 * A mention written before machines were named names none, and its card
 * says nothing of one.
 */
export function MacAppMentionCard({
  app,
  machineId,
  name,
  wordsWorkspaceId,
}: {
  /** The app as the mention names it: its bundle id, or its name where it has none. */
  app: string;
  machineId: string | undefined;
  /** The name the chip calls it by. */
  name: string;
  /** The workspace the words are of, whose machines name the mention's. */
  wordsWorkspaceId: string | undefined;
}): React.JSX.Element {
  const apps = useComputerApps();
  const used = computerAppNamed(apps, app, machineId) ?? computerAppNamed(apps, app);
  const iconSrc = useMacAppIconAddress(app, used?.icon);
  const listed = useWorkspaceMachines(wordsWorkspaceId, machineId !== undefined).machines;
  const onMachine = used?.machine?.id === machineId ? used?.machine : undefined;
  const machineName = onMachine?.name ?? listed.find((each) => each.id === machineId)?.name;

  return (
    <MacAppChipCard
      name={used?.name ?? name}
      bundleId={used?.bundleId ?? (app === name ? undefined : app)}
      iconSrc={iconSrc}
      machine={
        machineId === undefined || machineName === undefined
          ? undefined
          : { id: machineId, name: machineName }
      }
    />
  );
}
