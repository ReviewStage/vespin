// index.tsx -- setup's root: the spinner while what setup stands on is read, then the step the account's place stands at.

import { SETUP_GATE } from "@repo/settings";
import { Redirect } from "expo-router";
import { SetupWaitScreen } from "../../../screens/setup-screens.js";
import { SETUP_STEP_ROUTE, useSetupPlace } from "../../../setup/setup-place.js";
import { useSetupGate } from "../../../setup/use-setup-gate.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

/** Note that setup stands only while an account is signed in, so its gate is read as signed in. */
export default function SetupIndexRoute() {
  const gate = useSetupGate(true);
  const { steps, at } = useSetupPlace();
  const step = steps[at];

  if (gate === SETUP_GATE.WAIT || step === undefined) return <SetupWaitScreen />;

  return <Redirect href={{ pathname: SETUP_STEP_ROUTE, params: { step } }} />;
}
