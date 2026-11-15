// update-needed.tsx -- the whole window while the service refuses this build as older than it serves: Update required, where the update stands, the one press that moves it on, and the web app, which needs no update.

import { LINK_ORIGIN } from "@repo/features/link-home";
import { stayingOnWeb } from "@repo/features/link-open";
import { VERB } from "@repo/features/words";
import { HOST_CAPABILITY } from "@repo/settings";
import type { UpdateControl } from "@repo/settings/settings-controls";
import {
  UPDATE_ROW_ACTION,
  type UpdateRow,
  updateNeededLine,
  updateRow,
} from "@repo/settings/update-row";
import {
  EMPTY_STATE_ACTION_LOOK,
  EmptyState,
  type EmptyStateAction,
  ExternalIcon,
  ScrollArea,
  UpdateIcon,
} from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { appPlatform } from "../app-platform.js";
import { appStateQuery, selectCapability } from "../use-app-state.js";

/** What the screen and its presses say. */
const UPDATE_NEEDED_WORDS = {
  TITLE: "Update required",
  CHECK: "Check for updates",
  CHECK_AGAIN: "Check again",
  CHECKING: "Checking for updates",
  RESTART: "Restart to update",
  DOWNLOAD: "Download",
  MOVE: "Move to Applications",
} as const;

/**
 * The press that moves the update on from where it stands, as the update
 * row in Settings offers it, drawn primary since it is the screen's point:
 * check for the release, or check again where the last check found nothing
 * newer or could not reach the feed; restart into it once it is downloaded;
 * fetch it in the browser where installing in place failed or cannot be
 * done; or move a copy that cannot be replaced where it stands into
 * Applications. Nothing while a download runs, whose progress the line
 * says, or for a development build.
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
        label:
          row.current || row.action === UPDATE_ROW_ACTION.RETRY
            ? UPDATE_NEEDED_WORDS.CHECK_AGAIN
            : UPDATE_NEEDED_WORDS.CHECK,
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
const OPEN_IN_BROWSER: EmptyStateAction = {
  label: VERB.OPEN_IN_BROWSER,
  icon: <ExternalIcon />,
  onClick: () => appPlatform().openWeb(stayingOnWeb(`${LINK_ORIGIN}/`)),
};

/**
 * Whether the window gives way to `UpdateNeeded`: the service refused this
 * build as older than it serves, and the platform updates itself. Note that
 * a platform that offers no updates, the web app, asks for a reload its own
 * way (`apps/web/src/app/web-host.ts`).
 */
export function useUpdateNeeded(): boolean {
  const offered =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.UPDATES) }).data === true;

  const needed =
    useQuery({ ...appStateQuery, select: (state) => state.network.updateNeeded }).data === true;

  return offered && needed;
}

/**
 * The whole window while the service refuses this build, on the sign-in's
 * own ground, with no sidebar, since every place it leads to is refused:
 * Update required, one line where the update stands (checking, downloading
 * and how far, not out yet, or failed), the one press that moves it on, and
 * Open in browser, rather than every list and page saying it could not be
 * read and offering a Retry that cannot mend it. Settings stays a key away.
 * It stands until the service answers with another status, which the live
 * reads' own retries find once the updated build runs.
 */
export function UpdateNeeded({ updates }: { updates: UpdateControl }): React.JSX.Element {
  const row = updateRow(updates.update, updates.build);
  const line = updateNeededLine(updates.update, updates.build);

  return (
    <ScrollArea>
      <div className="desktop-onboarding relative flex min-h-full flex-col">
        <div className="desktop-drag-strip absolute inset-x-0 top-0" />
        <EmptyState
          icon={<UpdateIcon />}
          title={UPDATE_NEEDED_WORDS.TITLE}
          replayUnmasked
          action={updatePress(row, updates)}
          secondary={OPEN_IN_BROWSER}
        >
          {line}
        </EmptyState>
      </div>
    </ScrollArea>
  );
}
