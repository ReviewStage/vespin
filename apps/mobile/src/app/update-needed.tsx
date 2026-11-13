// update-needed.tsx -- the screen that stands in front of every other while the service refuses this build as older than it serves: it says so, and Update opens TestFlight.

import { BUILD_TOO_OLD_WORDS } from "@repo/features/words";
import { EmptyState, GLYPH, Screen } from "@repo/ui-native";
import { openURL } from "expo-linking";

export { ScreenBoundary as ErrorBoundary } from "../screen-boundary.js";

/**
 * Where Update goes: the TestFlight app, which the app ships through. Note
 * that this is TestFlight's own root rather than the app's page in it,
 * because a link to that page names the app's App Store Connect Apple ID,
 * which nothing here records; the app's listing replaces it once there is one.
 */
const TESTFLIGHT_ADDRESS = "itms-beta://";

/** What the screen says beside its act. */
const UPDATE_WORDS = {
  DESCRIPTION: "Install the latest build from TestFlight.",
  UPDATE: "Update",
} as const;

/** Opens TestFlight, saying on the console where it could not, as a device without it answers. */
function openTestFlight(): void {
  openURL(TESTFLIGHT_ADDRESS).catch((cause: unknown) =>
    console.error("TestFlight did not open.", cause),
  );
}

/**
 * The whole screen, over no tabs: every call the app makes is refused until
 * it is updated, so nothing behind it would work. The root layout's guard
 * stands it while the document's `network.updateNeeded` is set and gives the
 * tabs back at the service's next answer of another status.
 */
export default function UpdateNeededScreen() {
  return (
    <Screen>
      <EmptyState
        title={BUILD_TOO_OLD_WORDS}
        symbol={GLYPH.UPDATE}
        description={UPDATE_WORDS.DESCRIPTION}
        action={{ label: UPDATE_WORDS.UPDATE, onPress: openTestFlight }}
      />
    </Screen>
  );
}
