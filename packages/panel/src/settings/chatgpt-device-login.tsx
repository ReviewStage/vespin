import { AGENT_CALL_FAILURE } from "@repo/features/agent-view";
import {
  CHATGPT_DEVICE_FAILURE_MESSAGE,
  CHATGPT_DEVICE_LOGIN,
  type ChatGptDeviceStartAnswer,
} from "@repo/features/provider-key-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { ACT_KIND } from "@repo/host/acts";
import {
  ANNOUNCE,
  BUTTON_VARIANT,
  Button,
  ButtonLink,
  COPY_FIELD_WIDTH,
  CopyField,
  ErrorLine,
  GAP,
  Inline,
  STEP_STATE,
  Stack,
  Step,
  Steps,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  WaitingLine,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { copyThroughShell } from "../copy-feedback.js";
import { refusedShown } from "../failure-report.js";
import { linkPressOf, useOpenLink } from "../tasks/use-open-link.js";

/**
 * chatgpt-device-login.tsx -- a ChatGPT plan connected in place through Codex's device-code login, which the service runs, on the desktop and the web alike.
 *
 * Drawn under the ChatGPT plan's row while it connects, it asks the service
 * for a code (`CHATGPT_DEVICE_START`) and says the two steps that use it,
 * as an API key's paste says its own: turn device code authorization on in
 * ChatGPT, then sign in and enter the code, which it shows to copy, at the
 * verification page, which opens outside the window. Under them it waits on
 * Codex (`CHATGPT_DEVICE_WAIT`), one answer the host gives once the login
 * settles, asking after it on the interval the service named on a
 * `Schedule` of its own. Connected, it tells its owner, who puts it away;
 * the keys the answer carries are laid where the host holds them, so the
 * row says the plan is connected as the steps go. Expired, refused, or
 * canceled, it says the service's fixed sentence and offers Try again,
 * which starts afresh, as an ask that went unanswered does. Putting it
 * away, the row's Cancel or the surface going, withdraws a login still
 * waiting (`CHATGPT_DEVICE_CANCEL`), as does a code that lands after it
 * went or started over, so no login stands that nothing asks after.
 *
 * Every word is the app's own and shows in a screen recording, but the
 * code, which is masked.
 */

const WORDS = {
  TURN_ON: "In ChatGPT Settings → Security, turn on device code authorization for Codex",
  TURN_ON_HINT:
    "If you don't see this option, ask your workspace admin to enable device code authentication for Codex CLI",
  CODE: "Code",
  ENTER_CODE: "Sign in to ChatGPT, select your workspace if prompted, and enter the code:",
  VERIFICATION_PAGE: "Verification page",
  WAITING: "Waiting for Codex",
  GETTING_CODE: "Getting a code",
  START_FAILED: "Couldn't reach ChatGPT for a code. Try again.",
  WAIT_FAILED: "Couldn't reach ChatGPT to finish connecting. Try again.",
  TRY_AGAIN: "Try again",
} as const;

/** Where the dialog stands: getting a code, waiting on it, or ended in a failure Try again starts over from. */
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

const UNANSWERED = { failure: AGENT_CALL_FAILURE.UNANSWERED } as const;

/**
 * The login while it is drawn: a code asked for as it mounts and on Try
 * again, the login asked after while it waits, and withdrawn as it goes
 * away with it still waiting.
 */
function useDeviceLogin(
  add: boolean,
  onConnected: () => void,
): { standing: Standing; retry: () => void } {
  const { mutateAsync: sendChatgptDeviceStart } = useMutation(
    actMutation(ACT_KIND.CHATGPT_DEVICE_START),
  );
  const { mutateAsync: sendChatgptDeviceWait } = useMutation(
    actMutation(ACT_KIND.CHATGPT_DEVICE_WAIT),
  );
  const { mutate: sendChatgptDeviceCancel } = useMutation(
    actMutation(ACT_KIND.CHATGPT_DEVICE_CANCEL),
  );
  const [standing, setStanding] = useState<Standing>(STARTING);
  // Note that a ref counts the starts, because a start's answer reads it as it lands, which no render stands between.
  const starts = useRef(0);
  const connected = useRef(onConnected);
  connected.current = onConnected;

  const start = useCallback(() => {
    starts.current += 1;
    const mine = starts.current;
    setStanding(STARTING);
    void sendChatgptDeviceStart(add ? { add } : undefined)
      .catch(() => UNANSWERED)
      .then((answer) => {
        if (mine !== starts.current) {
          if (!("failure" in answer)) {
            sendChatgptDeviceCancel({ loginId: answer.loginId });
          }
          return;
        }
        setStanding(
          "failure" in answer
            ? { kind: STANDING.FAILED, words: WORDS.START_FAILED }
            : { kind: STANDING.WAITING, login: answer },
        );
      });
  }, [add, sendChatgptDeviceStart, sendChatgptDeviceCancel]);

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
    void sendChatgptDeviceWait({ loginId, intervalSeconds })
      .catch(() => UNANSWERED)
      .then((answer) => {
        if (!waiting) return;
        waiting = false;
        if ("failure" in answer) {
          setStanding({ kind: STANDING.FAILED, words: WORDS.WAIT_FAILED });
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
      sendChatgptDeviceCancel({ loginId });
    };
  }, [login, sendChatgptDeviceWait, sendChatgptDeviceCancel]);

  return { standing, retry: start };
}

/** The two steps over a code handed out, as a pasted key's are drawn, and the wait on Codex under them. */
function CodeSteps({ login }: { login: ChatGptDeviceStartAnswer }): React.JSX.Element {
  const openLink = useOpenLink();
  const url = login.verificationUrl;
  return (
    <Stack gap={GAP.CONTROL}>
      <Steps>
        <Step number={1} title={WORDS.TURN_ON} state={STEP_STATE.CURRENT}>
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {WORDS.TURN_ON_HINT}
          </Text>
        </Step>
        <Step number={2} title={WORDS.ENTER_CODE} state={STEP_STATE.CURRENT}>
          <ReplayMask>
            <CopyField
              label={WORDS.CODE}
              value={login.userCode}
              what="code"
              copy={copyThroughShell}
              width={COPY_FIELD_WIDTH.HUG}
            />
          </ReplayMask>
          <Inline>
            <ButtonLink
              href={url}
              variant={BUTTON_VARIANT.OUTLINE}
              external
              onClick={linkPressOf(openLink, url)}
            >
              {WORDS.VERIFICATION_PAGE}
            </ButtonLink>
          </Inline>
        </Step>
      </Steps>
      <WaitingLine>{WORDS.WAITING}</WaitingLine>
    </Stack>
  );
}

/**
 * The ChatGPT plan's login in place, from the moment it is drawn: getting a
 * code, its steps and the wait, or why it ended with Try again.
 * `onConnected` hears the plan connected; its owner puts it away then.
 */
export function ChatGptDeviceLogin({
  add = false,
  onConnected,
}: {
  /** Whether the plan it connects is added at the bottom of the account's order rather than replacing its first; one signed in as a plan the account holds replaces that one either way. */
  add?: boolean;
  onConnected: () => void;
}): React.JSX.Element {
  const { standing, retry } = useDeviceLogin(add, onConnected);
  return standing.kind === STANDING.STARTING ? (
    <WaitingLine>{WORDS.GETTING_CODE}</WaitingLine>
  ) : standing.kind === STANDING.WAITING ? (
    <CodeSteps login={standing.login} />
  ) : (
    <Stack gap={GAP.CONTROL}>
      <ErrorLine
        level={ANNOUNCE.ALERT}
        error={refusedShown(standing.words, FAILURE_SURFACE.AGENT_KEY_SAVE)}
      />
      <Inline>
        <Button variant={BUTTON_VARIANT.PRIMARY} onClick={retry}>
          {WORDS.TRY_AGAIN}
        </Button>
      </Inline>
    </Stack>
  );
}
