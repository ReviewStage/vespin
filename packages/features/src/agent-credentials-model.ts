/**
 * agent-credentials-model.ts -- the agents' credentials as every client says them: each harness's plan and API key, what each says of itself, and whether a harness can start an agent.
 *
 * The desktop's Settings › Agents and setup's Connect an agent
 * (`@repo/panel`'s `agent-auth-section.tsx`) and the iPhone's native pages
 * read one account's credentials (`PROVIDER_KEYS_FOLLOW`) the same way and
 * in the same words, so a plan connected on one reads alike on the other.
 * A harness keeps plans (Claude's `claude setup-token`, Codex's ChatGPT
 * sign-in) beside its API keys; Cursor keeps keys alone.
 */

import { INTEGRATION_STATUS_WORDS } from "./integration-status-words.js";
import { INTEGRATION_STATUS } from "./integration-wire.js";
import { MODEL_PROVIDER, type ModelProvider } from "./models-wire.js";
import { PRODUCT_NAME } from "./product-name.js";
import {
  PLAN_NAME,
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
  type ProviderKeyRejection,
  type ProviderKeyStatus,
  type ProviderKeySummary,
  type ProviderKeysAnswer,
  type SubscriptionKeySummary,
} from "./provider-key-wire.js";
import { dueText } from "./time-format.js";
import { SIGNED_OUT_WORDS, VERB } from "./words.js";

/** The providers whose harness a surface draws credentials for: Claude Code's, Codex's, and Cursor's. */
export type CredentialProvider =
  | typeof PROVIDER_KEY_PROVIDER.ANTHROPIC
  | typeof PROVIDER_KEY_PROVIDER.OPENAI
  | typeof PROVIDER_KEY_PROVIDER.CURSOR;

/** The harnesses that keep a plan as well as API keys: Claude's setup-token and Codex's ChatGPT sign-in. Cursor keeps none. */
export type PlanProvider =
  | typeof PROVIDER_KEY_PROVIDER.ANTHROPIC
  | typeof PROVIDER_KEY_PROVIDER.OPENAI;

/** What a harness is called and where its keys are made. */
export interface HarnessInfo {
  /** What its section names it. */
  readonly name: string;
  /** The mark its section leads with. */
  readonly mark: ModelProvider;
  readonly keyName: string;
  /** Its key named with its article, as a refusal says it isn't one: "an Anthropic key". */
  readonly keyNoun: string;
  readonly keyUrl: string;
  /** What the site a key is made on is called, which its link names. */
  readonly keySite: string;
  /** How a key of its begins, which its empty field shows. */
  readonly keyExample: string;
  /** What deleting one of its keys costs, which the question says. */
  readonly keyLoss: string;
}

/** Each harness by the provider whose models it runs. */
export const HARNESS_INFO = {
  [PROVIDER_KEY_PROVIDER.ANTHROPIC]: {
    name: "Claude",
    mark: MODEL_PROVIDER.ANTHROPIC,
    keyName: "Anthropic",
    keyNoun: "an Anthropic key",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keySite: "Anthropic Console",
    keyExample: "sk-ant-api03-…",
    keyLoss: `Agents on Anthropic models won't start without a ${PLAN_NAME[PROVIDER_KEY_PROVIDER.ANTHROPIC]}.`,
  },
  [PROVIDER_KEY_PROVIDER.OPENAI]: {
    name: "Codex",
    mark: MODEL_PROVIDER.OPENAI,
    keyName: "OpenAI",
    keyNoun: "an OpenAI key",
    keyUrl: "https://platform.openai.com/api-keys",
    keySite: "OpenAI Platform",
    keyExample: "sk-proj-…",
    keyLoss: `Agents on OpenAI models won't start without a ${PLAN_NAME[PROVIDER_KEY_PROVIDER.OPENAI]}. Calls and dictation will be off.`,
  },
  [PROVIDER_KEY_PROVIDER.CURSOR]: {
    name: "Cursor",
    mark: MODEL_PROVIDER.CURSOR,
    keyName: "Cursor",
    keyNoun: "a Cursor key",
    keyUrl: "https://cursor.com/dashboard/api",
    keySite: "Cursor's dashboard",
    keyExample: "crsr_…",
    keyLoss: "Cursor agents won't start without a Cursor API key.",
  },
} as const satisfies Record<CredentialProvider, HarnessInfo>;

/** What a harness that keeps a plan adds: the plan's name, wherever a surface names the credential, and its kind. */
export interface HarnessPlan {
  readonly planName: string;
  readonly plan: SubscriptionKeySummary["kind"];
}

