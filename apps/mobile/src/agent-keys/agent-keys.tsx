// agent-keys.tsx -- the account's agent credentials as the phone draws them, Settings › Agents' and setup's Connect an agent alike: a section for Claude and one for Codex, each plan and API key a row with what it says of itself, and the ways to add one.

import { signedInAccountId } from "@repo/credentials/snapshot";
import {
  CREDENTIAL_WORDS,
  type CredentialProvider,
  HARNESS_INFO,
  HARNESS_PLAN,
  HARNESSES,
  harnessReady,
  keepsPlan,
  keyLineWords,
  keyRemovalWords,
  keysOf,
  PLAN_DISCONNECT_WORDS,
  planProblemWords,
  plansOf,
} from "@repo/features/agent-credentials-model";
import { INTEGRATION_STATUS_WORDS } from "@repo/features/integration-status-words";
import { INTEGRATION_STATUS } from "@repo/features/integration-wire";
import { LIVE_READ } from "@repo/features/live-wire";
import {
  apiKeyName,
  type PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  type ProviderKeysAnswer,
  planNamesOf,
} from "@repo/features/provider-key-wire";
import { ACT_KIND } from "@repo/host/acts";
import type { AppStateSnapshot } from "@repo/host/app-state";
import { selectAccount } from "@repo/host/app-state-reads";
import {
  ActionRow,
  ConfirmAsk,
  EmptyState,
  GLYPH,
  ListSection,
  LoadingRow,
  NoteRow,
} from "@repo/ui-native";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { type ReactElement, useCallback, useState } from "react";
import { appStateQuery } from "../host/app-state-query.js";
import { useHostActs } from "../host/host-provider.js";
import { useLiveFollow } from "../host/live-follow.js";
import { useWrite } from "../use-write.js";

/** What the phone's own rows say beside the shared words. */
const WORDS = {
  /** A plan or key that stands. */
  CONNECTED: INTEGRATION_STATUS_WORDS[INTEGRATION_STATUS.CONNECTED],
  /** Adding a Claude plan, which takes a token a computer prints. */
  ADD_CLAUDE_PLAN: "Paste a Claude token",
  /** Adding a Codex plan, through ChatGPT's sign-in. */
  ADD_CODEX_PLAN: "Sign in with ChatGPT",
  ADD_KEY: (provider: CredentialProvider) => `Add an ${HARNESS_INFO[provider].keyName} API key`,
  READING: "Reading your keys",
} as const;

/** The routes a credential's adding opens, each a sheet over the screen it was asked from. */
const AGENT_KEY_ROUTE = {
  /** A Claude token or an API key pasted, by `provider` and `kind`. */
  PASTE: "/agent-key",
  /** A Codex plan connected through ChatGPT's device-code sign-in. */
  CHATGPT: "/chatgpt-sign-in",
} as const;

/** What a paste saves: a Claude plan's token, or an API key. */
export const PASTE_KIND = {
  TOKEN: "token",
  KEY: "key",
} as const;

export type PasteKind = (typeof PASTE_KIND)[keyof typeof PASTE_KIND];

/** A credential the reader asked to take away, and the question that asks first. */
export interface Removal {
  readonly provider: CredentialProvider;
  readonly kind?:
    | typeof PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN
    | typeof PROVIDER_KEY_KIND.CHATGPT_OAUTH;
  readonly subscriptionId?: string;
  readonly title: string;
  readonly body: string;
  readonly verb: string;
}

/** The account's credentials as a screen reads them: the answer once read, whether the read failed, and Try again. */
interface AgentKeysRead {
  readonly answer: ProviderKeysAnswer | undefined;
  readonly failed: boolean;
  readonly retry: () => void;
}

/** The question that takes a credential away, to draw beside the screen, and what asks it. */
interface AgentKeyRemoval {
  readonly ask: ReactElement;
  readonly remove: (removal: Removal) => void;
}

/** The host's read of the account's credentials, as a `select`: unread, failed, or its rows. */
function heldKeys(accountId: string) {
  return (state: AppStateSnapshot) => state[LIVE_READ.PROVIDER_KEYS][accountId];
}

/**
 * The account's credentials, followed while the screen that reads them
 * stands: the answer once read, whether the read failed, and Try again.
 */
export function useAgentKeys(): AgentKeysRead {
  const acts = useHostActs();
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const key = accountId ?? "";
  useLiveFollow(accountId, () => acts[ACT_KIND.PROVIDER_KEYS_FOLLOW]());
  const held = useQuery({ ...appStateQuery, select: useCallback(heldKeys(key), [key]) }).data;

  return {
    answer: held?.rows,
    failed: held?.failed === true,
    retry: () =>
      void acts[ACT_KIND.PROVIDER_KEYS_RETRY]().catch((cause: unknown) =>
        console.error("Reading the agent keys again did not go.", cause),
      ),
  };
}

/** Whether any harness drawn can start an agent with the credentials read; none while they are read. */
export function agentConnected(answer: ProviderKeysAnswer | undefined): boolean | undefined {
  return answer === undefined
    ? undefined
    : HARNESSES.some((provider) => harnessReady(answer, provider));
}

