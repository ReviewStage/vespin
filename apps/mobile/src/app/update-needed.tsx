// update-needed.tsx -- the screen that stands in front of every other while the service refuses this build as older than it serves: it says so and which build this is, Update opens TestFlight, and Check again asks the service once more.

import { BUILD_TOO_OLD_WORDS } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import { EmptyState, GLYPH, Screen } from "@repo/ui-native";
import { openURL } from "expo-linking";
import { useState } from "react";
import { buildWords } from "../build-words.js";
import { useHostActs } from "../host/host-provider.js";

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
  CHECK_AGAIN: "Check again",
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
 * tabs back at the service's next answer of another status. Note that
 * nothing re-reads on its own while it stands, so Check again reads the task
 * list once more, whose answer clears the screen where the service now takes
 * this build, such as after the floor came down.
 */
export default function UpdateNeededScreen() {
  const acts = useHostActs();
  const [checking, setChecking] = useState(false);

  const check = () => {
    setChecking(true);
    acts[ACT_KIND.TASKS_REFRESH]()
      .catch((cause: unknown) => console.error("Checking again did not go.", cause))
      .finally(() => setChecking(false));
  };

  return (
    <Screen>
      <EmptyState
        title={BUILD_TOO_OLD_WORDS}
        symbol={GLYPH.UPDATE}
        description={descriptionWords()}
        action={{ label: UPDATE_WORDS.UPDATE, onPress: openTestFlight }}
        secondary={{ label: UPDATE_WORDS.CHECK_AGAIN, onPress: check, disabled: checking }}
      />
    </Screen>
  );
}