/** The plan of each harness that keeps one, Claude's and Codex's. */
export const HARNESS_PLAN = {
  [PROVIDER_KEY_PROVIDER.ANTHROPIC]: {
    planName: PLAN_NAME[PROVIDER_KEY_PROVIDER.ANTHROPIC],
    plan: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
  },
  [PROVIDER_KEY_PROVIDER.OPENAI]: {
    planName: PLAN_NAME[PROVIDER_KEY_PROVIDER.OPENAI],
    plan: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
  },
} as const satisfies Record<PlanProvider, HarnessPlan>;

/** Whether the harness keeps a plan, so a plan's rows, its Add, and its steps may stand for it. */
export function keepsPlan(provider: CredentialProvider): provider is PlanProvider {
  return provider !== PROVIDER_KEY_PROVIDER.CURSOR;
}

/** The harnesses every account draws, in their order. */
export const HARNESSES: readonly CredentialProvider[] = [
  PROVIDER_KEY_PROVIDER.ANTHROPIC,
  PROVIDER_KEY_PROVIDER.OPENAI,
];

/** The harnesses an account trying Cursor draws: Cursor's after the others. */
export const HARNESSES_WITH_CURSOR: readonly CredentialProvider[] = [
  ...HARNESSES,
  PROVIDER_KEY_PROVIDER.CURSOR,
];

/** The credentials' words, wherever a surface draws them. */
export const CREDENTIAL_WORDS = {
  READ_FAILED: "Your keys could not be read.",
  SIGNED_OUT: SIGNED_OUT_WORDS,
  ADD: "Add plan or key",
  REFRESH_USAGE: "Refresh usage",
  REFRESHING_USAGE: "Refreshing usage",
  REFRESH_USAGE_FAILED: "Couldn't refresh usage. Try again.",
  ADD_KEY: "Add key",
  AT_LIMIT: "At its limit",
  BACK_AT: "back at",
  RENAME: "Rename",
  PLAN_NAME: "Plan name",
  KEY_NAME: "Key name",
  RECONNECT: VERB.RECONNECT,
  SIGN_IN_AGAIN: "Sign in again",
  MANAGE_USAGE: "Manage usage in ChatGPT",
  USING_RESET: "Using reset",
  API_KEY: "API key",
  CANCEL: "Cancel",
  TOKEN_EXAMPLE: "sk-ant-oat01-…",
  SAVING_TOKEN: "Saving the token",
  CHECKING_KEY: "Checking the key",
  DISCONNECT: "Disconnect",
  DISCONNECTING: "Disconnecting",
  DELETE_KEY: "Delete key",
  DELETING: "Deleting",
  REPLACE_KEY: "Replace key",
  REPLACE_TOKEN: "Replace token",
  RUN_SETUP_TOKEN: "Run this in a terminal",
  PASTE_TOKEN: "Paste the token it prints",
  CREATE_KEY: "Create an API key",
  PASTE_KEY: "Paste the key",
  SETUP_TOKEN_COMMAND: "claude setup-token",
  SETUP_TOKEN_COMMAND_LABEL: "Setup-token command",
  COMMAND: "command",
  TOKEN_INVALID: "Anthropic rejected this token. Paste a new one.",
  TOKEN_QUOTA: "Out of usage on your Claude plan.",
  TOKEN_UNREADABLE: "This token can no longer be read. Paste a new one.",
  CHATGPT_EXPIRED: INTEGRATION_STATUS_WORDS[INTEGRATION_STATUS.EXPIRED],
  CHATGPT_UNREADABLE: "This sign-in can no longer be read.",
  CHATGPT_INELIGIBLE:
    "OpenAI says this account's plan doesn't include Codex. Sign in again to use another.",
  REVOCATION_UNCONFIRMED: `${PRODUCT_NAME} signed out of Codex, but OpenAI didn't confirm it ended. To end it there too, remove ${PRODUCT_NAME} in your ChatGPT settings.`,
  SAVE_TOKEN_FAILED: "Couldn't save the token. Try again.",
  SAVE_KEY_FAILED: "Couldn't save the key. Try again.",
  DELETE_KEY_FAILED: "Couldn't delete the key. Try again.",
  CLAUDE_DISCONNECT_FAILED: "Couldn't disconnect your Claude plan. Try again.",
  CHATGPT_DISCONNECT_FAILED: "Couldn't disconnect your Codex plan. Try again.",
  REORDER_FAILED: "Couldn't reorder. Try again.",
  RENAME_FAILED: "Couldn't rename it. Try again.",
} as const;

