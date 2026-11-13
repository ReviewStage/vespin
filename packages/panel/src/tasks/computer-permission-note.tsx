import { AGENT_TOOL } from "@repo/features/agent-tools";
import { computerPermissionsNamed } from "@repo/features/mac-command-wire";
import { THIS_MAC } from "@repo/features/machine-name";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { computerPermissionsMissing } from "@repo/features/tool-call-model";
import { HOST_CAPABILITY } from "@repo/settings";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import { ErrorState } from "@repo/ui";
import { ACTOR_KIND, type Actor, actorName } from "@repo/ui/actor-model";
import { UNREPORTED } from "@repo/ui/reported-failure";
import type { UnparsedWireValue } from "@repo/wire";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { OPEN_SETTINGS_LABEL, useOpenSettings } from "../open-settings.js";
import { appStateQuery, selectCapability } from "../use-app-state.js";
import { useMacOwner } from "./transcript-blocks.js";

/**
 * computer-permission-note.tsx -- why a `computer` call ran nothing because the Mac lacked Screen Recording or Accessibility, said under its row where its window would have stood.
 *
 * The Mac refuses an action at once where it lacks a grant the action
 * needs (`compose-mac-commands.ts`), and the call's answer carries the
 * grants (`computerPermissionsMissing`). The answer's own words are the
 * agent's, so the row says its own to the reader instead, as every failure
 * with a remedy is said (`ErrorState`), where a read's window would have
 * drawn: which grants the app needs to
 * use apps, and where they are turned on. Read on that same Mac, the one
 * window that can grant them, the note offers Open Settings at This Mac,
 * whose rows ask macOS for them; read anywhere else, it names whose Mac it
 * is and says to turn them on there, since no press here reaches that Mac.
 */

/** What the note says: the grants missing, on this Mac, or on the Mac it names. */
function noteWords(
  names: string,
  them: string,
  thatMac: boolean,
  owner: Actor | undefined,
): string {
  if (thatMac) return `${PRODUCT_NAME} needs ${names} to use apps on this Mac.`;
  // Note that a Mac the window cannot name is the reader's own, as `MacOwnerProvider` says.

  const whose =
    owner === undefined ? "your" : actorName(owner, { sentence: true, possessive: true });

  return `${PRODUCT_NAME} on ${whose} Mac needs ${names} to use apps. Turn ${them} on in Settings › ${THIS_MAC} on that Mac.`;
}

/** Whether the window is the Mac the call ran on: one that runs Mac commands, signed in as that Mac's owner, or where the window cannot tell whose Mac it was, which is then the reader's own. */
function isThatMac(runsCommands: boolean, owner: Actor | undefined): boolean {
  if (!runsCommands) return false;

  return owner === undefined || (owner.kind === ACTOR_KIND.PERSON && owner.you);
}

/** The note under a computer call the Mac refused for a grant it lacked; nothing for any other call. */
export function ComputerPermissionNote({
  tool,
  output,
}: {
  tool: string;
  output: UnparsedWireValue | undefined;
}): ReactNode {
  const openSettings = useOpenSettings();
  const owner = useMacOwner();

  const runsCommands =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.MAC_COMMANDS) }).data ===
    true;

  const missing = tool === AGENT_TOOL.COMPUTER ? computerPermissionsMissing(output) : undefined;

  if (missing === undefined) return null;
  const thatMac = isThatMac(runsCommands, owner);
  const names = computerPermissionsNamed(missing.permissions);
  const them = missing.permissions.length === 1 ? "it" : "them";

  return (
    <div className="mt-list-gap mr-0 mb-item-gap ml-transcript-gutter">
      <ErrorState
        failure={UNREPORTED.TOOL}
        remedy={
          thatMac
            ? {
                label: OPEN_SETTINGS_LABEL,
                onClick: () => openSettings({ page: SETTINGS_VIEW.THIS_MAC }),
              }
            : undefined
        }
      >
        {noteWords(names, them, thatMac, owner)}
      </ErrorState>
    </div>
  );
}