/** One harness's plans and keys, each a row saying how it stands, and the ways to add one. */
function HarnessSection({
  provider,
  answer,
  onRemove,
}: {
  readonly provider: CredentialProvider;
  readonly answer: ProviderKeysAnswer;
  readonly onRemove: (removal: Removal) => void;
}) {
  const router = useRouter();
  const now = Date.now();
  const plans = plansOf(answer, provider);
  const names = planNamesOf(provider, plans);

  const paste = (kind: PasteKind) =>
    router.push({ pathname: AGENT_KEY_ROUTE.PASTE, params: { provider, kind } });

  const planRows = keepsPlan(provider)
    ? plans.map((plan) => (
        <NoteRow
          key={plan.id}
          harness={provider}
          words={names.get(plan.id) ?? HARNESS_PLAN[provider].planName}
          line={planProblemWords(provider, plan, now) ?? WORDS.CONNECTED}
          remove={{
            label: CREDENTIAL_WORDS.DISCONNECT,
            onPress: () =>
              onRemove({
                provider,
                kind: HARNESS_PLAN[provider].plan,
                subscriptionId: plan.id,
                ...PLAN_DISCONNECT_WORDS[provider],
              }),
          }}
        />
      ))
    : [];

  const keyRows = keysOf(answer, provider).map((key) => (
    <NoteRow
      key={key.id}
      harness={provider}
      words={key.label ?? apiKeyName(key)}
      line={keyLineWords(provider, key) ?? WORDS.CONNECTED}
      remove={{
        label: CREDENTIAL_WORDS.DELETE_KEY,
        onPress: () =>
          onRemove({
            provider,
            ...(key.id === undefined ? undefined : { subscriptionId: key.id }),
            ...keyRemovalWords(provider),
          }),
      }}
    />
  ));

  return (
    <ListSection title={HARNESS_INFO[provider].name}>
      {planRows}
      {keyRows}
      {provider === PROVIDER_KEY_PROVIDER.ANTHROPIC ? (
        <ActionRow
          label={WORDS.ADD_CLAUDE_PLAN}
          symbol={GLYPH.ADD}
          onPress={() => paste(PASTE_KIND.TOKEN)}
        />
      ) : null}
      {provider === PROVIDER_KEY_PROVIDER.OPENAI ? (
        <ActionRow
          label={WORDS.ADD_CODEX_PLAN}
          symbol={GLYPH.ADD}
          onPress={() => router.push(AGENT_KEY_ROUTE.CHATGPT)}
        />
      ) : null}
      <ActionRow
        label={WORDS.ADD_KEY(provider)}
        symbol={GLYPH.ADD}
        onPress={() => paste(PASTE_KIND.KEY)}
      />
    </ListSection>
  );
}

/**
 * The question that takes a credential away, and its press: drawn beside the
 * screen's `Screen`, never inside it, as every ask stands, and asked by a
 * row's Disconnect or Delete key through `remove`.
 */
export function useAgentKeyRemoval(): AgentKeyRemoval {
  const acts = useHostActs();
  const write = useWrite();
  const [asked, setAsked] = useState<Removal | undefined>(undefined);

  const ask = (
    <ConfirmAsk
      title={asked?.title ?? ""}
      message={asked?.body}
      act={asked?.verb ?? ""}
      destructive
      presented={asked !== undefined}
      onDismiss={() => setAsked(undefined)}
      onAct={() => {
        if (asked === undefined) return;
        const { provider, kind, subscriptionId } = asked;
        setAsked(undefined);
        void write(
          () =>
            acts[ACT_KIND.PROVIDER_KEYS_REMOVE]({
              provider,
              ...(kind === undefined ? undefined : { kind }),
              ...(subscriptionId === undefined ? undefined : { subscriptionId }),
            }),
          {
            refused: (removed) =>
              "failure" in removed
                ? kind === undefined
                  ? CREDENTIAL_WORDS.DELETE_KEY_FAILED
                  : provider === PROVIDER_KEY_PROVIDER.ANTHROPIC
                    ? CREDENTIAL_WORDS.CLAUDE_DISCONNECT_FAILED
                    : CREDENTIAL_WORDS.CHATGPT_DISCONNECT_FAILED
                : undefined,
            retry: true,
          },
        );
      }}
    />
  );

  return { ask, remove: setAsked };
}

/**
 * The account's agent credentials, a section per harness, Claude's then
 * Codex's, as the panel's Agents cards stand: each plan and key a row
 * saying how it stands, taken away behind a swipe or its long press after
 * the question `onRemove` asks (`useAgentKeyRemoval`), and the ways to add
 * one under them. Cursor's keys, behind an experiment on the desktop, stay
 * there. While the read is out it says so, and a read that failed offers
 * Try again.
 */
export function AgentKeySections({ onRemove }: { readonly onRemove: (removal: Removal) => void }) {
  const { answer, failed, retry } = useAgentKeys();

  if (answer === undefined) {
    return failed ? (
      <ListSection>
        <EmptyState title={CREDENTIAL_WORDS.READ_FAILED} symbol={GLYPH.FAILED} retry={retry} />
      </ListSection>
    ) : (
      <ListSection>
        <LoadingRow words={WORDS.READING} />
      </ListSection>
    );
  }

  return HARNESSES.map((provider) => (
    <HarnessSection key={provider} provider={provider} answer={answer} onRemove={onRemove} />
  ));
}
