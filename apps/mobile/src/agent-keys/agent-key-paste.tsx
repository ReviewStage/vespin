// agent-key-paste.tsx -- a Claude token or an API key pasted, as a sheet: how to get the secret, the secure field it is pasted into, and Save, the panel's paste steps in iOS's own form.

import {
  CREDENTIAL_WORDS,
  type CredentialProvider,
  HARNESS_INFO,
  keyRejectionWords,
  tokenRejectionWords,
} from "@repo/features/agent-credentials-model";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  pastedKeyFits,
} from "@repo/features/provider-key-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  BAR_TITLE,
  CodeRow,
  FOOTER_TONE,
  GLYPH,
  glyphSymbol,
  ListSection,
  PUSH_ROW_GOES,
  PushRow,
  Screen,
  SettingsForm,
  useAsyncAction,
  useColors,
  WORDS_LOOK,
  WordsField,
} from "@repo/ui-native";
import { Stack } from "expo-router";
import { openBrowserAsync } from "expo-web-browser";
import { useState } from "react";
import { useCloseSheet } from "../close-sheet.js";
import { useHostActs } from "../host/host-provider.js";
import { useWrite } from "../use-write.js";
import { PASTE_KIND, type PasteKind } from "./agent-keys.js";

/** The sheet's own words beside the shared ones. */
const WORDS = {
  TOKEN_TITLE: "Claude plan",
  KEY_TITLE: (provider: CredentialProvider) => `${HARNESS_INFO[provider].keyName} API key`,
  /** Why a Claude plan's token comes from a computer, as the panel's setup says it. */
  TOKEN_FOOTER:
    "Run it on any computer with Claude Code installed. It signs in with your Claude plan and prints a token.",
  KEY_FOOTER: (provider: CredentialProvider) =>
    `Make one on ${HARNESS_INFO[provider].keySite}, then copy it.`,
  SAVE: "Save",
  CANCEL: "Cancel",
} as const;

/** What a flow finds the field by. */
const SECRET_FIELD_ID = "agent-key-field";

type Said = { words?: string };

/**
 * The sheet: for a Claude plan, the command that prints its token, copied
 * by a long press as a code is; for an API key, the provider's page that
 * makes one, opened in the app's Safari sheet; then the secure field, and
 * Save in the bar. A paste no key could be is refused as the provider's
 * own invalid one, unsent; the service's refusal stands under the field in
 * its words, the paste kept; a key kept closes the sheet, its row then
 * standing in the list beneath. The secret is sent once and held nowhere
 * but the field.
 */
export function AgentKeyPaste({
  provider,
  kind,
}: {
  readonly provider: CredentialProvider;
  readonly kind: PasteKind;
}) {
  const colors = useColors();
  const acts = useHostActs();
  const write = useWrite();
  const close = useCloseSheet();
  const [pasted, setPasted] = useState("");
  const token = kind === PASTE_KIND.TOKEN && provider === PROVIDER_KEY_PROVIDER.ANTHROPIC;
  const failedWords = token ? CREDENTIAL_WORDS.SAVE_TOKEN_FAILED : CREDENTIAL_WORDS.SAVE_KEY_FAILED;
  const save = useAsyncAction<string>(() => failedWords);

  const refused = token
    ? tokenRejectionWords
    : (rejection: Parameters<typeof tokenRejectionWords>[0]) =>
        keyRejectionWords(provider, rejection);

  const send = () => {
    const key = pasted.trim();

    if (key === "" || save.running) return;

    if (!pastedKeyFits(key)) {
      save.refuse(refused(PROVIDER_KEY_REJECTION.INVALID));

      return;
    }

    void save.run(() => {
      const said: Said = {};

      return write(
        () =>
          acts[ACT_KIND.PROVIDER_KEYS_SAVE](
            token
              ? { provider, kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN, key, add: true }
              : { provider, key },
          ),
        {
          refused: (answer) =>
            "failure" in answer
              ? failedWords
              : answer.rejected === undefined
                ? undefined
                : refused(answer.rejected),
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
          title: token ? WORDS.TOKEN_TITLE : WORDS.KEY_TITLE(provider),
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
          onPress={close}
        >
          {WORDS.CANCEL}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          variant="prominent"
          tintColor={colors.ACCENT}
          disabled={pasted.trim() === "" || save.running}
          onPress={send}
        >
          {WORDS.SAVE}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <Screen>
        <SettingsForm>
          {token ? (
            <ListSection title={CREDENTIAL_WORDS.RUN_SETUP_TOKEN} footer={WORDS.TOKEN_FOOTER}>
              <CodeRow code={CREDENTIAL_WORDS.SETUP_TOKEN_COMMAND} />
            </ListSection>
          ) : (
            <ListSection footer={WORDS.KEY_FOOTER(provider)}>
              <PushRow
                label={CREDENTIAL_WORDS.CREATE_KEY}
                goes={PUSH_ROW_GOES.OUT}
                onPress={() =>
                  void openBrowserAsync(HARNESS_INFO[provider].keyUrl, {
                    controlsColor: colors.ACCENT,
                  }).catch((cause: unknown) =>
                    console.error("The provider's key page did not open.", cause),
                  )
                }
              />
            </ListSection>
          )}
          <ListSection
            title={token ? CREDENTIAL_WORDS.PASTE_TOKEN : CREDENTIAL_WORDS.PASTE_KEY}
            footer={save.refusal}
            footerTone={FOOTER_TONE.FAILURE}
          >
            <WordsField
              look={WORDS_LOOK.SECRET}
              placeholder={
                token ? CREDENTIAL_WORDS.TOKEN_EXAMPLE : HARNESS_INFO[provider].keyExample
              }
              onWords={(words) => {
                setPasted(words);
                // A refusal speaks of the paste it refused, so an edit lets it go.
                save.clear();
              }}
              autoFocus
              testId={SECRET_FIELD_ID}
            />
          </ListSection>
        </SettingsForm>
      </Screen>
    </>
  );
}
