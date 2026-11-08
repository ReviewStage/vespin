// index.tsx -- the New task tab: a placeholder for the composer.

import { ContentUnavailableView, Host } from "@expo/ui/swift-ui";
import { Stack } from "expo-router";

export default function NewTaskScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "New task" }} />
      <Host style={{ flex: 1 }}>
        <ContentUnavailableView
          title="New task"
          systemImage="square.and.pencil"
          description="Describe the task, and an agent starts on it."
        />
      </Host>
    </>
  );
}
