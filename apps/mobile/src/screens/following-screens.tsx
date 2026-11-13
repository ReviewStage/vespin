// following-screens.tsx -- the Following sheet over a task: who follows it, the reader first, each with a laptop where its agents may use their machines, then the reader's machines switch and Unfollow, or Follow alone where they don't follow, as the panel's Following popover holds them, and Add a follower.

import {
  FOLLOWING_FACES,
  FOLLOWING_WORDS,
  followerMachinesSentence,
} from "@repo/features/task-followers-model";
import {
  ActionRow,
  BAR_TITLE,
  EmptyState,
  FollowerRow,
  ListSection,
  type PageFollowing,
  Screen,
  SettingsForm,
  ToggleRow,
  useColors,
} from "@repo/ui-native";
import { Stack, useRouter } from "expo-router";
import { type FollowerFace, type TaskFollowing, useTaskFollowing } from "../tasks/use-following.js";
import { useAddFollowerDoor } from "./follower-screens.js";

/** The sheet's own words beside the panel's (`FOLLOWING_WORDS`). */
const SHEET_WORDS = {
  OPENS: "Opens who follows the task",
  DONE: "Done",
  NOT_FOUND: "Task not found",
} as const;

/** The route the Following sheet stands at. */
const FOLLOWING_ROUTE = "/task-following";

/** Whose machines a follower's sentence names: yours, or theirs by name. */
function whoseMachines(face: FollowerFace): string {
  return face.you ? "your" : `${face.name}’s`;
}

/** Opens the Following sheet over a task. */
export function useOpenFollowing(): (taskId: string) => void {
  const router = useRouter();

  return (taskId) => router.push({ pathname: FOLLOWING_ROUTE, params: { task: taskId } });
}

/**
 * The task page's Following chip: the followers' faces, four then a count of
 * the rest, and Following where the reader follows or Follow where they
 * don't, opening the Following sheet; none while the task's workspace has
 * Following off.
 */
export function useFollowingChip(taskId: string): PageFollowing | undefined {
  const following = useTaskFollowing(taskId);
  const open = useOpenFollowing();

  if (following === undefined) return undefined;
  const { followers } = following;

  return {
    label: following.chipWords,
    faces: followers.slice(0, FOLLOWING_FACES).map(({ name, picture }) => ({ name, picture })),
    more: Math.max(0, followers.length - FOLLOWING_FACES),
    hint: SHEET_WORDS.OPENS,
    heard: followers.map((face) => (face.you ? FOLLOWING_WORDS.YOU : face.name)).join(", "),
    onPress: () => open(taskId),
  };
}

/** The sheet's foot: the reader's machines switch and Unfollow, dimmed for the assignee; or Follow alone where they don't follow. */
function OwnRows({ following }: { readonly following: TaskFollowing }) {
  const { reader } = following;

  if (reader === undefined) {
    return (
      <ListSection>
        <ActionRow label={FOLLOWING_WORDS.FOLLOW} symbol="eye" onPress={following.follow} />
      </ListSection>
    );
  }

  return (
    <ListSection>
      <ToggleRow
        label={FOLLOWING_WORDS.MACHINES}
        on={reader.machines}
        onChange={following.setMachines}
      />
      <ActionRow
        label={FOLLOWING_WORDS.UNFOLLOW}
        symbol="eye.slash"
        disabled={reader.assignee}
        detail={reader.assignee ? FOLLOWING_WORDS.ASSIGNEE_STAYS : undefined}
        onPress={following.unfollow}
      />
    </ListSection>
  );
}

/**
 * The Following sheet over a task, as the panel's popover holds it: one
 * list of who follows, the reader first as You, a muted Assignee on the
 * assignee, and a laptop at a row's end where the task's agents may use that
 * person's machines, which VoiceOver hears in the panel's card's sentence; a
 * row takes no press. Under it the reader's own Let agents here use my
 * machines switch and Unfollow, dimmed with why for the assignee; where the
 * reader doesn't follow, Follow alone. Follow and Unfollow lead with the
 * eye and the struck eye, as the panel's do. Last, Add a follower opens a
 * sheet of the workspace's members, as the phone's way to the panel's offer
 * to add a person mentioned.
 */
export function TaskFollowingScreen({ taskId }: { readonly taskId: string }) {
  const colors = useColors();
  const router = useRouter();
  const following = useTaskFollowing(taskId);
  const addFollower = useAddFollowerDoor();

  const bar = (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: FOLLOWING_WORDS.CHIP,
          headerTintColor: colors.TEXT,
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.GROUPED },
        }}
      />
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button onPress={() => router.back()}>
          {SHEET_WORDS.DONE}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );

  if (following === undefined) {
    return (
      <>
        {bar}
        <Screen>
          <EmptyState title={SHEET_WORDS.NOT_FOUND} symbol="questionmark.folder" />
        </Screen>
      </>
    );
  }

  return (
    <>
      {bar}
      <Screen>
        <SettingsForm>
          {following.followers.length === 0 ? null : (
            <ListSection>
              {following.followers.map((face) => (
                <FollowerRow
                  key={face.userId}
                  name={face.you ? FOLLOWING_WORDS.YOU : face.name}
                  picture={face.picture}
                  role={face.assignee ? FOLLOWING_WORDS.ASSIGNEE : undefined}
                  machines={face.machines}
                  heard={followerMachinesSentence(face, whoseMachines(face))}
                />
              ))}
            </ListSection>
          )}
          <OwnRows following={following} />
          <ListSection>
            <ActionRow
              label={FOLLOWING_WORDS.ADD_FOLLOWER}
              symbol="person.badge.plus"
              onPress={() => addFollower(taskId)}
            />
          </ListSection>
        </SettingsForm>
      </Screen>
    </>
  );
}
