import { AGENT_TOOL } from "@repo/features/agent-tools";
import { COMPUTER_PERMISSION, computerPermissionsNamed } from "@repo/features/machine-command-wire";
import { THIS_MAC } from "@repo/features/machine-name";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { computerPermissionsMissing } from "@repo/features/tool-call-model";
import { ACT_KIND } from "@repo/host/acts";
import { HOST_CAPABILITY } from "@repo/settings";
import { ErrorState } from "@repo/ui";
import { ACTOR_KIND, type Actor, actorName } from "@repo/ui/actor-model";
import { UNREPORTED } from "@repo/ui/reported-failure";
import type { UnparsedWireValue } from "@repo/wire";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { actFailureWords, askAct } from "../act.js";
import { QUERY_ROOT } from "../query-keys.js";
import { appStateQuery, selectCapability } from "../use-app-state.js";
import { useMacOwner } from "./transcript-blocks.js";

/**
 * computer-permission-note.tsx -- why a `computer` call ran nothing because the Mac lacked Screen Recording or Accessibility, said under its row where its window would have stood.
 *
 * The Mac refuses an action at once where it lacks a grant the action
 * needs (`compose-machine-commands.ts`), and the call's answer carries the
 * grants (`computerPermissionsMissing`). The answer's own words are the
 * agent's, so the row says its own to the reader instead, as every failure
 * with a remedy is said (`ErrorState`), where a read's window would have
 * drawn: which grants the app needs to
 * use apps, and where they are turned on. Read on that same Mac, the one
 * window that can grant them, the note offers Open System Settings, which
 * asks macOS for them and opens the pane of the first missing, and once
 * used where Screen Recording is missing, says to reopen the app, since
 * macOS applies that grant only then; read anywhere else, it names whose
 * Mac it is and says to turn them on there, since no press here reaches
 * that Mac.
 */

/** What the note says: the grants missing, on this Mac, or on the Mac it names. */
/** What the note's press says: it asks macOS for the grants and opens the pane of the first missing. */
const OPEN_SYSTEM_SETTINGS = "Open System Settings";

/** What the note adds once its press was used where Screen Recording is missing. */
const REOPEN = `Once Screen Recording is on, quit and reopen ${PRODUCT_NAME} for it to take effect.`;

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

/** Whether the window is the Mac an agent's computer calls run on: one that runs Mac commands, signed in as that Mac's owner (`MacOwnerProvider`), or where the window cannot tell whose Mac it is, which is then the reader's own. */
export function useOnThatMac(): boolean {
  const owner = useMacOwner();

  const runsCommands =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.MACHINE_COMMANDS) })
      .data === true;

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
  const queries = useQueryClient();
  const owner = useMacOwner();
  const thatMac = useOnThatMac();

  const asked = useMutation({
    mutationFn: () => askAct(ACT_KIND.COMPUTER_USE_ASK_PERMISSIONS, {}),
    onSettled: () => queries.invalidateQueries({ queryKey: [QUERY_ROOT.COMPUTER_USE_STATUS] }),
  });

  const missing = tool === AGENT_TOOL.COMPUTER ? computerPermissionsMissing(output) : undefined;

  if (missing === undefined) return null;
  const names = computerPermissionsNamed(missing.permissions);
  const them = missing.permissions.length === 1 ? "it" : "them";

  // Note that macOS applies Screen Recording only once the app is reopened, so a reader whose ask reached it is told so, and one whose ask did not is told why instead.
  const reopen =
    thatMac &&
    asked.isSuccess &&
    missing.permissions.includes(COMPUTER_PERMISSION.SCREEN_RECORDING);

  return (
    <div className="mt-list-gap mr-0 mb-item-gap ml-transcript-gutter">
      <ErrorState
        failure={UNREPORTED.TOOL}
        remedy={
          thatMac ? { label: OPEN_SYSTEM_SETTINGS, onClick: () => asked.mutate() } : undefined
        }
      >
        {noteWords(names, them, thatMac, owner)}
        {reopen ? ` ${REOPEN}` : null}
        {asked.isError ? ` ${actFailureWords(asked.error)}` : null}
      </ErrorState>
    </div>
  );
}
