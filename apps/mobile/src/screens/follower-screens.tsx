// follower-screens.tsx -- Add a follower as a sheet over a task: the members of its workspace, one who already follows dimmed, a press adding the one picked and closing the sheet, as the panel's offer adds a person mentioned.

import { FOLLOWING_WORDS } from "@repo/features/task-followers-model";
import { readFailedWords, readingWords } from "@repo/features/words";
import {
  BAR_TITLE,
  EmptyState,
  GLYPH,
  ListSection,
  PersonPickRows,
  Screen,
  SettingsForm,
  useColors,
} from "@repo/ui-native";
import { Stack, useRouter } from "expo-router";
import { useCallback, useRef } from "react";
import { useFollowerOffer } from "../tasks/use-follower-offer.js";
import { useTaskOverview } from "../tasks/use-tasks.js";

/** The sheet's own words. */
const WORDS = {
  CANCEL: "Cancel",
  TASK_NOT_FOUND: "Task not found",
  MEMBERS: "Members",
  READING: readingWords("the members"),
  READ_FAILED: readFailedWords("the members"),
  NO_ONE: "No one else is in this workspace",
} as const;

/** The sheet's route, which a task's Followers sheet opens. */
const ADD_FOLLOWER_ROUTE = "/add-follower";

/** Opens Add a follower over a task, as its Followers sheet offers it. */
export function useAddFollowerDoor(): (taskId: string) => void {
  const router = useRouter();

  return useCallback(
    (taskId) => router.push({ pathname: ADD_FOLLOWER_ROUTE, params: { task: taskId } }),
    [router],
  );
}

/**
 * Add a follower over the task `taskId` names: the members of its workspace
 * but the reader, whose Follow stands on the task's page, each with their
 * face and address, one who already follows dimmed and saying so. A press
 * adds the member, their machines off, as the panel's offer adds a person
 * mentioned, and closes the sheet at once; where the service refuses, the
 * app's failure notice says why, with Try again.
 */
export function AddFollowerScreen({ taskId }: { readonly taskId: string }) {
  const router = useRouter();
  const colors = useColors();
  const task = useTaskOverview(taskId)?.task;
  const offer = useFollowerOffer(task);
  // Note that a second tap can land before the sheet has gone, so a press is read off a ref.
  const sent = useRef(false);

  // Note that the add is a declared write, drawn on the task at once, so the sheet closes as it goes, and a refusal is said by the app's failure notice with its Try again.
  const add = (userId: string) => {
    if (sent.current) return;
    sent.current = true;
    void offer.add(userId);
    router.back();
  };

  const bar = (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: FOLLOWING_WORDS.ADD_FOLLOWER,
          headerTintColor: colors.TEXT,
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.GROUPED },
        }}
      />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>{WORDS.CANCEL}</Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );

  const { people, failed } = offer;

  const body =
    task === undefined ? (
      <EmptyState title={WORDS.TASK_NOT_FOUND} symbol={GLYPH.NOT_FOUND} />
    ) : failed ? (
      <EmptyState title={WORDS.READ_FAILED} symbol={GLYPH.PEOPLE} />
    ) : people === undefined ? (
      <EmptyState title={WORDS.READING} symbol={GLYPH.PEOPLE} loading />
    ) : people.length === 0 ? (
      <EmptyState title={WORDS.NO_ONE} symbol={GLYPH.PEOPLE} />
    ) : (
      <SettingsForm>
        <ListSection title={WORDS.MEMBERS}>
          <PersonPickRows options={people} onPick={add} />
        </ListSection>
      </SettingsForm>
    );

  return (
    <>
      {bar}
      <Screen>{body}</Screen>
    </>
  );
}
