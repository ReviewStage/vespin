// manager-sheets.tsx -- New Manager and a Manager's Settings, each a sheet of the desktop's one Manager card: its name, its face, its repositories, where it runs, and its model.

import { iosAgentRoute } from "@repo/features/ios-app-links";
import type { ManagerFace } from "@repo/features/manager-face";
import { agentName } from "@repo/features/model-label";
import { IN_THE_CLOUD, placeIdOf, placeOfId } from "@repo/features/runs-on-places";
import { agentRunsOnWords } from "@repo/features/task-agents-model";
import { ACT_UNREACHED_WORDS, readingWords } from "@repo/features/words";
import {
  BAR_TITLE,
  FOOTER_TONE,
  GLYPH,
  glyphSymbol,
  ListSection,
  LoadingRow,
  ManagerFaceRow,
  ManagerFaceSheet,
  MenuPickRow,
  PickRows,
  Screen,
  SettingsForm,
  useAsyncAction,
  useColors,
  ValueRow,
  WORDS_LOOK,
  WordsField,
} from "@repo/ui-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { useFollowedAgent } from "../agents/use-agent.js";
import { useAgentActions } from "../agents/use-agent-actions.js";
import { useAgentModelPick } from "../agents/use-agent-model.js";
import { useCreateManager } from "../agents/use-managers.js";
import { useCloseSheet, useCloseSheetThen } from "../close-sheet.js";
import { useOnTab } from "../tab-route.js";
import {
  runsOnOptions,
  useModelPick,
  useRepositoryPick,
  useRunsOnPlaces,
} from "../tasks/use-start.js";
import { useTasksWorkspace } from "../tasks/use-tasks.js";

/** The sheets' words, as the desktop's Manager card says them (`new-manager-dialog.tsx`). */
const WORDS = {
  NEW_MANAGER: "New Manager",
  SETTINGS: "Manager settings",
  NAME: "Name",
  NAME_PLACEHOLDER: "Release captain",
  FACE: "Face",
  FACE_UNPICKED: "Picked for you",
  FACE_PICKED_FOR_YOU: "One no other Manager here wears is picked for you, unless you choose one.",
  REPOSITORIES: "Repositories",
  REPOSITORIES_HINT: "The first picked is its checkout.",
  MACHINE: "Machine",
  MODEL: "Model",
  EFFORT: "Effort",
  CREATE: "Create",
  CREATING: "Creating",
  DONE: "Done",
  CANCEL: "Cancel",
  FIXED_AFTER_CREATE: "Fixed once the Manager is made.",
  NO_REPOSITORIES: "This workspace reaches no repositories yet.",
} as const;

/** What a flow finds the name field by. */
const NAME_FIELD_ID = "manager-name";

/** The sheet's bar: its title, Cancel at its leading edge, and its act at its trailing one. */
function SheetBar({
  title,
  act,
  onCancel,
}: {
  readonly title: string;
  readonly act: {
    readonly words: string;
    readonly disabled: boolean;
    readonly onPress: () => void;
  };
  readonly onCancel: () => void;
}) {
  const colors = useColors();

  return (
    <>
      {/* Note that the bar has no ground of its own, so the system draws its buttons in glass over the sheet's. */}
      <Stack.Screen
        options={{
          headerShown: true,
          title,
          headerTintColor: colors.TEXT,
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: colors.GROUPED },
        }}
      />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon={glyphSymbol(GLYPH.CLOSE)}
          accessibilityLabel={WORDS.CANCEL}
          onPress={onCancel}
        >
          {WORDS.CANCEL}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          variant="prominent"
          tintColor={colors.ACCENT}
          disabled={act.disabled}
          onPress={act.onPress}
        >
          {act.words}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
    </>
  );
}

/** What a flow finds the Face row by. */
const FACE_ROW_ID = "manager-face";

/** The sheet's Face row, the panel's face well: the face standing, or that one is picked for you while none is, its press opening the face picker. */
function FaceRow({
  face,
  onPress,
}: {
  readonly face: ManagerFace | undefined;
  readonly onPress: () => void;
}) {
  return (
    <ManagerFaceRow
      label={WORDS.FACE}
      face={face}
      unpicked={WORDS.FACE_UNPICKED}
      onPress={onPress}
      testId={FACE_ROW_ID}
    />
  );
}

