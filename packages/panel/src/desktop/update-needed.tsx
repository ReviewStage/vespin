// update-needed.tsx -- what stands in the work's place while the service refuses this build as older than it serves: it says so, where the update stands, the one press that moves it on, and the web app, which needs no update.

import { LINK_ORIGIN } from "@repo/features/link-home";
import { stayingOnWeb } from "@repo/features/link-open";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { BUILD_TOO_OLD_WORDS } from "@repo/features/words";
import { HOST_CAPABILITY } from "@repo/settings";
import type { UpdateControl } from "@repo/settings/settings-controls";
import { UPDATE_ROW_ACTION, type UpdateRow, updateNeededRow } from "@repo/settings/update-row";
import {
  EMPTY_STATE_ACTION_LOOK,
  EmptyState,
  type EmptyStateAction,
  ExternalIcon,
  FILL_ELEMENT,
  Fill,
  Toolbar,
  UpdateIcon,
} from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { appPlatform } from "../app-platform.js";
import { appStateQuery, selectCapability } from "../use-app-state.js";

/** What each press says. */
const UPDATE_NEEDED_WORDS = {
  CHECK: "Check for updates",
  CHECKING: "Checking for updates",
  RESTART: "Restart to update",
  DOWNLOAD: "Download",
  MOVE: "Move to Applications",
  WEB: `Open ${PRODUCT_NAME} on the web`,
} as const;

/**
 * The press that moves the update on from where it stands, as the update
 * row in Settings offers it, drawn primary since it is the place's point:
 * check for the release, restart into it once it is downloaded, fetch it in
 * the browser where installing in place failed or cannot be done, or move a
 * copy that cannot be replaced where it stands into Applications, whose
 * Download stays on Settings' row. Nothing while a download runs, whose
 * progress the line says, or for a development build.
 */
function updatePress(row: UpdateRow, updates: UpdateControl): EmptyStateAction | undefined {
  const look = EMPTY_STATE_ACTION_LOOK.PRIMARY;

  switch (row.action) {
    case UPDATE_ROW_ACTION.NONE:
    case UPDATE_ROW_ACTION.DOWNLOADING:
      return undefined;
    case UPDATE_ROW_ACTION.RESTART:
      return { label: UPDATE_NEEDED_WORDS.RESTART, look, onClick: updates.onInstall };
    case UPDATE_ROW_ACTION.GET:
      return {
        label: UPDATE_NEEDED_WORDS.DOWNLOAD,
        look,
        icon: <ExternalIcon />,
        onClick: updates.onOpenLatest,
      };
    case UPDATE_ROW_ACTION.MOVE:
      return { label: UPDATE_NEEDED_WORDS.MOVE, look, onClick: updates.onMoveToApplications };
    default:
      return {
        label: UPDATE_NEEDED_WORDS.CHECK,
        look,
        turns: row.action === UPDATE_ROW_ACTION.RETRY,
        onClick: () => void updates.onCheck(),
        busy: row.action === UPDATE_ROW_ACTION.CHECKING ? UPDATE_NEEDED_WORDS.CHECKING : undefined,
      };
  }
}

/**
 * The way on that needs no update: the web app, which ships with the service
 * and so always speaks what it serves, opened in the browser and flagged to
 * stay there rather than hand the reader straight back to this app
 * (`stayingOnWeb`). It carries the reader on while no newer release is out,
 * or while one downloads.
 */
const OPEN_ON_WEB: EmptyStateAction = {
  label: UPDATE_NEEDED_WORDS.WEB,
  icon: <ExternalIcon />,
  onClick: () => appPlatform().openWeb(stayingOnWeb(`${LINK_ORIGIN}/`)),
};

/**
 * Whether the work's place gives way to `UpdateNeeded`: the service refused
 * this build as older than it serves, and the platform updates itself. Note
 * that a platform that offers no updates, the web app, asks for a reload its
 * own way (`apps/web/src/app/web-host.ts`).
 */
export function useUpdateNeeded(): boolean {
  const offered =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.UPDATES) }).data === true;

  const needed =
    useQuery({ ...appStateQuery, select: (state) => state.network.updateNeeded }).data === true;

  return offered && needed;
}

/**
 * The work's place while the service refuses this build: one state saying
 * so, where the update stands (checking, downloading and how far, ready, or
 * failed), the one press that moves it on, and the web app beside it,
 * rather than every list and
 * page saying it could not be read and offering a Retry that cannot mend it.
 * It stands until the service answers with another status, which the live
 * reads' own retries find once the updated build runs.
 */
export function UpdateNeeded({ updates }: { updates: UpdateControl }): React.JSX.Element {
  const row = updateNeededRow(updates.update, updates.build);

  return (
    <>
      <Toolbar />
      <Fill as={FILL_ELEMENT.SECTION} className="desktop-empty-region">
        <EmptyState
          icon={<UpdateIcon />}
          title={BUILD_TOO_OLD_WORDS}
          replayUnmasked
          action={updatePress(row, updates)}
          secondary={OPEN_ON_WEB}
        >
          {row.detail}
        </EmptyState>
      </Fill>
    </>
  );
}
