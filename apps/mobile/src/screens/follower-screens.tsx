// follower-screens.tsx -- Add a follower as a sheet over a task: the members of its workspace, one who already follows dimmed, a press adding the one picked and closing the sheet, as the panel's offer adds a person mentioned.

import { FOLLOWING_WORDS } from "@repo/features/task-followers-model";
import { readFailedWords, readingWords } from "@repo/features/words";
import {
  BAR_TITLE,
  EmptyState,
  GLYPH,
  glyphSymbol,
  ListSection,
  PersonPickRows,
  Screen,
  SettingsForm,
  useColors,
} from "@repo/ui-native";
import { Stack, useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
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
 * mentioned, and closes the sheet; where the service refused, the sheet
 * stays and the app's failure notice says why.
 */
export function AddFollowerScreen({ taskId }: { readonly taskId: string }) {
  const router = useRouter();
  const colors = useColors();
  const task = useTaskOverview(taskId)?.task;
  const offer = useFollowerOffer(task);
  const [adding, setAdding] = useState(false);

  // Note that a press is read off a ref, since a second tap can land before the render that dims the rows, and the sheet's standing too, since an answer may land once it is gone.
  const sending = useRef(false);
  const standing = useRef(true);
  useEffect(() => {
    standing.current = true;

    return () => {
      standing.current = false;
    };
  }, []);

  const add = (userId: string) => {
    if (sending.current) return;
    sending.current = true;
    setAdding(true);

    void offer.add(userId).then((added) => {
      sending.current = false;

      if (!standing.current) return;
      setAdding(false);

      if (added) router.back();
    });
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
          // Note that the sheet stays while an add is out, as Move to workspace's does, so its answer can never close the page under it.
          gestureEnabled: !adding,
        }}
      />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon={glyphSymbol(GLYPH.CLOSE)}
          accessibilityLabel={WORDS.CANCEL}
          disabled={adding}
          onPress={() => router.back()}
        />
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
          <PersonPickRows
            options={people.map((person) => ({
              ...person,
              disabled: person.disabled || adding,
            }))}
            onPick={add}
          />
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
