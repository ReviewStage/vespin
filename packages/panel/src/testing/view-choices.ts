/**
 * view-choices.ts -- the account's view choices as a test's host keeps them: the window's document names the account signed in, holding the choices given, and each write is drawn over them at once, as the host draws one ahead (`drawnViewChoice`).
 */

import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import type { ViewChoiceWriteParams } from "@repo/features/agent-view";
import { LIVE_READ } from "@repo/features/live-wire";
import type { ViewChoiceLiveRow } from "@repo/features/view-choice-live";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { appStateQuery, drawAhead } from "../use-app-state.js";
import {
  drawnViewChoice,
  fakeActPort,
  fakeActPortCalls,
  fakeAppBridge,
  fakeAppBridgeCalls,
} from "./app-bridge.js";
import { stateWith } from "./app-state.js";
import { testQueryClientNow, writeAppState } from "./copy-feedback.js";

/** A promise that never settles, so the choices handed stand for the window's life. */
const NEVER_SETTLED = new Promise<never>(() => undefined);

/** The id the account signed in goes by where the test's document names none. */
const CHOOSER_ID = "user-chooser";

/** The id the document's account goes by, `CHOOSER_ID` where it names none. */
function chooserOf(snapshot: AppStateSnapshot): string {
  const { account } = snapshot;

  return account.status === ACCOUNT_STATUS.SIGNED_IN && account.id ? account.id : CHOOSER_ID;
}

/** Answers the window's view choices' writes as the host draws them (`drawnViewChoice`), beside whatever acts the test answers by now, and answers every write heard, oldest first. */
export function hearViewChoices(): ViewChoiceWriteParams[] {
  const heard: ViewChoiceWriteParams[] = [];
  fakeActPort({
    ...fakeActPortCalls(),
    [ACT_KIND.VIEW_CHOICE_WRITE]: (write) => {
      heard.push(write);

      return drawnViewChoice(write);
    },
  });

  return heard;
}

/**
 * Keeps the account's view choices for the test, starting at `rows`, over
 * the document the test handed, or an idle one where it handed none: its
 * account signed in, by its own id or one given here, and each write drawn
 * over the choices at once as the host draws one ahead. Answers the writes
 * heard, oldest first. Call it after the test hands its act port, before or
 * after the window draws.
 */
export function keepViewChoices(rows: readonly ViewChoiceLiveRow[] = []): ViewChoiceWriteParams[] {
  const patched = (snapshot: AppStateSnapshot): AppStateSnapshot => {
    const chooser = chooserOf(snapshot);
    const { account } = snapshot;

    return {
      ...snapshot,
      account: account.status === ACCOUNT_STATUS.SIGNED_IN ? { ...account, id: chooser } : account,
      [LIVE_READ.VIEW_CHOICES]: { [chooser]: { rows } },
    };
  };

  // Note that the choices are drawn over every document the window is handed (`drawAhead`), so a push laid after them never takes them back; and that a window handed no document is laid an idle one, as a surface drawn with none still reads its choice back.
  const client = testQueryClientNow();
  drawAhead(client, patched, NEVER_SETTLED);

  if (client.getQueryData(appStateQuery.queryKey) === undefined) {
    writeAppState(patched(stateWith({}, {})));
  }

  const { requestAppState, onAppState } = fakeAppBridgeCalls();
  fakeAppBridge({
    ...fakeAppBridgeCalls(),
    onAppState: onAppState ?? (() => () => undefined),
    requestAppState: requestAppState ?? (() => Promise.resolve(stateWith({}, {}))),
  });

  return hearViewChoices();
}
