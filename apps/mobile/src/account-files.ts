/**
 * account-files.ts -- the pictures and files the app keeps under its caches let go whenever the account signed in changes, by a sign-out or any other way, so one account never reads another's.
 *
 * A sign-out lets them go as it signs out (`sign-out.ts`). An account can
 * also change with no sign-out the app ran, such as a session the service
 * ended followed by another person signing in, so the account the kept files
 * belong to is written beside them, and the files are let go whenever the
 * account signed in is another. Note that the account's id is written in
 * the app's own caches alone, which iOS clears with the files it names.
 */

import { signedInAccountId } from "@repo/credentials/snapshot";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { useQuery } from "@tanstack/react-query";
import { File, Paths } from "expo-file-system";
import { useEffect } from "react";
import { appStateQuery } from "./host/app-state-query.js";
import { forgetPictureFiles } from "./picture-files.js";
import { forgetServiceFiles } from "./service-file.js";

/** The file the account the kept files belong to is written in. */
const ACCOUNT_MARK = "kept-files-account";

/** The account signed in, by its id; none while nobody is. */
function selectAccountId(state: AppStateSnapshot): string | undefined {
  return signedInAccountId(state.account);
}

/** The account the kept files belong to, as written beside them; none where none is written. */
function keptAccount(mark: File): string | undefined {
  return mark.exists ? mark.textSync() : undefined;
}

/**
 * Lets go of the kept pictures and files whenever the account signed in is
 * not the one they belong to, then writes that it is theirs now, so a
 * picture or a file kept for one account is never drawn for another.
 */
export function useAccountFiles(): void {
  const accountId = useQuery({ ...appStateQuery, select: selectAccountId }).data;

  useEffect(() => {
    if (accountId === undefined) return;
    const mark = new File(Paths.cache, ACCOUNT_MARK);

    if (keptAccount(mark) === accountId) return;

    try {
      forgetServiceFiles();
    } catch (cause: unknown) {
      console.error("The kept files were not let go.", cause);
    }

    forgetPictureFiles()
      .catch((cause: unknown) => console.error("The kept pictures were not let go.", cause))
      .finally(() => mark.write(accountId));
  }, [accountId]);
}