/** What a question that removes a credential says: its title, what goes, its act, and its act while it runs. */
export interface CredentialRemovalWords {
  readonly title: string;
  readonly body: string;
  readonly verb: string;
  readonly running: string;
}

/** What disconnecting each harness's plan asks. */
export const PLAN_DISCONNECT_WORDS = {
  [PROVIDER_KEY_PROVIDER.ANTHROPIC]: {
    title: "Disconnect your Claude plan?",
    body: `Claude agents stop running on your Claude plan, and ${PRODUCT_NAME} deletes its token.`,
    verb: "Disconnect Claude plan",
    running: CREDENTIAL_WORDS.DISCONNECTING,
  },
  [PROVIDER_KEY_PROVIDER.OPENAI]: {
    title: "Disconnect your Codex plan?",
    body: `Codex agents stop running on this plan, and ${PRODUCT_NAME} signs out of it.`,
    verb: "Disconnect Codex plan",
    running: CREDENTIAL_WORDS.DISCONNECTING,
  },
} as const satisfies Record<PlanProvider, CredentialRemovalWords>;

/** What removing a provider's key asks. */
export function keyRemovalWords(provider: CredentialProvider): CredentialRemovalWords {
  const harness = HARNESS_INFO[provider];

  return {
    title: `Delete your ${harness.keyName} ${CREDENTIAL_WORDS.API_KEY}?`,
    body: harness.keyLoss,
    verb: CREDENTIAL_WORDS.DELETE_KEY,
    running: CREDENTIAL_WORDS.DELETING,
  };
}

/* ----- Reading the credentials ----- */

/** The harness's plans among the account's subscriptions, in the account's order; none for a harness that keeps no plan. */
export function plansOf(
  answer: ProviderKeysAnswer,
  provider: CredentialProvider,
): readonly SubscriptionKeySummary[] {
  if (!keepsPlan(provider)) return [];
  const { plan } = HARNESS_PLAN[provider];

  return (answer.subscriptions ?? [])
    .filter((one) => one.kind === plan)
    .toSorted((a, b) => a.position - b.position);
}

/** The provider's API keys among the account's keys. */
export function keysOf(
  answer: ProviderKeysAnswer,
  provider: CredentialProvider,
): readonly ProviderKeySummary[] {
  return answer.keys.filter((one) => one.provider === provider);
}

/** Whether a stored plan still stands: kept, answered, or only waiting on its limit to reset. */
export function planStanding(plan: SubscriptionKeySummary): boolean {
  return (
    plan.status === PROVIDER_KEY_STATUS.UNVERIFIED ||
    plan.status === PROVIDER_KEY_STATUS.VERIFIED ||
    plan.status === PROVIDER_KEY_STATUS.LIMIT_REACHED
  );
}

/** Whether a stored key is one its provider has not refused. */
export function keyStanding(status: ProviderKeyStatus): boolean {
  return status === PROVIDER_KEY_STATUS.VERIFIED || status === PROVIDER_KEY_STATUS.UNVERIFIED;
}

/** Whether the harness can start an agent now: a plan short of its limit, or a key that stands. */
export function harnessReady(answer: ProviderKeysAnswer, provider: CredentialProvider): boolean {
  return (
    plansOf(answer, provider).some(
      (plan) => planStanding(plan) && plan.status !== PROVIDER_KEY_STATUS.LIMIT_REACHED,
    ) || keysOf(answer, provider).some((key) => keyStanding(key.status))
  );
}

/* ----- What a credential says ----- */

/** A reached limit's words, with when it resets where the provider named it: "At its limit, back at 3:40 PM". */
export function limitWords(plan: SubscriptionKeySummary, now: number): string {
  return plan.limitResetsAt === undefined
    ? CREDENTIAL_WORDS.AT_LIMIT
    : `${CREDENTIAL_WORDS.AT_LIMIT}, ${CREDENTIAL_WORDS.BACK_AT} ${dueText(plan.limitResetsAt, now)}`;
}

/** What a Claude token that does not stand says. */
export function tokenWords(plan: SubscriptionKeySummary): string {
  switch (plan.status) {
    case PROVIDER_KEY_STATUS.QUOTA_EXCEEDED:
      return CREDENTIAL_WORDS.TOKEN_QUOTA;
    case PROVIDER_KEY_STATUS.UNREADABLE:
      return CREDENTIAL_WORDS.TOKEN_UNREADABLE;
    default:
      return CREDENTIAL_WORDS.TOKEN_INVALID;
  }
}

