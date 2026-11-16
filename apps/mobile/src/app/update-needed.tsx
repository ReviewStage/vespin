// update-needed.tsx -- the screen that stands in front of every other while the service refuses this build as older than it serves: it says so and which build this is, and Update opens TestFlight.

import { BUILD_TOO_OLD_WORDS } from "@repo/features/words";
import { EmptyState, GLYPH, Screen } from "@repo/ui-native";
import { openURL } from "expo-linking";
import { buildWords } from "../build-words.js";

export { ScreenBoundary as ErrorBoundary } from "../screen-boundary.js";

/**
 * Where Update goes: the TestFlight app, which the app ships through, else
 * TestFlight's own page in the App Store where it isn't installed. Note that
 * this is TestFlight's root rather than the app's page in it, because a link
 * to that page names the app's App Store Connect Apple ID, which nothing here
 * records; the app's listing replaces it once there is one.
 */
const TESTFLIGHT_ADDRESS = {
  APP: "itms-beta://",
  STORE: "https://apps.apple.com/app/testflight/id899247664",
} as const;

/** What the screen says beside its acts. */
const UPDATE_WORDS = {
  DESCRIPTION: "Install the latest build from TestFlight.",
  UPDATE: "Update",
} as const;

/** What the screen says under its title: what to do, and which build this is, as support asks first. */
function descriptionWords(): string {
  const build = buildWords();

  return build === "" ? UPDATE_WORDS.DESCRIPTION : `${UPDATE_WORDS.DESCRIPTION} This is ${build}.`;
}

/** Opens TestFlight, or its App Store page where it isn't installed, saying on the console where neither opened. */
function openTestFlight(): void {
  openURL(TESTFLIGHT_ADDRESS.APP)
    .catch(() => openURL(TESTFLIGHT_ADDRESS.STORE))
    .catch((cause: unknown) => console.error("TestFlight did not open.", cause));
}

/**
 * The whole screen, over no tabs: every call the app makes is refused until
 * it is updated, so nothing behind it would work. The root layout's guard
 * stands it while the document's `network.updateNeeded` is set and gives the
 * tabs back at the service's next answer of another status, which the live
 * reads' own retries find within seconds, so it offers no Check again.
 */
export default function UpdateNeededScreen() {
  return (
    <Screen>
      <EmptyState
        title={BUILD_TOO_OLD_WORDS}
        symbol={GLYPH.UPDATE}
        description={descriptionWords()}
        action={{ label: UPDATE_WORDS.UPDATE, onPress: openTestFlight }}
      />
    </Screen>
  );
}
