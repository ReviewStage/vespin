// [step].tsx -- one step of setup, by the step its route names.

import { SETUP_STEP } from "@repo/settings";
import { Redirect, useLocalSearchParams } from "expo-router";
import { SetupStepScreen } from "../../../screens/setup-screens.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

export default function SetupStepRoute() {
  const { step = "" } = useLocalSearchParams<{ step: string }>();
  const known = Object.values(SETUP_STEP).find((one) => one === step);

  // Note that a route naming no step, as a stale link might, goes to where setup stands.
  if (known === undefined) return <Redirect href="/setup" />;

  return <SetupStepScreen step={known} />;
}
