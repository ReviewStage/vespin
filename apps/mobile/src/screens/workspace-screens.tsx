// workspace-screens.tsx -- New workspace, as a sheet over the tabs: the team's name and Create, which makes the workspace and moves the phone to it.

import { WORKSPACE_SWITCHER_WORDS } from "@repo/features/workspace-tile";
import { ACT_KIND } from "@repo/host/acts";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import {
  BAR_TITLE,
  ListSection,
  rejectionWords,
  Screen,
  SettingsForm,
  useAsyncAction,
  useColors,
  WordsField,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { useChosenWorkspace } from "../chosen-workspace.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";

/** The sheet's words, as the panel's team step says them (`setup-team.tsx`). */
const WORDS = {
  WORKSPACE: "Workspace",
  TEAM_NAME: "Team name",
  CREATE: "Create",
  CREATING: "Creating",
  CANCEL: "Cancel",
} as const;

/** What a flow finds the name field by. */
const NAME_FIELD_ID = "new-workspace-name";

/**
 * New workspace: the team's name, then Create in the bar, lit once a name is
 * typed and while no create is out. The workspace is made by the host's own
 * act, as the panel's New workspace makes it, and once it is made the phone
 * works in it, so the Inbox and Tasks stand on the new team, and the sheet
 * closes once the account's list holds it. Note that the sheet waits on the
 * list, because the act answers before the workspaces' follow carries the new
 * one, and the choice falls back to the first workspace until it does; and
 * that Create stays dimmed while it waits, so a second press makes no second
 * workspace. A refusal says why under the name and keeps the sheet. Its
 * teammates are invited from Workspace settings, as the panel's cards
 * invite them after the name.
 */
export function NewWorkspaceScreen() {
  const colors = useColors();
  const router = useRouter();
  const acts = useHostActs();
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { choose } = useChosenWorkspace(workspaces);
  const [name, setName] = useState("");
  const create = useAsyncAction(rejectionWords);
  // The workspace made, until the account's list holds it.
  const [made, setMade] = useState<string | undefined>(undefined);
  const listed = made !== undefined && workspaces.some((workspace) => workspace.id === made);
  useEffect(() => {
    if (listed) router.back();
  }, [listed, router]);
  const waiting = create.running || made !== undefined;
  const make = () => {
    void create.run(() =>
      acts[ACT_KIND.WORKSPACE_CREATE]({ name: name.trim() }).then((workspace) => {
        choose(workspace.id);
        setMade(workspace.id);
        return undefined;
      }),
    );
  };
  return (
    <>
      {/* Note that the bar has no ground of its own, so the system draws its buttons in glass over the sheet's. */}
      <Stack.Screen
        options={{
          headerShown: true,
          title: WORKSPACE_SWITCHER_WORDS.NEW_WORKSPACE,
          headerTintColor: colors.ACCENT,
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.SIDEBAR },
        }}
      />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={() => router.back()}>{WORDS.CANCEL}</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          variant="prominent"
          tintColor={colors.ACCENT}
          disabled={name.trim() === "" || waiting}
          onPress={make}
        >
          {waiting ? WORDS.CREATING : WORDS.CREATE}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Screen>
        <SettingsForm>
          <ListSection title={WORDS.WORKSPACE} footer={create.refusal}>
            <WordsField
              placeholder={WORDS.TEAM_NAME}
              onWords={setName}
              autoFocus
              testId={NAME_FIELD_ID}
            />
          </ListSection>
        </SettingsForm>
      </Screen>
    </>
  );
}