/**
 * New Manager, as a sheet over the tabs, as the desktop's card makes one:
 * its name, kept as typed; the repositories it works in, one or more, the
 * first picked its checkout, starting on New task's own repository until a
 * pick; where it runs, the cloud until a device is picked; its model and
 * effort, on the account's default until a pick; and its face, none until a
 * pick, so the service picks one no other Manager of the workspace wears,
 * as the desktop's card leaves it. Create, lit once a name and a repository stand,
 * makes it in the workspace the phone works in (`useCreateManager`) and,
 * once made, closes the sheet and opens the Manager's chat; a refusal says
 * why under the name and keeps the sheet, with what was picked kept for
 * another try.
 */
export function NewManagerScreen() {
  const router = useRouter();
  const onTab = useOnTab();
  const leave = useCloseSheet();
  const leaveThen = useCloseSheetThen();
  const workspace = useTasksWorkspace();
  const repositories = useRepositoryPick(workspace);
  const model = useModelPick();
  // Note that the machines the workspace owns are offered after the member's devices, as Start's Runs on offers them.
  const places = useRunsOnPlaces(model, workspace?.id);
  const create = useCreateManager(workspace?.id);
  const making = useAsyncAction(() => ACT_UNREACHED_WORDS);
  const [name, setName] = useState("");
  const [picks, setPicks] = useState<readonly string[] | undefined>(undefined);
  const [runsOn, setRunsOn] = useState(IN_THE_CLOUD);
  const [face, setFace] = useState<ManagerFace | undefined>(undefined);
  const [facePicking, setFacePicking] = useState(false);

  const chosen = picks ?? (repositories.picked === undefined ? [] : [repositories.picked]);

  const [first, ...rest] = chosen;
  const choice = model.shown;
  const trimmed = name.trim();
  const ready = trimmed !== "" && first !== undefined && choice !== undefined;

  // A change lets the last refusal go, since it spoke of what was picked before.
  const changed = () => making.clear();

  const toggle = (repository: string) => {
    setPicks(
      chosen.includes(repository)
        ? chosen.filter((each) => each !== repository)
        : [...chosen, repository],
    );
    changed();
  };

  const make = () => {
    if (first === undefined || choice === undefined || trimmed === "") return;

    void making.run(() =>
      create({ name: trimmed, repositories: [first, ...rest], runsOn, choice, face }).then(
        (made) => {
          if ("refused" in made) return made.refused;

          // Note that the Manager's chat opens once the sheet has gone, on its own tab, as a task New task made opens.
          leaveThen(() => router.push(onTab(iosAgentRoute(made.agentId))));

          return undefined;
        },
      ),
    );
  };

  return (
    <>
      <SheetBar
        title={WORDS.NEW_MANAGER}
        act={{
          words: making.running ? WORDS.CREATING : WORDS.CREATE,
          disabled: !ready || making.running,
          onPress: make,
        }}
        onCancel={leave}
      />
      <Screen>
        <SettingsForm>
          <ListSection title={WORDS.NAME} footer={making.refusal} footerTone={FOOTER_TONE.FAILURE}>
            <WordsField
              look={WORDS_LOOK.LINE}
              placeholder={WORDS.NAME_PLACEHOLDER}
              onWords={(words) => {
                setName(words);
                changed();
              }}
              autoFocus
              testId={NAME_FIELD_ID}
            />
          </ListSection>
          <ListSection footer={face === undefined ? WORDS.FACE_PICKED_FOR_YOU : undefined}>
            <FaceRow face={face} onPress={() => setFacePicking(true)} />
          </ListSection>
          <ListSection
            title={WORDS.REPOSITORIES}
            footer={
              repositories.failed ??
              (repositories.read && repositories.options.length === 0
                ? WORDS.NO_REPOSITORIES
                : WORDS.REPOSITORIES_HINT)
            }
            footerTone={repositories.failed === undefined ? undefined : FOOTER_TONE.FAILURE}
          >
            {repositories.read || repositories.options.length > 0 ? (
              <PickRows options={repositories.options} picked={chosen} onPick={toggle} />
            ) : (
              <LoadingRow words={readingWords("the repositories")} />
            )}
          </ListSection>
          <ListSection title={WORDS.MACHINE}>
            <MenuPickRow
              label={WORDS.MACHINE}
              options={runsOnOptions(places)}
              picked={placeIdOf(runsOn)}
              onPick={(picked) => {
                const place = placeOfId(places, picked);

                if (place === undefined) return;
                setRunsOn(place.runsOn);
                changed();
              }}
            />
          </ListSection>
          <ListSection title={WORDS.MODEL} footer={model.failed} footerTone={FOOTER_TONE.FAILURE}>
            {choice === undefined ? (
              <LoadingRow words={readingWords("your default model")} />
            ) : (
              <>
                <MenuPickRow
                  label={WORDS.MODEL}
                  options={model.models}
                  picked={model.model}
                  onPick={(picked) => {
                    model.pickModel(picked);
                    changed();
                  }}
                />
                <MenuPickRow
                  label={WORDS.EFFORT}
                  options={model.efforts}
                  picked={choice.effort}
                  onPick={(picked) => {
                    model.pickEffort(picked);
                    changed();
                  }}
                />
              </>
            )}
          </ListSection>
        </SettingsForm>
      </Screen>
      <ManagerFaceSheet
        face={face}
        presented={facePicking}
        onDismiss={() => setFacePicking(false)}
        onPick={(picked) => {
          setFace(picked);
          changed();
        }}
      />
    </>
  );
}

