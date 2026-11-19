// chatgpt-sign-in.tsx -- a Codex plan connected through ChatGPT's device-code sign-in, which the service runs, as a sheet: the code, the page it is entered on in the app's Safari sheet, and the wait on Codex.

import { CHATGPT_DEVICE_WORDS } from "@repo/features/agent-credentials-model";
import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import {
  CHATGPT_DEVICE_FAILURE_MESSAGE,
  CHATGPT_DEVICE_LOGIN,
  type ChatGptDeviceStartAnswer,
} from "@repo/features/provider-key-wire";
import { ACT_KIND } from "@repo/host/acts";
import {
  ActionRow,
  BAR_TITLE,
  CodeRow,
  FOOTER_TONE,
  GLYPH,
  glyphSymbol,
  ListSection,
  LOADING_ROW_LOOK,
  LoadingRow,
  PUSH_ROW_GOES,
  PushRow,
  Screen,
  SettingsForm,
  useColors,
} from "@repo/ui-native";
import { setStringAsync } from "expo-clipboard";
import { Stack } from "expo-router";
import { dismissBrowser, openBrowserAsync } from "expo-web-browser";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCloseSheet } from "../close-sheet.js";
import { useHostActs } from "../host/host-provider.js";

/** The sheet's own words beside the shared ones. */
const WORDS = {
  TITLE: "Codex plan",
  CANCEL: "Cancel",
  TRY_AGAIN: "Try again",
  /** What the code's section says: where it is entered, and that the page's row copies it first. */
  STEPS:
    "Sign in with your Codex account, select your workspace if prompted, and enter this code. It's copied when the page opens.",
} as const;

/** Where the sign-in stands: getting a code, waiting on it, or ended in a failure Try again starts over from. */
const STANDING = {
  STARTING: "starting",
  WAITING: "waiting",
  FAILED: "failed",
} as const;

type Standing =
  | { readonly kind: typeof STANDING.STARTING }
  | { readonly kind: typeof STANDING.WAITING; readonly login: ChatGptDeviceStartAnswer }
  | { readonly kind: typeof STANDING.FAILED; readonly words: string };

const STARTING: Standing = { kind: STANDING.STARTING };

/** The sign-in as the sheet draws it: where it stands, and Try again. */
interface DeviceLogin {
  readonly standing: Standing;
  readonly retry: () => void;
}

const UNANSWERED = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

/**
 * The sign-in while the sheet stands, as the panel's device login runs it: a
 * code asked for as it opens and on Try again, the login waited on, and
 * withdrawn as the sheet goes with it still waiting. A plan connected is
 * added after the account's others. `onConnected` hears it connected.
 */
function useDeviceLogin(onConnected: () => void): DeviceLogin {
  const acts = useHostActs();
  const [standing, setStanding] = useState<Standing>(STARTING);
  // Note that a ref counts the starts, because a start's answer reads it as it lands, which no render stands between.
  const starts = useRef(0);
  const connected = useRef(onConnected);
  useEffect(() => {
    connected.current = onConnected;
  }, [onConnected]);

  const start = useCallback(() => {
    starts.current += 1;
    const mine = starts.current;
    setStanding(STARTING);
    void acts[ACT_KIND.CHATGPT_DEVICE_START]({ add: true })
      .catch(() => UNANSWERED)
      .then((answer) => {
        if (mine !== starts.current) {
          if (!("failure" in answer)) {
            void acts[ACT_KIND.CHATGPT_DEVICE_CANCEL]({ loginId: answer.loginId }).catch(() => {});
          }

          return;
        }

        setStanding(
          "failure" in answer
            ? { kind: STANDING.FAILED, words: CHATGPT_DEVICE_WORDS.START_FAILED }
            : { kind: STANDING.WAITING, login: answer },
        );
      });
  }, [acts]);

  useEffect(() => {
    start();

    return () => {
      // Note that going away counts as a start, so a code still on its way lands nowhere and is withdrawn.
      starts.current += 1;
    };
  }, [start]);

  const login = standing.kind === STANDING.WAITING ? standing.login : undefined;
  useEffect(() => {
    if (login === undefined) return;
    const { loginId, intervalSeconds } = login;
    let waiting = true;
    void acts[ACT_KIND.CHATGPT_DEVICE_WAIT]({ loginId, intervalSeconds })
      .catch(() => UNANSWERED)
      .then((answer) => {
        if (!waiting) return;
        waiting = false;

        if ("failure" in answer) {
          setStanding({ kind: STANDING.FAILED, words: CHATGPT_DEVICE_WORDS.WAIT_FAILED });

          return;
        }

        const { outcome } = answer;

        if (outcome === CHATGPT_DEVICE_LOGIN.CONNECTED) {
          connected.current();

          return;
        }

        // Note that the host answers only once the login settles, so a pending answer is none it gives.
        if (outcome === CHATGPT_DEVICE_LOGIN.PENDING) return;
        setStanding({
          kind: STANDING.FAILED,
          words: answer.message ?? CHATGPT_DEVICE_FAILURE_MESSAGE[outcome],
        });
      });

    return () => {
      if (!waiting) return;
      waiting = false;
      void acts[ACT_KIND.CHATGPT_DEVICE_CANCEL]({ loginId }).catch(() => {});
    };
  }, [login, acts]);

  return { standing, retry: start };
}

/**
 * The sheet: while a code is asked for, a line saying so; then the step that
 * turns device codes on in ChatGPT, the code, and the verification page,
 * which copies the code and opens in the app's Safari sheet; once Codex
 * answers, the Safari sheet and this one close, the plan standing in the
 * list beneath. A sign-in that ended says why, with Try again.
 */
export function ChatGptSignIn() {
  const colors = useColors();
  const close = useCloseSheet();

  const done = useCallback(() => {
    dismissBrowser();
    close();
  }, [close]);

  const { standing, retry } = useDeviceLogin(done);

  const openPage = (login: ChatGptDeviceStartAnswer) =>
    void setStringAsync(login.userCode)
      .then(() => openBrowserAsync(login.verificationUrl, { controlsColor: colors.ACCENT }))
      .catch((cause: unknown) => console.error("The verification page did not open.", cause));

  const body =
    standing.kind === STANDING.STARTING ? (
      <ListSection>
        <LoadingRow words={CHATGPT_DEVICE_WORDS.GETTING_CODE} look={LOADING_ROW_LOOK.SAID} />
      </ListSection>
    ) : standing.kind === STANDING.FAILED ? (
      <ListSection footer={standing.words} footerTone={FOOTER_TONE.FAILURE}>
        <ActionRow label={WORDS.TRY_AGAIN} onPress={retry} />
      </ListSection>
    ) : (
      <>
        <ListSection title={CHATGPT_DEVICE_WORDS.CODE} footer={WORDS.STEPS}>
          <CodeRow code={standing.login.userCode} />
          <PushRow
            label={CHATGPT_DEVICE_WORDS.VERIFICATION_PAGE}
            goes={PUSH_ROW_GOES.OUT}
            onPress={() => openPage(standing.login)}
          />
        </ListSection>
        <ListSection
          footer={`${CHATGPT_DEVICE_WORDS.TURN_ON}. ${CHATGPT_DEVICE_WORDS.TURN_ON_HINT}.`}
        >
          <LoadingRow words={CHATGPT_DEVICE_WORDS.WAITING} look={LOADING_ROW_LOOK.SAID} />
        </ListSection>
      </>
    );

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: WORDS.TITLE,
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
        />
      </Stack.Toolbar>
      <Screen>
        <SettingsForm>{body}</SettingsForm>
      </Screen>
    </>
  );
}
