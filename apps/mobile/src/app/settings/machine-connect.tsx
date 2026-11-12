// machine-connect.tsx -- a machine's pairing approved or denied on Settings › Machines, by the code its link named, under the panel's own checks: the machine as it named itself, what it is and the address its start came from, the code to hold against its terminal and when it expires, then Connect or Deny.

import {
  HOST_CONNECT_WORDS,
  hostBoxFacts,
  hostCodeExpiryText,
  hostConnectQuestion,
  hostConnectRefusalWords,
  hostDeniedTitle,
} from "@repo/features/host-connect-words";
import {
  HOST_PAIRING_CALL_FAILURE,
  type HostPairingFailed,
} from "@repo/features/host-pairing-view";
import {
  type HostPairingAnswer,
  hostUserCodeOf,
  shownHostUserCode,
} from "@repo/features/host-wire";
import { VERB } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import {
  ActionRow,
  BUZZ,
  buzz,
  CodeRow,
  EmptyState,
  ListSection,
  NoteRow,
  Screen,
  SettingsForm,
} from "@repo/ui-native";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import { Stack, useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useHostActs } from "../../host/host-provider.js";
import { PLATFORM_SYMBOL } from "../../machine-symbol.js";
import { SETTINGS_ROUTE } from "../../settings-button.js";

export { ScreenBoundary as ErrorBoundary } from "../../screen-boundary.js";

/** The key the pairing's read is held under, by its code. */
const HOST_PAIRING_QUERY = "host-pairing";

/** The glyph the page stands under while it reads, and where it ends. */
const PAIRING_SYMBOL = "desktopcomputer";

/** What a flow finds the page's parts by. */
const TEST_IDS = {
  CODE: "machine-connect-code",
} as const;

/** Where the page stands: reading the pairing, unable to, asking, or done in one of the ways it ends, as the panel's dialog stands. */
const STANDING = {
  READING: "reading",
  UNREAD: "unread",
  ASKING: "asking",
  CONNECTED: "connected",
  DENIED: "denied",
  REFUSED: "refused",
} as const;

/** Which of the two answers was pressed. */
const ANSWER = {
  CONNECT: "connect",
  DENY: "deny",
} as const;

type Answer = (typeof ANSWER)[keyof typeof ANSWER];

/** Where an answer stands while the question still does: on its way, or failed on its way to the service. */
const SENDING = {
  ...ANSWER,
  UNANSWERED: "unanswered",
} as const;

type Sending = (typeof SENDING)[keyof typeof SENDING];

type Standing =
  | { readonly kind: typeof STANDING.READING | typeof STANDING.UNREAD }
  | {
      readonly kind: typeof STANDING.ASKING;
      readonly box: HostPairingAnswer;
      readonly sending?: Sending;
    }
  | {
      readonly kind: typeof STANDING.CONNECTED | typeof STANDING.DENIED;
      readonly box: HostPairingAnswer;
    }
  | { readonly kind: typeof STANDING.REFUSED; readonly refusal: HostPairingFailed };

/** An answer that never reached the service, as a call that failed on its way is read. */
const UNANSWERED: HostPairingFailed = { failure: HOST_PAIRING_CALL_FAILURE.UNANSWERED };

/** A code no pending pairing could have, as the service would refuse it. */
const NOT_FOUND: HostPairingFailed = { failure: HOST_PAIRING_CALL_FAILURE.NOT_FOUND };

/** Where a read or an answer that failed leaves the page: unable to read or answer where it never reached the service, and refused otherwise. */
function failedStanding(failed: HostPairingFailed, unanswered: Standing): Standing {
  return failed.failure === HOST_PAIRING_CALL_FAILURE.UNANSWERED
    ? unanswered
    : { kind: STANDING.REFUSED, refusal: failed };
}

/** Where the pairing's read leaves the page before anything is pressed. */
function readStanding(pairing: UseQueryResult<HostPairingAnswer | HostPairingFailed>): Standing {
  if (pairing.isPending || (pairing.isError && pairing.isFetching))
    return { kind: STANDING.READING };

  if (pairing.isError) return failedStanding(UNANSWERED, { kind: STANDING.UNREAD });
  const answer = pairing.data;

  return "failure" in answer
    ? failedStanding(answer, { kind: STANDING.UNREAD })
    : { kind: STANDING.ASKING, box: answer };
}

export default function MachineConnectScreen() {
  const { code: named = "" } = useLocalSearchParams<{ code?: string }>();
  // Note that a code is read as the link's own grammar reads one, so a route handed anything else asks the service nothing.
  const code = hostUserCodeOf(named);

  // Note that the page is drawn anew for each code, so an answer to one never stands over another.
  return code === undefined ? <Refused refusal={NOT_FOUND} /> : <Pairing key={code} code={code} />;
}

/** Why a code can't be used, and what to do next, in the panel's words. */
function Refused({ refusal }: { readonly refusal: HostPairingFailed }) {
  const words = hostConnectRefusalWords(refusal);

  return (
    <>
      <Stack.Screen options={{ title: HOST_CONNECT_WORDS.TITLE }} />
      <Screen>
        <EmptyState
          title={words.title}
          description={words.body}
          symbol="exclamationmark.triangle"
        />
      </Screen>
    </>
  );
}

/**
 * The page for one code: read as it opens, so the member sees whose machine
 * it is before anything is pressed, then asked, answered, or why it can't
 * be, as the panel's Connect dialog stands. Connect makes the machine at
 * once and goes on to the list of machines, which carries it; Deny ends the
 * pairing and says so. Note that Back is held while an answer is out, as the
 * dialog holds its dismiss.
 */