/**
 * A Manager's Settings, named by the route's `agent`, as a sheet over its
 * chat, as the desktop's Settings… opens the same card in its edit look:
 * its name, saved on Done where it changed (the agent's Rename); its model
 * and effort, each changed at once as picked, as the agent's model sheet
 * changes them, a refusal saying why under them; and its checkout and where
 * it runs, standing as it was made and saying so, since neither changes
 * after. Its face, picked from the same faces the desktop's card offers,
 * changes at once as picked (`AGENTS_FACE`), as its model does, the ring
 * moving once the change lands and a refusal saying why under it.
 */
export function ManagerSettingsScreen() {
  const { agent: agentId = "" } = useLocalSearchParams<{ agent: string }>();
  const leave = useCloseSheet();
  const agent = useFollowedAgent(agentId);
  const actions = useAgentActions(agentId, undefined);
  const model = useAgentModelPick(agentId);
  const [name, setName] = useState<string | undefined>(undefined);
  const [facePicking, setFacePicking] = useState(false);
  const named = agent === undefined ? "" : agentName(agent);
  const typed = (name ?? named).trim();

  const done = () => {
    // Note that the name is sent only where it changed and still holds words, as the desktop's Save sends only what changed.
    if (typed !== "" && typed !== named) actions.rename(typed);
    leave();
  };

  return (
    <>
      <SheetBar
        title={WORDS.SETTINGS}
        act={{ words: WORDS.DONE, disabled: agent === undefined, onPress: done }}
        onCancel={leave}
      />
      <Screen>
        <SettingsForm>
          {agent === undefined ? (
            <ListSection>
              <LoadingRow words={readingWords("the Manager")} />
            </ListSection>
          ) : (
            <>
              <ListSection title={WORDS.NAME}>
                <WordsField
                  look={WORDS_LOOK.LINE}
                  placeholder={WORDS.NAME_PLACEHOLDER}
                  initialWords={named}
                  onWords={setName}
                  testId={NAME_FIELD_ID}
                />
              </ListSection>
              <ListSection footer={actions.note} footerTone={FOOTER_TONE.FAILURE}>
                <FaceRow face={agent.face} onPress={() => setFacePicking(true)} />
              </ListSection>
              <ListSection title={WORDS.MODEL} footer={model.note} footerTone={FOOTER_TONE.FAILURE}>
                <MenuPickRow
                  label={WORDS.MODEL}
                  options={model.models}
                  picked={model.model}
                  onPick={model.pickModel}
                />
                <MenuPickRow
                  label={WORDS.EFFORT}
                  options={model.efforts}
                  picked={model.effort}
                  onPick={model.pickEffort}
                />
              </ListSection>
              <ListSection footer={WORDS.FIXED_AFTER_CREATE}>
                <ValueRow label={WORDS.REPOSITORIES} value={agent.repository ?? "—"} />
                <ValueRow label={WORDS.MACHINE} value={agentRunsOnWords(agent)} />
              </ListSection>
            </>
          )}
        </SettingsForm>
      </Screen>
      <ManagerFaceSheet
        face={agent?.face}
        presented={facePicking}
        onDismiss={() => setFacePicking(false)}
        onPick={actions.changeFace}
      />
    </>
  );
}
