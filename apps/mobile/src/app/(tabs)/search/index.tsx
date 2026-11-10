// index.tsx -- the search tab: the system search field in the header, over a placeholder.

import { EmptyState, Screen } from "@repo/ui-native";
import { Stack } from "expo-router";
import { SettingsBarButton } from "../../../settings-button.js";

export { ScreenBoundary as ErrorBoundary } from "../../../screen-boundary.js";

export default function SearchScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Search" }}>
        <Stack.SearchBar placeholder="Search" />
      </Stack.Screen>
      <SettingsBarButton />
      <Screen>
        <EmptyState
          title="Search"
          symbol="magnifyingglass"
          description="Find a task, a thread, or an agent."
        />
      </Screen>
    </>
  );
}
