// index.tsx -- the New task tab: a placeholder for the composer, its bar of glass at the foot.

import { BUTTON_LOOK, Button, Chip, EmptyState, GlassBar, Screen, Spacer } from "@repo/ui-native";
import { Stack } from "expo-router";
import { useState } from "react";

/** The models the placeholder's chips pick among, until the host's catalog names them. */
const PLACEHOLDER_MODELS = ["Opus 5.5", "Fable 5.1"] as const;

export default function NewTaskScreen() {
  const [model, setModel] = useState<string>(PLACEHOLDER_MODELS[0]);
  return (
    <>
      <Stack.Screen options={{ title: "New task" }} />
      <Screen>
        <EmptyState
          title="New task"
          symbol="square.and.pencil"
          description="Describe the task, and an agent starts on it."
        />
      </Screen>
      <GlassBar>
        {PLACEHOLDER_MODELS.map((name) => (
          <Chip key={name} label={name} selected={name === model} onPress={() => setModel(name)} />
        ))}
        <Spacer />
        <Button
          label="Start"
          symbol="arrow.up"
          look={BUTTON_LOOK.GLASS_PROMINENT}
          disabled
          onPress={() => undefined}
        />
      </GlassBar>
    </>
  );
}
