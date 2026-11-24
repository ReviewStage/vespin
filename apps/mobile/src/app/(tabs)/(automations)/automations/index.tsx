// index.tsx -- the Automations tab: the workspace's automations under the tab's large title, its bar led by the workspace switcher and ended by New task's compose, as every tab's root is.

import { AUTOMATION_PHONE_WORDS } from "@repo/features/automation-words";
import { glyphSymbol } from "@repo/ui-native";
import { Stack } from "expo-router";
import { useComposeAction } from "../../../../screens/app-sidebar.js";
import { AutomationsScreen } from "../../../../screens/automation-screens.js";
import { SettingsBarButton } from "../../../../settings-button.js";
import { useWorkspaceSwitcher } from "../../../../workspace-switcher.js";

export { ScreenBoundary as ErrorBoundary } from "../../../../screen-boundary.js";

export default function AutomationsTabScreen() {
  const switcher = useWorkspaceSwitcher();
  const compose = useComposeAction();

  return (
    <>
      <Stack.Screen options={{ title: AUTOMATION_PHONE_WORDS.TITLE }} />
      <SettingsBarButton switcher={switcher} />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={compose.symbol === undefined ? undefined : glyphSymbol(compose.symbol)}
          accessibilityLabel={compose.label}
          onPress={compose.onPress}
        />
      </Stack.Toolbar>
      <AutomationsScreen />
    </>
  );
}
