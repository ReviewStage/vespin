/**
 * view-choices.ts -- the account's view choices as a test's host keeps them: the window's document names the account signed in, holding the choices given, and each write is drawn over them at once, as the host draws one ahead.
 */

import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import type { ViewChoiceWriteParams } from "@repo/features/agent-view";
import { LIVE_READ } from "@repo/features/live-wire";
import type { ViewChoiceLiveRow } from "@repo/features/view-choice-live";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { viewChoicesQuery } from "../live-reads.js";
import { appStateQuery } from "../use-app-state.js";
import { fakeActPort, fakeActPortCalls, fakeAppBridge, fakeAppBridgeCalls } from "./app-bridge.js";
import { stateWith } from "./app-state.js";
import { testQueryClientNow, writeAppState } from "./copy-feedback.js";

/** The id the account signed in goes by where the test's document names none. */
const CHOOSER_ID = "user-chooser";

/** The id the document's account goes by, `CHOOSER_ID` where it names none. */
function chooserOf(snapshot: AppStateSnapshot): string {
  const { account } = snapshot;

  return account.status === ACCOUNT_STATUS.SIGNED_IN && account.id ? account.id : CHOOSER_ID;
}

/** The choices kept with a write drawn over them: its row in its place, none where it forgets the choice. */
function written(
  rows: readonly ViewChoiceLiveRow[],
  write: ViewChoiceWriteParams,
): readonly ViewChoiceLiveRow[] {
  const { id, key, workspaceId, value } = write;
  const others = rows.filter((row) => row.key !== key || row.workspaceId !== workspaceId);

  return value === null ? others : [...others, { id, key, workspaceId, value }];
}

/**
 * Keeps the account's view choices for the test, starting at `rows`, over
 * the document the test handed: its account signed in, by its own id or one
 * given here, and each write drawn over the choices at once as the host
 * draws one ahead. Answers the writes heard, oldest first. Call it after the
 * test hands its document and its act port; the window reads the choices as
 * it reads the document.
 */
export function keepViewChoices(rows: readonly ViewChoiceLiveRow[] = []): ViewChoiceWriteParams[] {
  const heard: ViewChoiceWriteParams[] = [];
  let held = rows;

  const patched = (snapshot: AppStateSnapshot): AppStateSnapshot => {
    const chooser = chooserOf(snapshot);
    const { account } = snapshot;

    return {
      ...snapshot,
      account: account.status === ACCOUNT_STATUS.SIGNED_IN ? { ...account, id: chooser } : account,
      [LIVE_READ.VIEW_CHOICES]: { [chooser]: { rows: held } },
    };
  };

  // Note that a write heard before the window read any document lays an idle one, as a surface drawn with none still reads its choice back.
  const lay = (idle: boolean) => {
    const client = testQueryClientNow();

    const now =
      client.getQueryData<AppStateSnapshot>(appStateQuery.queryKey) ??
      (idle ? stateWith({}, {}) : undefined);

    if (now === undefined) return;
    writeAppState(patched(now));
    client.setQueryData(viewChoicesQuery(chooserOf(now)).queryKey, held);
  };

  const { requestAppState: handed, onAppState } = fakeAppBridgeCalls();
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    onAppState: onAppState ?? (() => () => undefined),
    requestAppState: () =>
      (handed === undefined ? Promise.resolve(stateWith({}, {})) : handed()).then(patched),
  });
  fakeActPort({
    ...fakeActPortCalls(),
    [ACT_KIND.VIEW_CHOICE_WRITE]: (write) => {
      heard.push(write);
      held = written(held, write);
      lay(true);

      return Promise.resolve({});
    },
  });
  lay(false);

  return heard;
}