/** What a Codex sign-in that does not stand says. */
export function signInWords(plan: SubscriptionKeySummary): string {
  switch (plan.status) {
    case PROVIDER_KEY_STATUS.UNREADABLE:
      return CREDENTIAL_WORDS.CHATGPT_UNREADABLE;
    case PROVIDER_KEY_STATUS.INELIGIBLE:
      return CREDENTIAL_WORDS.CHATGPT_INELIGIBLE;
    default:
      return CREDENTIAL_WORDS.CHATGPT_EXPIRED;
  }
}

/** What mends a Codex sign-in that does not stand: Sign in again as another account where the plan has no Codex, else Reconnect. */
export function signInFix(plan: SubscriptionKeySummary): string {
  return plan.status === PROVIDER_KEY_STATUS.INELIGIBLE
    ? CREDENTIAL_WORDS.SIGN_IN_AGAIN
    : CREDENTIAL_WORDS.RECONNECT;
}

/** What a plan that does not stand says, by its harness; nothing where it stands. */
export function planProblemWords(
  provider: PlanProvider,
  plan: SubscriptionKeySummary,
  now: number,
): string | undefined {
  if (plan.status === PROVIDER_KEY_STATUS.LIMIT_REACHED) return limitWords(plan, now);

  if (planStanding(plan)) return undefined;

  return provider === PROVIDER_KEY_PROVIDER.ANTHROPIC ? tokenWords(plan) : signInWords(plan);
}

/** What an API key's line says, by the provider it names: nothing where it stands, but its hint where its name hides it, or what is wrong with it. */
export function keyLineWords(
  provider: CredentialProvider,
  key: ProviderKeySummary,
): string | undefined {
  const name = HARNESS_INFO[provider].keyName;

  switch (key.status) {
    case PROVIDER_KEY_STATUS.VERIFIED:
    case PROVIDER_KEY_STATUS.UNVERIFIED:
      return key.label === undefined ? undefined : `${CREDENTIAL_WORDS.API_KEY} · ${key.hint}`;
    case PROVIDER_KEY_STATUS.INVALID:
      return `${name} rejected this key.`;
    case PROVIDER_KEY_STATUS.QUOTA_EXCEEDED:
    // Note that a plan's limit and eligibility are a subscription's words, which no API key is answered with.
    case PROVIDER_KEY_STATUS.LIMIT_REACHED:
    case PROVIDER_KEY_STATUS.INELIGIBLE:
      return `Out of credit at ${name}.`;
    case PROVIDER_KEY_STATUS.UNREADABLE:
      return "This key can no longer be read.";
  }
}

/** Why an API key's save kept nothing, in words the developer can act on. */
export function keyRejectionWords(
  provider: CredentialProvider,
  rejection: ProviderKeyRejection,
): string {
  const name = HARNESS_INFO[provider].keyName;

  switch (rejection) {
    case PROVIDER_KEY_REJECTION.INVALID:
      return `${name} didn't accept this key. Check it and try again.`;
    case PROVIDER_KEY_REJECTION.WRONG_PROVIDER:
      return `This isn't ${HARNESS_INFO[provider].keyNoun}. Paste it under the provider it's for.`;

    case PROVIDER_KEY_REJECTION.UNREACHABLE:
      return `Couldn't reach ${name} to check this key. Try again.`;
    case PROVIDER_KEY_REJECTION.TOO_MANY_TRIES:
      return "Too many tries in the last hour. Try again later.";
  }
}

/** Why a Claude token's save kept nothing. */
export function tokenRejectionWords(rejection: ProviderKeyRejection): string {
  return rejection === PROVIDER_KEY_REJECTION.TOO_MANY_TRIES
    ? "Too many tries in the last hour. Try again later."
    : "That isn't a Claude setup-token. Run claude setup-token and paste what it prints.";
}

/* ----- A ChatGPT plan's device-code sign-in ----- */

/** The device-code sign-in's words, as each client says its steps. */
export const CHATGPT_DEVICE_WORDS = {
  TURN_ON: "In ChatGPT Settings → Security, turn on device code authorization for Codex",
  TURN_ON_HINT:
    "If you don't see this option, ask your workspace admin to enable device code authentication for Codex CLI",
  CODE: "Code",
  ENTER_CODE:
    "Sign in with your Codex account, select your workspace if prompted, and enter the code:",
  VERIFICATION_PAGE: "Open the verification page",
  WAITING: "Waiting for Codex",
  GETTING_CODE: "Getting a code",
  START_FAILED: "Couldn't reach Codex for a code. Try again.",
  WAIT_FAILED: "Couldn't reach Codex to finish connecting. Try again.",
  RETRY: "Retry",
} as const;
