// workspace-screens.tsx -- New workspace, as a sheet over the tabs: the team's name and Create, which makes the workspace and moves the phone to it.

import { ACT_UNREACHED_WORDS } from "@repo/features/words";
import { WORKSPACE_SWITCHER_WORDS } from "@repo/features/workspace-tile";
import { ACT_KIND } from "@repo/host/acts";
import { selectWorkspaces } from "@repo/host/app-state-reads";
import {
  BAR_TITLE,
  ListSection,
  Screen,
  SettingsForm,
  useAsyncAction,
  useColors,
  WordsField,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { Stack, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useChosenWorkspace } from "../chosen-workspace.js";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useWrite } from "../use-write.js";

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

type Said = { words?: string };

/**
 * New workspace: the team's name, then Create in the bar, lit once a name is
 * typed and while no create is out. The workspace is made by the host's own
 * act, as the panel's New workspace makes it, and the sheet closes on the
 * act's answer with the new workspace chosen, so the Inbox and Tasks move to
 * the new team as the account's list carries it. Note that the sheet doesn't
 * wait for the list too, because that is a second round trip the member
 * would sit through; the kept choice is an id, so it takes hold the moment
 * the list holds it (`chosen-workspace.ts`). Create stays dimmed while the
 * act is out, so a second press makes no second workspace. A refusal says
 * why under the name and keeps the sheet. Its teammates are invited from
 * Workspace settings, as the panel's cards invite them after the name.
 */
export function NewWorkspaceScreen() {
  const colors = useColors();
  const router = useRouter();
  const acts = useHostActs();
  const write = useWrite();
  const { data: workspaces = [] } = useQuery({ ...appStateQuery, select: selectWorkspaces });
  const { choose } = useChosenWorkspace(workspaces);
  const [name, setName] = useState("");
  const create = useAsyncAction(() => ACT_UNREACHED_WORDS);
  // Whether the sheet still stands, so a create answered after Cancel or a swipe down closes nothing else.
  const open = useRef(true);
  // Note that Create stays dimmed while the sheet leaves, since the create is done but the name still stands typed.
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    open.current = true;

    return () => {
      open.current = false;
    };
  }, []);

  const close = () => {
    if (!open.current) return;
    open.current = false;
    setClosing(true);
    router.back();
  };

  const make = () => {
    // Note that a refusal says why in the sheet, under the name, in the host's own words rather than the error's.
    void create.run(() => {
      const said: Said = {};

      return write(
        () =>
          acts[ACT_KIND.WORKSPACE_CREATE]({ name: name.trim() }).then((workspace) => {
            // Note that a create answered after Cancel leaves the workspace the member works in, since they turned away from it; the new one stands in the switcher.
            if (!open.current) return;
            choose(workspace.id);
            close();
          }),
        {
          inPlace: (words) => {
            said.words = words;
          },
        },
      ).then(() => said.words);
    });
  };

  return (
    <>
      {/* Note that the bar has no ground of its own, so the system draws its buttons in glass over the sheet's. */}
      <Stack.Screen
        options={{
          headerShown: true,
          title: WORKSPACE_SWITCHER_WORDS.NEW_WORKSPACE,
          headerTintColor: colors.TEXT,
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.GROUPED },
        }}
      />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button onPress={close}>{WORDS.CANCEL}</Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          variant="prominent"
          tintColor={colors.ACCENT}
          disabled={name.trim() === "" || create.running || closing}
          onPress={make}
        >
          {create.running ? WORDS.CREATING : WORDS.CREATE}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Screen>
        <SettingsForm>
          <ListSection title={WORDS.WORKSPACE} footer={create.refusal}>
            <WordsField
              placeholder={WORDS.TEAM_NAME}
              onWords={(words) => {
                setName(words);
                // A refusal speaks of the name it refused, so an edit lets it go.
                create.clear();
              }}
              autoFocus
              testId={NAME_FIELD_ID}
            />
          </ListSection>
        </SettingsForm>
      </Screen>
    </>
  );
}
