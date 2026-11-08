// index.tsx -- the search tab: the system search field in the header, over a placeholder.

import { ContentUnavailableView, Host } from "@expo/ui/swift-ui";
import { Stack } from "expo-router";

export default function SearchScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "Search" }}>
        <Stack.SearchBar placeholder="Search" />
      </Stack.Screen>
      <Host style={{ flex: 1 }}>
        <ContentUnavailableView
          title="Search"
          systemImage="magnifyingglass"
          description="Find a task, a thread, or an agent."
        />
      </Host>
    </>
  );
}
