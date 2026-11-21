/**
 * share-sheet.ts -- the app's half of the share extension (`share-extension/`): the snapshot of workspaces and repositories its sheet offers, kept current in the App Group, and the draft it kept, opened as New task once the app comes forward.
 *
 * The extension runs with no host, so it reads what New task would offer,
 * and where its Start is sent, from the snapshot the app writes
 * (`@repo/features/ios-share-wire`) whenever what it holds changes. Where it
 * can't start the task itself (`@repo/host`'s `issued-token-account-source.ts`), it keeps
 * what the member wrote as a draft
 * the app opens New task on, prefilled, each time it comes forward with an
 * account signed in and no update holding the app; until then it stays. A draft kept under another account is dropped. A
 * sign-out removes both files, so nothing of the account stays where the
 * extension reads.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import { CLIENT_PLATFORM } from "@repo/features/client-identity";
import {
  SHARE_DRAFT_PICTURE_FILES,
  type ShareDraftPictureFile,
  shareDraftOf,
  shareSnapshotOf,
} from "@repo/features/ios-share-wire";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectAccount, selectRepositoryList, selectWorkspaces } from "@repo/host/app-state-reads";
import { useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import {
  APP_GROUP_FILE,
  readAppGroupFile,
  removeAppGroupFile,
  writeAppGroupFile,
} from "./app-group.js";
import { useChosenWorkspace } from "./chosen-workspace.js";
import { appStateQuery } from "./host/app-state-query.js";
import { SERVICE_ORIGIN } from "./host/compose-mobile.js";
import { APP_VERSION, useTaskListCollections } from "./host/host-provider.js";
import { useSplashReleased } from "./splash.js";

/** Where the share sheet's Start goes, named as this build. */
const SHARE_SERVICE = {
  origin: SERVICE_ORIGIN,
  client: { platform: CLIENT_PLATFORM.IOS, version: APP_VERSION },
};

/**
 * The snapshot's JSON for the account signed in, read off the document as it
 * changes; none while none is. Note that its tasks are read only once the
 * launch's first screen stands, in no order and as their repositories and
 * starts alone (`newestRepositories`), since a read of every task sorted held
 * the launch's first frame at an account's size, and the snapshot written at
 * the last launch stands until then.
 */
function useSnapshotJson(accountId: string | undefined): string | undefined {
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const chosenId = useChosenWorkspace(workspaces).chosen?.id;
  const collections = useTaskListCollections();
  const drawn = useSplashReleased();

  const tasks = useLiveQuery((q) =>
    drawn
      ? q.from({ task: collections.tasks }).select(({ task }) => ({
          id: task.id,
          repository: task.repository,
          createdAt: task.createdAt,
        }))
      : undefined,
  ).data;

  const select = useCallback(
    (state: AppStateSnapshot) =>
      accountId === undefined || tasks === undefined
        ? undefined
        : JSON.stringify(
            shareSnapshotOf(
              accountId,
              chosenId,
              state.tasks.workspaces,
              tasks,
              (workspaceId) =>
                selectRepositoryList(workspaceId)(state)?.rows?.repositories.map(
                  ({ fullName }) => fullName,
                ),
              SHARE_SERVICE,
            ),
          ),
    [accountId, chosenId, tasks],
  );

  return useQuery({ ...appStateQuery, select }).data;
}

/** Removes every picture file a draft may have kept but those in `kept`. */
function removeDraftPictures(kept: readonly ShareDraftPictureFile[] = []): void {
  for (const name of SHARE_DRAFT_PICTURE_FILES) if (!kept.includes(name)) removeAppGroupFile(name);
}

/**
 * Opens New task on the draft the share sheet kept for `accountId`, where one
 * stands, and removes it. Its pictures go to New task by their files' names,
 * which New task reads from the group and deletes; a picture file no draft
 * for this account names is removed here.
 */
function useOpenDraft(accountId: string | undefined): void {
  const router = useRouter();
  useEffect(() => {
    if (accountId === undefined) return undefined;

    const open = () => {
      const kept = readAppGroupFile(APP_GROUP_FILE.SHARE_DRAFT);

      if (kept === undefined) return;
      removeAppGroupFile(APP_GROUP_FILE.SHARE_DRAFT);
      const draft = shareDraftOf(kept, accountId);
      removeDraftPictures(draft?.pictures);

      if (draft === undefined) return;
      router.push({
        pathname: "/start-task",
        params: {
          prompt: draft.prompt,
          ...(draft.pictures === undefined || draft.pictures.length === 0
            ? undefined
            : { pictures: JSON.stringify(draft.pictures) }),
          ...(draft.workspaceId === undefined ? undefined : { workspace: draft.workspaceId }),
          ...(draft.repository === undefined ? undefined : { repository: draft.repository }),
        },
      });
    };

    open();

    const listening = AppState.addEventListener("change", (state) => {
      if (state === "active") open();
    });

    return () => listening.remove();
  }, [accountId, router]);
}

/**
 * Keeps the share sheet's snapshot current while an account is signed in,
 * opens New task on a draft it kept, unless the update screen holds the app
 * (`updateNeeded`), where New task cannot open, and removes both once the account
 * signs out. Note that the files are removed on the change from signed in to
 * out, never on a launch's first read before the account is restored, which
 * would drop a draft kept while the app was closed.
 */
export function useShareSheet(updateNeeded: boolean): void {
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  const accountId = signedInAccountId(account);
  const snapshot = useSnapshotJson(accountId);
  const signedInBefore = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (snapshot !== undefined) writeAppGroupFile(APP_GROUP_FILE.SHARE_SNAPSHOT, snapshot);
  }, [snapshot]);
  useEffect(() => {
    if (accountId === undefined && signedInBefore.current !== undefined) {
      removeAppGroupFile(APP_GROUP_FILE.SHARE_SNAPSHOT);
      removeAppGroupFile(APP_GROUP_FILE.SHARE_DRAFT);
      removeDraftPictures();
    }

    signedInBefore.current = accountId;
  }, [accountId]);
  useOpenDraft(updateNeeded ? undefined : accountId);
}
