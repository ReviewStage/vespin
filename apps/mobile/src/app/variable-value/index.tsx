// index.tsx -- a secret variable's value typed into the system's secure field, as a short sheet over Settings › Cloud environment, by the workspace and the name its route names: Cancel, and Save, which adds the variable as a secret.

import { signedInAccountId } from "@repo/credentials/snapshot";
import { SECRET_VARIABLE_WORDS, VARIABLE_WORDS } from "@repo/features/cloud-environment-words";
import { ACT_UNREACHED_WORDS } from "@repo/features/words";
import type { WorkspaceEnvironmentAnswer } from "@repo/features/workspace-environment-wire";
import { ACT_KIND } from "@repo/host/acts";
import { selectAccount } from "@repo/host/app-state-reads";
import {
  BAR_TITLE,
  BUZZ,
  footerToneOf,
  GLYPH,
  glyphSymbol,
  ListSection,
  NO_GROUND,
  Screen,
  SettingsForm,
  useAsyncAction,
  useColors,
  WORDS_LOOK,
  WordsField,
} from "@repo/ui-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { useCloseSheet } from "../../close-sheet.js";
import { variablesKey } from "../../cloud-environment-query.js";
import { appStateQuery } from "../../host/app-state-query.js";
import { useHostActs } from "../../host/host-provider.js";
import { useSheetAtHalf } from "../../sheet-stack.js";
import { useWrite } from "../../use-write.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** The sheet's own words beside the shared ones. */
const WORDS = { CANCEL: "Cancel", SAVE: "Save" } as const;

/** What a refusal said in place, read once the write settles. */
type Said = { words?: string };

/** What a flow finds the field by. */
const VALUE_FIELD_ID = "variable-value-field";

export default function VariableValueRoute() {
  const { workspaceId = "", name = "" } = useLocalSearchParams<{
    workspaceId: string;
    name: string;
  }>();

  // Note that a route naming no variable, as a stale link might, goes back to the app rather than drawing a sheet for nothing.
  if (workspaceId === "" || name === "") return <Redirect href="/" />;

  return <VariableValueSheet workspaceId={workspaceId} name={name} />;
}

/**
 * The sheet: the variable's name as its title, the secure field its value
 * is typed into, what a secret is in the footer, and Save in the bar, dimmed
 * while the field is empty. Save adds the variable as a secret; the answer
 * is drawn over the page's variables beneath and the sheet closes, while a
 * refusal stands in the footer in the host's words, the value kept. The
 * value is sent once and held nowhere but the field.
 */
function VariableValueSheet({
  workspaceId,
  name,
}: {
  readonly workspaceId: string;
  readonly name: string;
}) {
  const colors = useColors();
  const half = useSheetAtHalf();
  const acts = useHostActs();
  const queries = useQueryClient();
  const write = useWrite();
  const close = useCloseSheet();
  const [value, setValue] = useState("");
  const save = useAsyncAction<string>(() => ACT_UNREACHED_WORDS);
  const { data: account } = useQuery({ ...appStateQuery, select: selectAccount });
  const accountId = account === undefined ? undefined : signedInAccountId(account);

  /** The answer drawn over the page's variables, a read still out canceled first so its older list cannot land over it. */
  const drawn = async (answer: WorkspaceEnvironmentAnswer) => {
    if (accountId === undefined) return answer;
    const queryKey = variablesKey(accountId, workspaceId);
    await queries.cancelQueries({ queryKey, exact: true });
    queries.setQueryData(queryKey, answer);

    return answer;
  };

  const send = () => {
    if (value === "" || save.running) return;

    void save.run(() => {
      const said: Said = {};

      return write(
        () =>
          acts[ACT_KIND.WORKSPACE_ENVIRONMENT_SAVE]({
            workspaceId,
            secret: true,
            variables: [{ name, value }],
          }).then(drawn),
        {
          went: BUZZ.SUCCESS,
          inPlace: (words) => {
            said.words = words;
          },
          done: close,
        },
      ).then(() => said.words);
    });
  };

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: name,
          headerTintColor: colors.TEXT,
          headerTitleStyle: { ...BAR_TITLE.SCREEN, color: colors.TEXT },
          headerShadowVisible: false,
          contentStyle: { backgroundColor: half ? NO_GROUND : colors.GROUPED },
        }}
      />
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button
          icon={glyphSymbol(GLYPH.CLOSE)}
          accessibilityLabel={WORDS.CANCEL}
          onPress={close}
        >
          {WORDS.CANCEL}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          variant="prominent"
          tintColor={colors.ACCENT}
          disabled={value === "" || save.running}
          onPress={send}
        >
          {WORDS.SAVE}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Screen clear={half}>
        <SettingsForm clear={half}>
          <ListSection
            title={VARIABLE_WORDS.VALUE}
            footer={save.refusal ?? SECRET_VARIABLE_WORDS.DETAIL}
            footerTone={footerToneOf(save.refusal)}
          >
            <WordsField
              look={WORDS_LOOK.SECRET}
              placeholder={VARIABLE_WORDS.VALUE}
              label={VARIABLE_WORDS.VALUE}
              onWords={(words) => {
                setValue(words);
                // A refusal speaks of the value it refused, so an edit lets it go.
                save.clear();
              }}
              disabled={save.running}
              autoFocus
              testId={VALUE_FIELD_ID}
            />
          </ListSection>
        </SettingsForm>
      </Screen>
    </>
  );
}