function Pairing({ code }: { readonly code: string }) {
  const acts = useHostActs();
  const router = useRouter();
  const navigation = useNavigation();
  // Whether the page still stands, since an answer that lands after it was left must not move the screen in front.
  const standing = useRef(true);
  useEffect(() => {
    standing.current = true;

    return () => {
      standing.current = false;
    };
  }, []);

  const pairing = useQuery({
    queryKey: [HOST_PAIRING_QUERY, code],
    queryFn: () => acts[ACT_KIND.HOSTS_PAIRING_READ]({ code }),
    retry: false,
  });

  const [afterPress, setAfterPress] = useState<Standing | undefined>(undefined);
  // Whether an answer is out, read at the press itself, so a second press before the page draws again sends nothing.
  const out = useRef(false);
  const now = afterPress ?? readStanding(pairing);

  const answer = (box: HostPairingAnswer, pressed: Answer) => {
    if (out.current) return;
    out.current = true;
    setAfterPress({ kind: STANDING.ASKING, box, sending: pressed });

    const sent =
      pressed === ANSWER.CONNECT
        ? acts[ACT_KIND.HOSTS_PAIRING_APPROVE]({ code })
        : acts[ACT_KIND.HOSTS_PAIRING_DENY]({ code });

    void sent
      .catch((): HostPairingFailed => UNANSWERED)
      .then((answered) => {
        out.current = false;
        const unanswered = { kind: STANDING.ASKING, box, sending: SENDING.UNANSWERED } as const;

        if ("failure" in answered) {
          buzz(BUZZ.ERROR);
          setAfterPress(failedStanding(answered, unanswered));

          return;
        }

        buzz(BUZZ.SUCCESS);

        if (pressed === ANSWER.DENY) {
          setAfterPress({ kind: STANDING.DENIED, box });

          return;
        }

        setAfterPress({ kind: STANDING.CONNECTED, box });

        // Note that Connect goes on to the list of machines, which reads the one just made, as the panel's dialog closes onto it.
        if (standing.current && navigation.isFocused()) router.replace(SETTINGS_ROUTE.MACHINES);
      });
  };

  switch (now.kind) {
    case STANDING.ASKING:
    case STANDING.CONNECTED:
      return (
        <Ask
          code={code}
          box={now.box}
          sending={now.kind === STANDING.ASKING ? now.sending : undefined}
          connected={now.kind === STANDING.CONNECTED}
          onAnswer={(pressed) => answer(now.box, pressed)}
        />
      );
    case STANDING.DENIED:
      return (
        <>
          <Stack.Screen options={{ title: HOST_CONNECT_WORDS.TITLE }} />
          <Screen>
            <EmptyState
              title={hostDeniedTitle(now.box)}
              description={HOST_CONNECT_WORDS.DENIED}
              symbol={PAIRING_SYMBOL}
            />
          </Screen>
        </>
      );
    case STANDING.REFUSED:
      return <Refused refusal={now.refusal} />;
    default:
      return (
        <>
          <Stack.Screen options={{ title: HOST_CONNECT_WORDS.TITLE }} />
          <Screen>
            {now.kind === STANDING.UNREAD ? (
              <EmptyState
                title={HOST_CONNECT_WORDS.UNREAD}
                symbol="exclamationmark.triangle"
                action={{ label: VERB.RETRY, onPress: () => void pairing.refetch() }}
              />
            ) : (
              <EmptyState title={HOST_CONNECT_WORDS.READING} symbol={PAIRING_SYMBOL} loading />
            )}
          </Screen>
        </>
      );
  }
}

/**
 * The question, as the panel's dialog asks it: whose machine, by the name
 * and platform it reported, its architecture and the address its start came
 * from; to connect it only if the member ran the command and the code
 * matches; the code and when it expires; then Connect and Deny, neither
 * taking a press while an answer is out or once the machine is made.
 */
function Ask({
  code,
  box,
  sending,
  connected,
  onAnswer,
}: {
  readonly code: string;
  readonly box: HostPairingAnswer;
  readonly sending: Sending | undefined;
  readonly connected: boolean;
  readonly onAnswer: (answer: Answer) => void;
}) {
  const inFlight = sending === SENDING.CONNECT || sending === SENDING.DENY;
  const settled = inFlight || connected;

  return (
    <>
      <Stack.Screen
        options={{
          title: hostConnectQuestion(box),
          headerBackVisible: !settled,
          gestureEnabled: !settled,
        }}
      />
      <Screen>
        <SettingsForm>
          <ListSection footer={HOST_CONNECT_WORDS.MATCH}>
            <NoteRow
              symbol={PLATFORM_SYMBOL[box.platform]}
              words={box.name}
              line={hostBoxFacts(box)}
            />
          </ListSection>
          <ListSection footer={hostCodeExpiryText(box.expiresAt)}>
            <CodeRow code={shownHostUserCode(code)} testId={TEST_IDS.CODE} />
          </ListSection>
          <ListSection
            footer={sending === SENDING.UNANSWERED ? HOST_CONNECT_WORDS.UNANSWERED : undefined}
          >
            <ActionRow
              label={
                sending === SENDING.CONNECT
                  ? HOST_CONNECT_WORDS.CONNECTING
                  : HOST_CONNECT_WORDS.CONNECT
              }
              disabled={settled}
              onPress={() => onAnswer(ANSWER.CONNECT)}
            />
            <ActionRow
              label={
                sending === SENDING.DENY ? HOST_CONNECT_WORDS.DENYING : HOST_CONNECT_WORDS.DENY
              }
              disabled={settled}
              onPress={() => onAnswer(ANSWER.DENY)}
            />
          </ListSection>
        </SettingsForm>
      </Screen>
    </>
  );
}
