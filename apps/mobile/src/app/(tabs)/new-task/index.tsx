// index.tsx -- the New task tab's own screen, which the round + never selects, since it opens New task as a sheet; a link that names the tab lands here and opens the sheet from it.

import { EmptyState, GLYPH, Screen } from "@repo/ui-native";
import { Stack, useRouter } from "expo-router";
import { SettingsBarButton } from "../../../settings-button.js";
import { useWorkspaceSwitcher } from "../../../workspace-switcher.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

export default function NewTaskScreen() {
  const router = useRouter();
  const switcher = useWorkspaceSwitcher();

  return (
    <>
      <Stack.Screen options={{ title: "New task" }} />
      <SettingsBarButton switcher={switcher} />
      <Screen>
        <EmptyState
          title="New task"
          symbol={GLYPH.NEW_TASK}
          description="Describe the task, and an agent starts on it."
          action={{ label: "New task", onPress: () => router.push("/start-task") }}
        />
      </Screen>
    </>
  );
}
