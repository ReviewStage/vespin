import { signedInAccountId } from "@repo/credentials/snapshot";
import { INTEGRATION_STATUS_WORDS } from "@repo/features/integration-status-words";
import { INTEGRATION_STATUS } from "@repo/features/integration-wire";
import { MODEL_PROVIDER, type ModelProvider } from "@repo/features/models-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  apiKeyName,
  PLAN_NAME,
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_REJECTION,
  PROVIDER_KEY_STATUS,
  type ProviderKeyProvider,
  type ProviderKeyRejection,
  type ProviderKeyStatus,
  type ProviderKeySummary,
  type ProviderKeysAnswer,
  pastedKeyFits,
  planNamesOf,
  SUBSCRIPTION_LABEL_MAX_CHARS,
  type SubscriptionKeySummary,
} from "@repo/features/provider-key-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { dueText } from "@repo/features/time-format";
import { readingWords, SIGNED_OUT_WORDS, VERB } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import type { PortActPayload } from "@repo/host/contract";
import { SETTINGS_SECTION } from "@repo/settings/settings-views";
import {
  ANNOUNCE,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CONFIRM_LOSS,
  COPY_FIELD_PROMPT,
  COPY_FIELD_WIDTH,
  ConfirmDialog,
  CopyField,
  type DialogConfirm,
  type DialogQuestion,
  GAP,
  type Gap,
  MARK_PROVIDER,
  MoreButton,
  moreLabel,
  OutsideLink,
  type PasteFirstStep,
  PasteSteps,
  PROGRESS_TONE,
  PROVIDER_MARK_SIZE,
  type ProgressTone,
  ProviderMark,
  RenamableName,
  SETTINGS_ORDER_HANDLE,
  SETTINGS_ROW_CONTROLS,
  SETTINGS_ROW_MARK_WIDTH,
  SETTINGS_ROW_STATE,
  SETTINGS_SKELETON_CONTROL,
  SettingsLine,
  SettingsOrderedRows,
  SettingsRow,
  SettingsRowAction,
  SettingsRowMark,
  SettingsRowMeter,
  type SettingsRowSkeletonLayout,
  SettingsRowStateLine,
  SettingsRowUsage,
  SettingsSection,
  SettingsSectionsSkeleton,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Tooltip,
  type UsageMeterRow,
  useConfirmDialog,
  useMenu,
} from "@repo/ui";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useAsyncAction } from "@repo/ui/use-async-action";
import { type InlineRename, type RenameWrite, useInlineRename } from "@repo/ui/use-inline-rename";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { useConfirmAct } from "../confirm-act.js";
import { copyThroughShell } from "../copy-feedback.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { useRowDrag } from "../desktop/use-row-drag.js";
import { confirmFailure, refusedShown } from "../failure-report.js";
import { HarnessMark } from "../harness-marks.js";
import { providerKeysQuery, providerKeysRetryMutation } from "../live-reads.js";
import { type PlanUsageMeters, planUsageMeters } from "../plan-usage.js";
import { renameWrite } from "../rename-write.js";
import { ResetCreditCard, useResetCreditOffer } from "../reset-credit.js";
import { useOpenLink } from "../tasks/use-open-link.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { appStateQuery, selectAccount } from "../use-app-state.js";
import { ChatGptDeviceLogin } from "./chatgpt-device-login.js";
import { ReadFailed } from "./marks.js";

/**
 * agent-auth-section.tsx -- the agents' credentials, Settings › Agents' and setup's Connect an agent alike: a card each for Claude and Codex, its plans and its API key in the one order new turns try them, each added, replaced, renamed, reordered, and removed in place.
 *
 * The account holds as many plans per harness as it adds (Claude's
 * `claude setup-token`, or the Codex sign-in through ChatGPT), and as many
 * API keys. Each harness is a card of its own, opening on a header row: its
 * harness's mark and name, and Add, whose menu adds a plan or an API key.
 * Under it its plans and its keys stand in the account's order, each led
 * by its provider's logo and dragged up and down by its grip (`@repo/ui`'s
 * `SettingsOrderedRows`) or moved from its ⋯. A turn starts on the first
 * with room, a key having it unless its provider refused it for credit, which the
 * page's own line under its title says once for both
 * (`../desktop/desktop-settings.tsx`'s `pageDescription`). A plan is
 * named by the name the account gave it, renamed in place for a Claude
 * plan, whose token names no account; else by the ChatGPT account it signed
 * in as; else by its harness's plan name, numbered where there are several.
 * Under its name it says how much of its usage window it has used, with a
 * bar, or Ready before a turn has said, or that it is at its limit until
 * when, its bar full in the attention ink, or what is wrong with it in the
 * attention tint; and ends in a ⋯ holding Rename, Move up and down, Replace
 * token, and Disconnect, the fix its state asks for standing beside it:
 * Replace token for a Claude token Anthropic refused, Reconnect for a
 * Codex plan whose sign-in expired (Sign in again for one whose plan has no
 * Codex, since another account mends it). A ChatGPT plan's ⋯ also holds
 * Manage usage in ChatGPT, which opens ChatGPT's usage settings, and a plan
 * holding rate-limit reset credits offers one under its meters
 * (`reset-credit.tsx`). A key is named by the name the
 * account gave it, else API key and its hint, renamed in place as a Claude
 * plan is; says Ready, or what is wrong with it; and ends in a ⋯ holding
 * Rename, Move up and down, Replace key, and Remove key. With neither a plan nor a key, no agent
 * starts on that provider's models, since our key pays for no coding agent.
 * Calls and dictation run on the OpenAI API key alone, so every answer here
 * is handed to the window too (`../openai-key.tsx`), and removing that key
 * says they stop.
 *
 * Adding, Replace token, and Replace key open their steps under their own
 * row, one row at a time across both harnesses, the row's end turning into
 * Cancel, which puts them away as Escape in the field does, handing the
 * focus back to the press that opened them: a paste's two steps, getting
 * the secret and pasting it, or the Codex plan's device code
 * (`chatgpt-device-login.tsx`). Whatever is added joins the bottom of the
 * order, but a Codex plan signed in as a ChatGPT account the order holds
 * replaces that one. The steps go once their credential is kept.
 *
 * The service never answers a key or a token, so nothing here holds one but
 * what is being pasted: it stands in the open field alone, is sent once,
 * and is cleared as soon as the service keeps it. Every answer is the
 * account's credentials whole, which Settings hands to New agents' Model
 * row (`onKeys`) so its note follows a save at once, and setup reads for
 * whether either harness can start an agent (`onConnected`). The lists
 * stand under the mask mark, since a saved key's hint, a plan's email, its
 * name, and its usage are the account's.
 *
 * Disconnecting a plan or removing a key asks first, over the window
 * (`ConfirmDialog`).
 */

/** Where ChatGPT's usage settings are, which Manage usage opens as OpenAI's guidelines ask. */
const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

/** What a harness's section and rows are drawn from. */
interface Harness {
  /** What its header row names it. */
  readonly name: string;
  /** The mark its header row leads with. */
  readonly mark: ModelProvider;
  /** What its plan is called wherever a surface names the credential: its row's label, a disconnect's title. */
  readonly planName: string;
  readonly plan: SubscriptionKeySummary["kind"];
  /** The logo its plans' rows and its key's row lead with. */
  readonly planMark: React.JSX.Element;
  readonly keyName: string;
  readonly keyUrl: string;
  /** What the site a key is made on is called, which its link names. */
  readonly keySite: string;
  /** How a key of its begins, which its empty field shows. */
  readonly keyExample: string;
  readonly anchor: string;
}

/**
 * Each harness by the provider whose models it runs: its name, its plan's
 * name, kind, and logo, the provider's name on its key, where a key is
 * made, and the section a search or a remedy lands on.
 */
const HARNESS = {
  [PROVIDER_KEY_PROVIDER.ANTHROPIC]: {
    name: "Claude",
    mark: MODEL_PROVIDER.ANTHROPIC,
    planName: PLAN_NAME[PROVIDER_KEY_PROVIDER.ANTHROPIC],
    plan: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
    planMark: <ProviderMark provider={MARK_PROVIDER.CLAUDE} size={PROVIDER_MARK_SIZE.ROW} />,
    keyName: "Anthropic",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keySite: "Anthropic Console",
    keyExample: "sk-ant-api03-…",
    anchor: SETTINGS_SECTION.CLAUDE,
  },
  [PROVIDER_KEY_PROVIDER.OPENAI]: {
    name: "Codex",
    mark: MODEL_PROVIDER.OPENAI,
    planName: PLAN_NAME[PROVIDER_KEY_PROVIDER.OPENAI],
    plan: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
    planMark: (
      <SettingsRowMark>
        <HarnessMark provider={MODEL_PROVIDER.OPENAI} />
      </SettingsRowMark>
    ),
    keyName: "OpenAI",
    keyUrl: "https://platform.openai.com/api-keys",
    keySite: "OpenAI Platform",
    keyExample: "sk-proj-…",
    anchor: SETTINGS_SECTION.CODEX,
  },
} as const satisfies Record<ProviderKeyProvider, Harness>;

const HARNESSES: readonly ProviderKeyProvider[] = [
  PROVIDER_KEY_PROVIDER.ANTHROPIC,
  PROVIDER_KEY_PROVIDER.OPENAI,
];

/** The rows a harness's section draws with nothing connected: its header alone. */
const SECTION_ROWS = 1;

/** A credential's row while the keys are read: its mark, its name, and its press. */
const CREDENTIAL_ROW_SKELETON: SettingsRowSkeletonLayout = {
  described: false,
  mark: SETTINGS_ROW_MARK_WIDTH,
  controls: [SETTINGS_SKELETON_CONTROL.BUTTON],
};

const WORDS = {
  READ_FAILED: "Your keys could not be read.",
  SIGNED_OUT: SIGNED_OUT_WORDS,
  ADD: "Add",
  READY: "Ready",
  AT_LIMIT: "At its limit",
  BACK_AT: "back at",
  RENAME: "Rename",
  PLAN_NAME: "Plan name",
  KEY_NAME: "Key name",
  MOVE_UP: "Move up",
  MOVE_DOWN: "Move down",
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
  REMOVE_KEY: "Remove key",
  REMOVING: "Removing",
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
  REMOVE_KEY_FAILED: "Couldn't remove the key. Try again.",
  CLAUDE_DISCONNECT_FAILED: "Couldn't disconnect your Claude plan. Try again.",
  CHATGPT_DISCONNECT_FAILED: "Couldn't disconnect your Codex plan. Try again.",
  REORDER_FAILED: "Couldn't reorder. Try again.",
  RENAME_FAILED: "Couldn't rename it. Try again.",
} as const;

/** What a confirmed removal answers where it went. */
const ACCEPTED_KEY: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

/** What a confirmed removal answers where it did not go, by what it removed. */
const PLAN_DISCONNECT_REFUSED = {
  [PROVIDER_KEY_PROVIDER.ANTHROPIC]: {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: WORDS.CLAUDE_DISCONNECT_FAILED,
  },
  [PROVIDER_KEY_PROVIDER.OPENAI]: {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: WORDS.CHATGPT_DISCONNECT_FAILED,
  },
} as const satisfies Record<ProviderKeyProvider, ActionResult>;

const KEY_REMOVE_REFUSED: ActionResult = {
  status: ACTION_RESULT_STATUS.REJECTED,
  reason: WORDS.REMOVE_KEY_FAILED,
};

/** What disconnecting each harness's plan asks. */
const PLAN_DISCONNECT = {
  [PROVIDER_KEY_PROVIDER.ANTHROPIC]: {
    title: "Disconnect your Claude plan?",
    body: `Claude agents stop running on your Claude plan, and ${PRODUCT_NAME} deletes its token.`,
    verb: "Disconnect Claude plan",
    running: WORDS.DISCONNECTING,
    loss: CONFIRM_LOSS.IRREVERSIBLE,
  },
  [PROVIDER_KEY_PROVIDER.OPENAI]: {
    title: "Disconnect your Codex plan?",
    body: `Codex agents stop running on this plan, and ${PRODUCT_NAME} signs out of it.`,
    verb: "Disconnect Codex plan",
    running: WORDS.DISCONNECTING,
    loss: CONFIRM_LOSS.IRREVERSIBLE,
  },
} as const satisfies Record<ProviderKeyProvider, DialogQuestion>;

/* ----- Reading the credentials ----- */

/** The harness's plans among the account's subscriptions, in the account's order. */
function plansOf(
  answer: ProviderKeysAnswer,
  provider: ProviderKeyProvider,
): readonly SubscriptionKeySummary[] {
  return (answer.subscriptions ?? [])
    .filter((one) => one.kind === HARNESS[provider].plan)
    .toSorted((a, b) => a.position - b.position);
}

/** The provider's API keys among the account's keys. */
function keysOf(
  answer: ProviderKeysAnswer,
  provider: ProviderKeyProvider,
): readonly ProviderKeySummary[] {
  return answer.keys.filter((one) => one.provider === provider);
}

/** Whether a stored plan still stands: kept, answered, or only waiting on its limit to reset. */
function standing(plan: SubscriptionKeySummary): boolean {
  return (
    plan.status === PROVIDER_KEY_STATUS.UNVERIFIED ||
    plan.status === PROVIDER_KEY_STATUS.VERIFIED ||
    plan.status === PROVIDER_KEY_STATUS.LIMIT_REACHED
  );
}

/** Whether a stored key is one its provider has not refused. */
function keyStanding(status: ProviderKeyStatus): boolean {
  return status === PROVIDER_KEY_STATUS.VERIFIED || status === PROVIDER_KEY_STATUS.UNVERIFIED;
}

/** Whether the harness can start an agent now: a plan short of its limit, or a key that stands. */
function harnessReady(answer: ProviderKeysAnswer, provider: ProviderKeyProvider): boolean {
  return (
    plansOf(answer, provider).some(
      (plan) => standing(plan) && plan.status !== PROVIDER_KEY_STATUS.LIMIT_REACHED,
    ) || keysOf(answer, provider).some((key) => keyStanding(key.status))
  );
}

/* ----- What a credential says ----- */

/** A reached limit's words, with when it resets where the provider named it: "At its limit · back at 3:40 PM". */
function limitWords(plan: SubscriptionKeySummary, now: number): string {
  return plan.limitResetsAt === undefined
    ? WORDS.AT_LIMIT
    : `${WORDS.AT_LIMIT}, ${WORDS.BACK_AT} ${dueText(plan.limitResetsAt, now)}`;
}

/** What a Claude token that does not stand says. */
function tokenWords(plan: SubscriptionKeySummary): string {
  switch (plan.status) {
    case PROVIDER_KEY_STATUS.QUOTA_EXCEEDED:
      return WORDS.TOKEN_QUOTA;
    case PROVIDER_KEY_STATUS.UNREADABLE:
      return WORDS.TOKEN_UNREADABLE;
    default:
      return WORDS.TOKEN_INVALID;
  }
}

/** What a Codex sign-in that does not stand says. */
function signInWords(plan: SubscriptionKeySummary): string {
  switch (plan.status) {
    case PROVIDER_KEY_STATUS.UNREADABLE:
      return WORDS.CHATGPT_UNREADABLE;
    case PROVIDER_KEY_STATUS.INELIGIBLE:
      return WORDS.CHATGPT_INELIGIBLE;
    default:
      return WORDS.CHATGPT_EXPIRED;
  }
}

/** What mends a Codex sign-in that does not stand: Sign in again as another account where the plan has no Codex, else Reconnect. */
function signInFix(plan: SubscriptionKeySummary): string {
  return plan.status === PROVIDER_KEY_STATUS.INELIGIBLE ? WORDS.SIGN_IN_AGAIN : WORDS.RECONNECT;
}

/**
 * A plan's line under its name: its words, whether they need a hand, and
 * under them its usage, each window's meter where its usage is known
 * (`usage`), else one full bar at its limit (`meter`). A plan with room
 * whose usage is known says no words, since its meters say it.
 */
interface PlanLine {
  readonly words?: string;
  readonly ok: boolean;
  readonly usage?: PlanUsageMeters;
  readonly meter?: { readonly value: number; readonly tone: ProgressTone };
}

/** What a plan's line says, by its harness: its usage with room, its limit, or what is wrong with it. */
function planLine(
  provider: ProviderKeyProvider,
  plan: SubscriptionKeySummary,
  now: number,
): PlanLine {
  const usage = planUsageMeters(plan, now);

  if (plan.status === PROVIDER_KEY_STATUS.LIMIT_REACHED) {
    return {
      words: limitWords(plan, now),
      ok: false,
      ...(usage === undefined
        ? { meter: { value: 100, tone: PROGRESS_TONE.ATTENTION } }
        : { usage }),
    };
  }

  if (standing(plan))
    return usage === undefined ? { words: WORDS.READY, ok: true } : { ok: true, usage };
  const words = provider === PROVIDER_KEY_PROVIDER.ANTHROPIC ? tokenWords(plan) : signInWords(plan);

  return { words, ok: false };
}

/** What an API key's line says, by the provider it names: Ready, its hint where its name hides it, or what is wrong with it. */
function keyLineWords(provider: ProviderKeyProvider, key: ProviderKeySummary): string {
  const name = HARNESS[provider].keyName;

  switch (key.status) {
    case PROVIDER_KEY_STATUS.VERIFIED:
    case PROVIDER_KEY_STATUS.UNVERIFIED:
      return key.label === undefined ? WORDS.READY : `${WORDS.API_KEY} · ${key.hint}`;
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
function keyRejectionWords(provider: ProviderKeyProvider, rejection: ProviderKeyRejection): string {
  const name = HARNESS[provider].keyName;

  switch (rejection) {
    case PROVIDER_KEY_REJECTION.INVALID:
      return `${name} didn't accept this key. Check it and try again.`;
    case PROVIDER_KEY_REJECTION.WRONG_PROVIDER: {
      const other =
        provider === PROVIDER_KEY_PROVIDER.ANTHROPIC
          ? PROVIDER_KEY_PROVIDER.OPENAI
          : PROVIDER_KEY_PROVIDER.ANTHROPIC;

      return `This looks like an ${HARNESS[other].keyName} key. Paste it under ${HARNESS[other].name}.`;
    }

    case PROVIDER_KEY_REJECTION.UNREACHABLE:
      return `Couldn't reach ${name} to check this key. Try again.`;
    case PROVIDER_KEY_REJECTION.TOO_MANY_TRIES:
      return "Too many tries in the last hour. Try again later.";
  }
}

/** Why a Claude token's save kept nothing. */
function tokenRejectionWords(rejection: ProviderKeyRejection): string {
  return rejection === PROVIDER_KEY_REJECTION.TOO_MANY_TRIES
    ? "Too many tries in the last hour. Try again later."
    : "That isn't a Claude setup-token. Run claude setup-token and paste what it prints.";
}

/** What removing a provider's key asks. */
function keyRemovalQuestion(provider: ProviderKeyProvider): DialogQuestion {
  const harness = HARNESS[provider];
  const name = harness.keyName;

  return {
    title: `Remove your ${name} ${WORDS.API_KEY}?`,
    body:
      provider === PROVIDER_KEY_PROVIDER.OPENAI
        ? `Agents on ${name} models won't start without a ${harness.planName}. Calls and dictation will be off.`
        : `Agents on ${name} models won't start without a ${harness.planName}.`,
    verb: WORDS.REMOVE_KEY,
    running: WORDS.REMOVING,
    loss: CONFIRM_LOSS.IRREVERSIBLE,
  };
}

/* ----- Small parts ----- */

/** How a credential stands, plain or in the attention tint, announced where it needs a hand. */
function State({ ok, children }: { ok: boolean; children: string }): React.JSX.Element {
  useAnnounceShown(ANNOUNCE.ALERT, ok ? "" : children);

  return (
    <SettingsRowStateLine state={ok ? SETTINGS_ROW_STATE.PLAIN : SETTINGS_ROW_STATE.ATTENTION}>
      {children}
    </SettingsRowStateLine>
  );
}

/** A removal's question over the window, worded from fixed tables, so a screen recording shows it as it reads. */
function RemovalQuestion({
  confirm,
  question,
}: {
  confirm: DialogConfirm;
  question: DialogQuestion;
}): React.JSX.Element {
  return <ConfirmDialog open confirm={confirm} question={{ ...question, replayUnmasked: true }} />;
}

/** Where a provider's keys are made, named for the site and opened through the window's own link door. */
function GetKeyLink({
  provider,
  onOpened,
}: {
  provider: ProviderKeyProvider;
  onOpened: () => void;
}): React.JSX.Element {
  const openLink = useOpenLink();
  const { keyUrl, keySite } = HARNESS[provider];

  return (
    <OutsideLink href={keyUrl} open={openLink} onOpened={onOpened}>
      {`Open ${keySite}`}
    </OutsideLink>
  );
}

/** A credential row's ⋯ and the menu it opens, its acts in groups with a rule between each. */
function CredentialMenu({
  thing,
  groups,
  door,
}: {
  /** The credential it acts on, which names the ⋯ and its menu. */
  thing: string;
  groups: readonly (readonly MenuAction[])[];
  /** The ⋯, which a closing row's steps hand the focus back to. */
  door: React.RefObject<HTMLButtonElement | null>;
}): React.JSX.Element {
  const menu = useMenu(true);

  return (
    <>
      <MoreButton ref={door} thing={thing} {...menu.trigger()} />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={moreLabel(thing)}
          menu={menu.drawn}
          groups={groups}
          replayUnmasked
          onClose={menu.close}
        />
      )}
    </>
  );
}

/* ----- A pasted secret ----- */

/** A pasted secret's form as its steps hold it: the words in it, the save under way, and why the last one kept nothing. */
interface PastedSecret {
  readonly pasted: string;
  readonly saving: boolean;
  readonly rejection: string | undefined;
  readonly change: (value: string) => void;
  readonly save: () => void;
  /** Saves what a paste left in the field, as it lands. */
  readonly paste: (value: string) => void;
}

/**
 * A pasted secret's save, a Claude token's and an API key's alike: it sends
 * the paste once, trimmed, clears it as soon as the service keeps it, and
 * tells its owner (`onKept`); a refusal stands under the field saying why,
 * the paste kept. A paste no key could be is refused as the provider's
 * invalid one, unsent.
 */
function usePastedSecret({
  payload,
  failed,
  refused,
  onKept,
}: {
  payload: (key: string) => PortActPayload<typeof ACT_KIND.PROVIDER_KEYS_SAVE>;
  /** What a save the service never answered says. */
  failed: string;
  refused: (rejection: ProviderKeyRejection) => string;
  onKept: () => void;
}): PastedSecret {
  const { mutateAsync: sendProviderKeysSave } = useMutation(
    actMutation(ACT_KIND.PROVIDER_KEYS_SAVE),
  );

  const [pasted, setPasted] = useState("");
  const saving = useAsyncAction(() => failed);

  const save = (value = pasted) => {
    const key = value.trim();

    if (key === "" || saving.running) return;

    if (!pastedKeyFits(key)) {
      saving.refuse(refused(PROVIDER_KEY_REJECTION.INVALID));

      return;
    }

    void saving.run(() =>
      sendProviderKeysSave(payload(key)).then((answer) => {
        if ("failure" in answer) return failed;

        if (answer.rejected !== undefined) return refused(answer.rejected);
        // Kept: the secret leaves the field, and the row draws the service's word for it.
        setPasted("");
        onKept();

        return undefined;
      }),
    );
  };

  return {
    pasted,
    saving: saving.running,
    rejection: saving.refusal,
    change: (value) => {
      setPasted(value);
      saving.clear();
    },
    save: () => save(),
    paste: (value) => save(value),
  };
}

/** A setup-token's first step: its command, copied to run in a terminal. */
const SETUP_TOKEN_FIRST: PasteFirstStep = {
  title: WORDS.RUN_SETUP_TOKEN,
  body: (done) => (
    <CopyField
      label={WORDS.SETUP_TOKEN_COMMAND_LABEL}
      value={WORDS.SETUP_TOKEN_COMMAND}
      what={WORDS.COMMAND}
      copy={(text) => copyThroughShell(text).then(done)}
      width={COPY_FIELD_WIDTH.FULL}
      prompt={COPY_FIELD_PROMPT.SHELL}
    />
  ),
};

/** An API key's first step: the provider's site, opened to make one. */
function keyFirst(provider: ProviderKeyProvider): PasteFirstStep {
  return {
    title: WORDS.CREATE_KEY,
    body: (done) => <GetKeyLink provider={provider} onOpened={done} />,
  };
}

/** What a paste's steps save, by the credential they stand under. */
interface PasteKind {
  readonly first: PasteFirstStep;
  /** What the field is called, which says what to paste. */
  readonly label: string;
  readonly placeholder: string;
  readonly running: string;
  readonly payload: (key: string) => PortActPayload<typeof ACT_KIND.PROVIDER_KEYS_SAVE>;
  readonly failed: string;
  readonly refused: (rejection: ProviderKeyRejection) => string;
}

/** Where a pasted Claude token lands: on the plan of this id, or added at the bottom of the account's order. */
type TokenPlacement = { readonly subscriptionId: string } | { readonly add: true };

const ADD_TOKEN: TokenPlacement = { add: true };

/** Claude's setup-token, pasted as a plan where `placement` says. */
function setupTokenPaste(placement: TokenPlacement): PasteKind {
  return {
    first: SETUP_TOKEN_FIRST,
    label: WORDS.PASTE_TOKEN,
    placeholder: WORDS.TOKEN_EXAMPLE,
    running: WORDS.SAVING_TOKEN,
    payload: (key) => ({
      provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
      kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
      key,
      ...placement,
    }),
    failed: WORDS.SAVE_TOKEN_FAILED,
    refused: tokenRejectionWords,
  };
}

/** An API key of the provider's, pasted: added at the bottom of the order, or in place of the key `replacing` names. */
function keyPaste(provider: ProviderKeyProvider, replacing?: string): PasteKind {
  return {
    first: keyFirst(provider),
    label: WORDS.PASTE_KEY,
    placeholder: HARNESS[provider].keyExample,
    running: WORDS.CHECKING_KEY,
    payload: (key) => ({
      provider,
      key,
      ...(replacing === undefined ? undefined : { subscriptionId: replacing }),
    }),
    failed: WORDS.SAVE_KEY_FAILED,
    refused: (rejection) => keyRejectionWords(provider, rejection),
  };
}

/**
 * A pasted secret's steps, every credential's alike: getting the secret,
 * which checks off once its command is copied or its link opened, then the
 * field, which takes the focus as the steps open, a paste saving as it
 * lands and Enter what was typed. Escape puts them away, as the row's
 * Cancel does.
 */
function CredentialPasteSteps({
  kind,
  held,
  onKept,
  onEscape,
}: {
  kind: PasteKind;
  /** Whether a secret is already held, which the empty field says in its place. */
  held: boolean;
  onKept: () => void;
  onEscape: () => void;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement | null>(null);

  const secret = usePastedSecret({
    payload: kind.payload,
    failed: kind.failed,
    refused: kind.refused,
    onKept,
  });

  useEffect(() => field.current?.focus(), []);

  return (
    <PasteSteps
      first={kind.first}
      fieldRef={field}
      label={kind.label}
      placeholder={kind.placeholder}
      saved={held}
      busy={secret.saving}
      busyWords={kind.running}
      error={refusedShown(secret.rejection, FAILURE_SURFACE.AGENT_KEY_SAVE)}
      value={secret.pasted}
      onChange={secret.change}
      onSave={secret.paste}
      onEscape={onEscape}
    />
  );
}

/* ----- Removing a credential ----- */

/**
 * A plan's Disconnect, asked first; a ChatGPT sign-out OpenAI did not
 * confirm is told to the harness (`onUnconfirmed`), which says so under its
 * list afterward, since the plan's own row goes with it.
 */
function usePlanRemoval(
  provider: ProviderKeyProvider,
  plan: SubscriptionKeySummary,
  onUnconfirmed: (unconfirmed: boolean) => void,
): DialogConfirm {
  const { mutateAsync: sendProviderKeysRemove, ...keyRemoving } = useMutation(
    actMutation(ACT_KIND.PROVIDER_KEYS_REMOVE),
  );

  const refused = PLAN_DISCONNECT_REFUSED[provider];

  const disconnect = useCallback(
    (): Promise<ActionResult> =>
      sendProviderKeysRemove({ provider, kind: plan.kind, subscriptionId: plan.id })
        .catch(() => undefined)
        .then((removed): ActionResult => {
          if (removed === undefined || "failure" in removed) return refused;
          onUnconfirmed(removed.revocationUnconfirmed === true);

          return ACCEPTED_KEY;
        }),
    [sendProviderKeysRemove, onUnconfirmed, provider, plan.kind, plan.id, refused],
  );

  const removalAct = useConfirmAct(keyRemoving, {
    send: disconnect,
    answered: (removed): ActionResult => ("failure" in removed ? refused : ACCEPTED_KEY),
    failed: () => refused,
  });

  return useConfirmDialog(
    { subject: true, surfaceOpen: true },
    removalAct,
    confirmFailure(FAILURE_SURFACE.AGENT_KEY_REMOVE),
  );
}

/** One of the provider's API keys' Remove, by its id, asked first. */
function useKeyRemoval(provider: ProviderKeyProvider, key: ProviderKeySummary): DialogConfirm {
  const { mutateAsync: sendProviderKeysRemove, ...keyRemoving } = useMutation(
    actMutation(ACT_KIND.PROVIDER_KEYS_REMOVE),
  );

  const keyId = key.id;

  const remove = useCallback(
    (): Promise<ActionResult> =>
      sendProviderKeysRemove({
        provider,
        ...(keyId === undefined ? undefined : { subscriptionId: keyId }),
      })
        .catch(() => undefined)
        .then((answer): ActionResult => {
          if (answer === undefined || "failure" in answer) return KEY_REMOVE_REFUSED;

          return ACCEPTED_KEY;
        }),
    [sendProviderKeysRemove, provider, keyId],
  );

  const removalAct = useConfirmAct(keyRemoving, {
    send: remove,
    answered: (answer): ActionResult => ("failure" in answer ? KEY_REMOVE_REFUSED : ACCEPTED_KEY),
    failed: () => KEY_REMOVE_REFUSED,
  });

  return useConfirmDialog(
    { subject: true, surfaceOpen: true },
    removalAct,
    confirmFailure(FAILURE_SURFACE.AGENT_KEY_REMOVE),
  );
}

/* ----- Ordering and naming the credentials ----- */

/** One row of a harness's order: one of its plans, or one of its API keys. */
type Credential =
  | { readonly plan: SubscriptionKeySummary; readonly id: string }
  | { readonly key: ProviderKeySummary; readonly id: string };

/** Where a credential stands in the order; a key from a service that names no place stands last, where it paid before. */
function placeOf(credential: Credential): number {
  return "plan" in credential
    ? credential.plan.position
    : (credential.key.position ?? Number.POSITIVE_INFINITY);
}

/** What a key from a service that predates the order is told apart by among its harness's rows. */
const KEY_WITHOUT_ID = "api-key";

/** When a credential was added, which breaks a tie between two at one place as the service's payer choice does. */
function addedOf(credential: Credential): number {
  return "plan" in credential ? credential.plan.addedAt : credential.key.addedAt;
}

/** The harness's plans and its keys in the account's order: by place, then the earlier added, as a turn tries them. */
function credentialsOf(
  plans: readonly SubscriptionKeySummary[],
  keys: readonly ProviderKeySummary[],
): readonly Credential[] {
  // Note that a key from a service that names no id is still drawn; the order it is sent in names an id no row holds, which the service passes over.
  const keyed: Credential[] = keys.map((key) => ({ key, id: key.id ?? KEY_WITHOUT_ID }));

  return [...plans.map((plan) => ({ plan, id: plan.id })), ...keyed].toSorted(
    (a, b) => placeOf(a) - placeOf(b) || addedOf(a) - addedOf(b),
  );
}

type UseCredentialOrderResult = {
  ordered: readonly Credential[];
  move: (from: number, to: number) => void;
  refused: string | undefined;
};

/**
 * The harness's credentials in the order the account keeps, a reorder drawn
 * at once and sent as the whole order, its key's place among it; the list
 * rests on the order sent until the service answers, and says why under the
 * list where it was refused.
 */
function useCredentialOrder(
  provider: ProviderKeyProvider,
  credentials: readonly Credential[],
): UseCredentialOrderResult {
  const { mutateAsync: sendReorder } = useMutation(actMutation(ACT_KIND.SUBSCRIPTIONS_REORDER));
  const [sentOrder, setSentOrder] = useState<readonly string[] | undefined>(undefined);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const byId = new Map(credentials.map((credential) => [credential.id, credential]));

  // Note that a credential added or removed meanwhile is drawn where the service says, after those sent.
  const ordered =
    sentOrder === undefined
      ? credentials
      : [
          ...sentOrder.flatMap((id) => byId.get(id) ?? []),
          ...credentials.filter((credential) => !sentOrder.includes(credential.id)),
        ];

  const kind = HARNESS[provider].plan;

  const move = (from: number, to: number) => {
    const ids = ordered.map((credential) => credential.id);
    const [moved] = ids.splice(from, 1);

    if (moved === undefined || from === to) return;
    ids.splice(to, 0, moved);
    setSentOrder(ids);
    setRefused(undefined);
    void sendReorder({ provider, kind, subscriptionIds: ids })
      .catch(() => undefined)
      .then((answer) => {
        setSentOrder(undefined);

        if (answer === undefined || "failure" in answer) setRefused(WORDS.REORDER_FAILED);
      });
  };

  return { ordered, move, refused };
}

/**
 * The harness's renames, one row's at a time, each sent as the kind its
 * credential is; a refusal is the rename's own, apart from a reorder's, and
 * reopens the row's field over the name asked.
 */
function useCredentialRename(
  provider: ProviderKeyProvider,
  credentials: readonly Credential[],
): RenameWrite {
  const renaming = useMutation(actMutation(ACT_KIND.SUBSCRIPTION_RENAME));
  const plan = HARNESS[provider].plan;

  const plans = new Set(
    credentials.flatMap((credential) => ("plan" in credential ? [credential.id] : [])),
  );

  return renameWrite(renaming, {
    ask: (subscriptionId, label) => ({
      provider,
      kind: plans.has(subscriptionId) ? plan : PROVIDER_KEY_KIND.API_KEY,
      subscriptionId,
      label,
    }),
    // Note that a rename here always asks for a label; a cleared one, which only other callers send, reads as none.
    asked: ({ subscriptionId, label }) => ({ subjectId: subscriptionId, name: label ?? "" }),
    refused: (answer) => "failure" in answer,
  });
}

/** A row's Move up and Move down, where it has somewhere to go. */
function moveActions(
  at: number,
  count: number,
  onMove: (from: number, to: number) => void,
): readonly MenuAction[] {
  return [
    ...(at > 0 ? [{ label: WORDS.MOVE_UP, onSelect: () => onMove(at, at - 1) }] : []),
    ...(at < count - 1 ? [{ label: WORDS.MOVE_DOWN, onSelect: () => onMove(at, at + 1) }] : []),
  ];
}

/* ----- A harness's list ----- */

/** What a harness's steps stand open for: adding a plan or a key, or a row's own replace. */
const STEPS = {
  ADD: "add",
  REPLACE: "replace",
  KEY: "key",
} as const;

/** Which steps stand open, across both harnesses; a plan's own name the plan they stand under. */
type OpenSteps =
  | {
      readonly provider: ProviderKeyProvider;
      readonly steps: typeof STEPS.ADD | typeof STEPS.KEY;
    }
  | {
      readonly provider: ProviderKeyProvider;
      readonly steps: typeof STEPS.REPLACE;
      readonly subscriptionId: string;
    };

/** What a harness's rows open, without the harness, which the lists add. */
type HarnessSteps = OpenSteps extends infer Each
  ? Each extends OpenSteps
    ? Omit<Each, "provider">
    : never
  : never;

/** The row's end while its steps stand: Cancel, which puts them away. */
function CancelPress({ onCancel }: { onCancel: () => void }): React.JSX.Element {
  return (
    <Button variant={BUTTON_VARIANT.QUIET} onClick={onCancel}>
      {WORDS.CANCEL}
    </Button>
  );
}

/** The header's Add, whose menu adds the harness's plan or an API key; what it opens stands under the header. */
function AddPress({
  provider,
  press,
  onOpen,
}: {
  provider: ProviderKeyProvider;
  press: React.RefObject<HTMLButtonElement | null>;
  onOpen: (steps: typeof STEPS.ADD | typeof STEPS.KEY) => void;
}): React.JSX.Element {
  const harness = HARNESS[provider];
  const menu = useMenu(true);

  return (
    <>
      <Button
        ref={press}
        variant={BUTTON_VARIANT.OUTLINE}
        label={`${WORDS.ADD} to ${harness.name}`}
        {...menu.trigger()}
      >
        {WORDS.ADD}
      </Button>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={`${WORDS.ADD} to ${harness.name}`}
          menu={menu.drawn}
          groups={[
            [
              { label: harness.planName, onSelect: () => onOpen(STEPS.ADD) },
              { label: WORDS.API_KEY, onSelect: () => onOpen(STEPS.KEY) },
            ],
          ]}
          replayUnmasked
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** A set-up plan's fix beside its ⋯, where its state asks for one. */
function PlanFix({
  provider,
  plan,
  onOpen,
}: {
  provider: ProviderKeyProvider;
  plan: SubscriptionKeySummary;
  onOpen: () => void;
}): React.JSX.Element | null {
  const chatGpt = provider === PROVIDER_KEY_PROVIDER.OPENAI;

  if (standing(plan)) return null;

  return (
    <Button variant={BUTTON_VARIANT.OUTLINE} onClick={onOpen}>
      {chatGpt ? signInFix(plan) : WORDS.REPLACE_TOKEN}
    </Button>
  );
}

/** A plan's steps: a Claude token's paste, or a ChatGPT sign-in, which lands as a new plan unless it signs in as one the account holds. */
function PlanSteps({
  provider,
  placement,
  held,
  onDone,
}: {
  provider: ProviderKeyProvider;
  /** Where a pasted token lands: on the plan it replaces, or at the bottom of the order. */
  placement: TokenPlacement;
  held: boolean;
  onDone: () => void;
}): React.JSX.Element {
  return provider === PROVIDER_KEY_PROVIDER.ANTHROPIC ? (
    <CredentialPasteSteps
      kind={setupTokenPaste(placement)}
      held={held}
      onKept={onDone}
      onEscape={onDone}
    />
  ) : (
    <ChatGptDeviceLogin add onConnected={onDone} />
  );
}

/** A row's rename opened, the harness's other steps put away first, as opening any of them puts away the rest. */
function renameIn(rename: InlineRename, onClose: () => void): void {
  onClose();
  rename.begin();
}

/**
 * One plan's row in its harness's order: its logo, its name, renamed by
 * pressing it for a Claude plan (`RenamableName`), and its line, how much
 * of its window it has used with a bar under it, or how it stands; its fix where its state asks for
 * one, and a ⋯ holding Rename, Move up and down, Replace token, and
 * Disconnect. Its replace's steps open under it.
 */
function PlanRow({
  provider,
  plan,
  name,
  at,
  count,
  open,
  onOpen,
  onClose,
  onMove,
  renames,
  onUnconfirmed,
  alignWith,
}: {
  provider: ProviderKeyProvider;
  plan: SubscriptionKeySummary;
  name: string;
  /** Every plan's meter rows on the page, which its meters line up with. */
  alignWith: readonly UsageMeterRow[];
  at: number;
  count: number;
  open: typeof STEPS.REPLACE | undefined;
  onOpen: (steps: typeof STEPS.REPLACE) => void;
  onClose: () => void;
  onMove: (from: number, to: number) => void;
  /** The harness's renames, of which this row's is the one asked for its credential. */
  renames: RenameWrite;
  onUnconfirmed: (unconfirmed: boolean) => void;
}): React.JSX.Element {
  const harness = HARNESS[provider];
  const claude = provider === PROVIDER_KEY_PROVIDER.ANTHROPIC;
  const removal = usePlanRemoval(provider, plan, onUnconfirmed);
  const door = useRef<HTMLButtonElement | null>(null);
  const line = planLine(provider, plan, Date.now());
  const offer = useResetCreditOffer(claude ? undefined : plan);
  const rename = useInlineRename(plan.id, renames);
  const openLink = useOpenLink();

  const own = [
    ...(claude ? [{ label: WORDS.RENAME, onSelect: () => renameIn(rename, onClose) }] : []),
    ...moveActions(at, count, onMove),
    ...(claude ? [{ label: WORDS.REPLACE_TOKEN, onSelect: () => onOpen(STEPS.REPLACE) }] : []),
    ...(claude ? [] : [{ label: WORDS.MANAGE_USAGE, onSelect: () => openLink(CHATGPT_USAGE_URL) }]),
  ];

  return (
    <>
      <SettingsRow
        leading={harness.planMark}
        label={
          <RenamableName
            value={rename.asked ?? name}
            label={WORDS.PLAN_NAME}
            editing={rename.editing}
            onBegin={claude ? () => renameIn(rename, onClose) : undefined}
            maxLength={SUBSCRIPTION_LABEL_MAX_CHARS}
            onEnd={({ value }) => rename.end(value === name ? undefined : value)}
          />
        }
        description={
          <>
            {line.words === undefined ? null : <State ok={line.ok}>{line.words}</State>}
            {line.usage !== undefined ? (
              <SettingsRowUsage
                rows={line.usage.rows}
                heard={line.usage.heard}
                alignWith={alignWith}
              />
            ) : line.meter === undefined ? null : (
              <SettingsRowMeter value={line.meter.value} tone={line.meter.tone} />
            )}
            {offer === undefined ? null : (
              <SettingsRowAction>
                <Tooltip label={offer.words} card={<ResetCreditCard plan={plan} />}>
                  <Button
                    variant={BUTTON_VARIANT.OUTLINE}
                    size={BUTTON_SIZE.COMPACT}
                    busy={offer.busy}
                    busyLabel={WORDS.USING_RESET}
                    label={`${offer.words} on ${name}`}
                    onClick={offer.use}
                  >
                    {offer.words}
                  </Button>
                </Tooltip>
              </SettingsRowAction>
            )}
          </>
        }
        controls={SETTINGS_ROW_CONTROLS.BESIDE}
        end={() => (
          <CredentialMenu
            thing={name}
            door={door}
            groups={[
              ...(own.length === 0 ? [] : [own]),
              [{ label: WORDS.DISCONNECT, danger: true, onSelect: removal.ask }],
            ]}
          />
        )}
        below={
          open === STEPS.REPLACE
            ? () => (
                <PlanSteps
                  provider={provider}
                  placement={{ subscriptionId: plan.id }}
                  held
                  onDone={onClose}
                />
              )
            : undefined
        }
      >
        {() =>
          open === STEPS.REPLACE ? (
            <CancelPress onCancel={onClose} />
          ) : (
            <PlanFix provider={provider} plan={plan} onOpen={() => onOpen(STEPS.REPLACE)} />
          )
        }
      </SettingsRow>
      <RemovalQuestion confirm={removal} question={PLAN_DISCONNECT[provider]} />
      {offer?.dialog}
    </>
  );
}

/**
 * One of the harness's API keys' rows in the same order: its provider's
 * logo, its name, renamed by pressing it as a Claude plan's is, and Ready,
 * or what is wrong with it; Replace key beside a ⋯ where its provider refused it,
 * and a ⋯ holding Rename, Move up and down, Replace key, and Remove key.
 * Its replace's steps open under it.
 */
function KeyRow({
  provider,
  apiKey,
  at,
  count,
  open,
  onOpen,
  onClose,
  onMove,
  renames,
}: {
  provider: ProviderKeyProvider;
  apiKey: ProviderKeySummary;
  at: number;
  count: number;
  open: typeof STEPS.REPLACE | undefined;
  onOpen: (steps: typeof STEPS.REPLACE) => void;
  onClose: () => void;
  onMove: (from: number, to: number) => void;
  /** The harness's renames, of which this row's is the one asked for its credential. */
  renames: RenameWrite;
}): React.JSX.Element {
  const harness = HARNESS[provider];
  const removal = useKeyRemoval(provider, apiKey);
  const door = useRef<HTMLButtonElement | null>(null);
  const name = apiKeyName(apiKey);
  // Note that a key from a service that names no id has nothing to rename it or replace it by.
  const named = apiKey.id !== undefined;
  const rename = useInlineRename(apiKey.id, renames);
  const wasOpen = useRef(open);
  // The focus goes back to the ⋯ as its replace's steps go, wherever their going left it on nothing.
  useEffect(() => {
    const was = wasOpen.current;
    wasOpen.current = open;

    if (was !== STEPS.REPLACE || open !== undefined) return;
    const lost = document.activeElement === null || document.activeElement === document.body;

    if (lost) door.current?.focus();
  }, [open]);

  return (
    <>
      <SettingsRow
        leading={harness.planMark}
        label={
          <RenamableName
            value={rename.asked ?? name}
            label={WORDS.KEY_NAME}
            editing={rename.editing}
            onBegin={named ? () => renameIn(rename, onClose) : undefined}
            maxLength={SUBSCRIPTION_LABEL_MAX_CHARS}
            onEnd={({ value }) => rename.end(value === name ? undefined : value)}
          />
        }
        description={
          <State ok={keyStanding(apiKey.status)}>{keyLineWords(provider, apiKey)}</State>
        }
        controls={SETTINGS_ROW_CONTROLS.BESIDE}
        end={() => (
          <CredentialMenu
            thing={name}
            door={door}
            groups={[
              [
                ...(named
                  ? [{ label: WORDS.RENAME, onSelect: () => renameIn(rename, onClose) }]
                  : []),
                ...moveActions(at, count, onMove),
                { label: WORDS.REPLACE_KEY, onSelect: () => onOpen(STEPS.REPLACE) },
              ],
              [{ label: WORDS.REMOVE_KEY, danger: true, onSelect: removal.ask }],
            ]}
          />
        )}
        below={
          open === STEPS.REPLACE
            ? () => (
                <CredentialPasteSteps
                  kind={keyPaste(provider, apiKey.id)}
                  held
                  onKept={onClose}
                  onEscape={onClose}
                />
              )
            : undefined
        }
      >
        {() =>
          open === STEPS.REPLACE ? (
            <CancelPress onCancel={onClose} />
          ) : keyStanding(apiKey.status) ? null : (
            <Button variant={BUTTON_VARIANT.OUTLINE} onClick={() => onOpen(STEPS.REPLACE)}>
              {WORDS.REPLACE_KEY}
            </Button>
          )
        }
      </SettingsRow>
      <RemovalQuestion confirm={removal} question={keyRemovalQuestion(provider)} />
    </>
  );
}

/**
 * A harness's card: its header, whose Add adds a plan or a key, then its
 * plans and its keys in the order new turns try them, each dragged by its
 * grip or moved from its ⋯. Each row ends in its press, its steps opening
 * under it while `open` names it, an add's under the header. The focus goes
 * back to Add as an add's steps go.
 */
function HarnessCredentials({
  provider,
  answer,
  open,
  onOpen,
  onClose,
  aligned,
}: {
  provider: ProviderKeyProvider;
  answer: ProviderKeysAnswer;
  /** What every harness's card lines up with: whether one draws grips, and every plan's meters on the page. */
  aligned: PageAlignment;
  /** Which of this harness's steps stand open, if any. */
  open: HarnessSteps | undefined;
  onOpen: (steps: HarnessSteps) => void;
  onClose: () => void;
}): React.JSX.Element {
  const harness = HARNESS[provider];
  const plans = plansOf(answer, provider);
  const keys = keysOf(answer, provider);
  const credentials = credentialsOf(plans, keys);
  const order = useCredentialOrder(provider, credentials);
  const renames = useCredentialRename(provider, credentials);
  const drag = useRowDrag(order.move, { handle: SETTINGS_ORDER_HANDLE });
  const [unconfirmed, setUnconfirmed] = useState(false);
  const addPress = useRef<HTMLButtonElement | null>(null);
  const handBack = useRef<typeof STEPS.ADD | typeof STEPS.KEY | undefined>(undefined);
  const names = planNamesOf(provider, plans);
  const adding = open?.steps === STEPS.ADD || open?.steps === STEPS.KEY ? open.steps : undefined;

  // Note that the focus goes back to the row's press wherever the steps' going left it on nothing, and again once a credential they kept draws in its place, since the keys the host lays can land a draw after the steps go.
  useEffect(() => {
    const back = handBack.current;

    if (open !== undefined || back === undefined) return;
    const lost = document.activeElement === null || document.activeElement === document.body;

    if (lost) addPress.current?.focus();
  }, [open, plans.length, keys.length]);

  const close = (steps: typeof STEPS.ADD | typeof STEPS.KEY) => () => {
    handBack.current = steps;
    onClose();
  };

  const openSteps = (steps: typeof STEPS.ADD | typeof STEPS.KEY) => {
    handBack.current = undefined;

    if (steps === STEPS.ADD) setUnconfirmed(false);
    onOpen({ steps });
  };

  return (
    <SettingsSection anchor={harness.anchor}>
      <SettingsRow
        leading={
          <SettingsRowMark>
            <HarnessMark provider={harness.mark} />
          </SettingsRowMark>
        }
        label={harness.name}
        controls={SETTINGS_ROW_CONTROLS.BESIDE}
        below={
          adding === STEPS.ADD
            ? () => (
                <PlanSteps
                  provider={provider}
                  placement={ADD_TOKEN}
                  held={false}
                  onDone={close(STEPS.ADD)}
                />
              )
            : adding === STEPS.KEY
              ? () => (
                  <CredentialPasteSteps
                    kind={keyPaste(provider)}
                    held={false}
                    onKept={close(STEPS.KEY)}
                    onEscape={close(STEPS.KEY)}
                  />
                )
              : unconfirmed
                ? () => (
                    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                      {WORDS.REVOCATION_UNCONFIRMED}
                    </Text>
                  )
                : undefined
        }
      >
        {() =>
          adding === undefined ? (
            <AddPress provider={provider} press={addPress} onOpen={openSteps} />
          ) : (
            <CancelPress onCancel={close(adding)} />
          )
        }
      </SettingsRow>
      {order.ordered.length === 0 ? null : (
        <SettingsOrderedRows
          label={harness.name}
          onPointerDown={drag}
          gutter={aligned.gutter}
          rows={order.ordered.map((credential, at) => {
            const rowOpen =
              open !== undefined &&
              "subscriptionId" in open &&
              open.subscriptionId === credential.id
                ? open.steps
                : undefined;

            const onRowOpen = (steps: typeof STEPS.REPLACE) =>
              onOpen({ steps, subscriptionId: credential.id });

            return {
              key: credential.id,
              row:
                "plan" in credential ? (
                  <PlanRow
                    provider={provider}
                    plan={credential.plan}
                    name={names.get(credential.id) ?? harness.planName}
                    at={at}
                    count={order.ordered.length}
                    open={rowOpen}
                    onOpen={onRowOpen}
                    onClose={onClose}
                    onMove={order.move}
                    renames={renames}
                    onUnconfirmed={setUnconfirmed}
                    alignWith={aligned.meters}
                  />
                ) : (
                  <KeyRow
                    provider={provider}
                    apiKey={credential.key}
                    at={at}
                    count={order.ordered.length}
                    open={rowOpen}
                    onOpen={onRowOpen}
                    onClose={onClose}
                    onMove={order.move}
                    renames={renames}
                  />
                ),
            };
          })}
        />
      )}
      {order.refused === undefined ? null : (
        <SettingsLine>
          <State ok={false}>{order.refused}</State>
        </SettingsLine>
      )}
      {renames.refused ? (
        <SettingsLine>
          <State ok={false}>{WORDS.RENAME_FAILED}</State>
        </SettingsLine>
      ) : null}
    </SettingsSection>
  );
}

type UseCredentialsResult = {
  answer: ProviderKeysAnswer | undefined;
  readFailed: boolean;
  retry: () => void;
};

/* ----- The lists ----- */

/**
 * The account's credentials as the host holds them (`LIVE_READ.PROVIDER_KEYS`),
 * each write's own answer laid there, which New agents' Model row
 * (`onKeys`) and setup (`onConnected`) hear.
 */
function useCredentials({
  signedIn,
  onKeys,
  onConnected,
}: {
  signedIn: boolean;
  onKeys?: ((keys: readonly ProviderKeySummary[]) => void) | undefined;
  onConnected?: ((connected: boolean) => void) | undefined;
}): UseCredentialsResult {
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const keys = useQuery(providerKeysQuery(signedIn ? accountId : undefined));
  const retryKeys = useMutation(providerKeysRetryMutation());
  const answer = keys.data;
  const readFailed = keys.isError;

  // New agents' Model row hears every answer, so nothing there says what a key used to be.
  useEffect(() => {
    if (onKeys !== undefined && (answer !== undefined || readFailed)) onKeys(answer?.keys ?? []);
  }, [answer, readFailed, onKeys]);

  // Setup hears whether either harness can now start an agent.
  useEffect(() => {
    if (answer === undefined || onConnected === undefined) return;
    onConnected(HARNESSES.some((provider) => harnessReady(answer, provider)));
  }, [answer, onConnected]);

  return { answer, readFailed, retry: () => retryKeys.mutate() };
}

/**
 * Both harnesses' lists over the account's credentials read once and
 * changed in place, one credential's steps open at a time: signed out, a
 * read that failed, or the sections' skeleton while it is out.
 */
/** What every harness's card on the page lines up with. */
interface PageAlignment {
  /** Whether any card draws grips, so every card keeps their gutter and its marks stand in one column with theirs. */
  readonly gutter: boolean;
  /** Every plan's meter rows on the page, so each plan's meters line up with every other's as one table. */
  readonly meters: readonly UsageMeterRow[];
}

/** What the page's cards line up with, as the account's keys stand `now`. */
function pageAlignment(answer: ProviderKeysAnswer, now: number): PageAlignment {
  return {
    gutter: HARNESSES.some(
      (provider) => plansOf(answer, provider).length + keysOf(answer, provider).length > 1,
    ),
    meters: (answer.subscriptions ?? []).flatMap((plan) => planUsageMeters(plan, now)?.rows ?? []),
  };
}

function CredentialLists({
  signedIn,
  gap,
  onKeys,
  onConnected,
}: {
  signedIn: boolean;
  /** How far apart the harnesses' sections stand: a page's sections apart in Settings, a form's groups apart in setup. */
  gap: Gap;
  onKeys?: ((keys: readonly ProviderKeySummary[]) => void) | undefined;
  onConnected?: ((connected: boolean) => void) | undefined;
}): React.JSX.Element {
  const { answer, readFailed, retry } = useCredentials({ signedIn, onKeys, onConnected });
  const [open, setOpen] = useState<OpenSteps | undefined>(undefined);

  if (!signedIn) {
    return (
      <SettingsSection>
        <SettingsLine>{WORDS.SIGNED_OUT}</SettingsLine>
      </SettingsSection>
    );
  }

  if (answer === undefined) {
    return readFailed ? (
      <SettingsSection>
        <ReadFailed
          line={WORDS.READ_FAILED}
          surface={FAILURE_SURFACE.AGENT_KEYS_READ}
          onRetry={retry}
        />
      </SettingsSection>
    ) : (
      <SettingsSectionsSkeleton
        label={readingWords("your keys")}
        sections={HARNESSES.map(() => ({
          headed: false,
          rows: Array.from({ length: SECTION_ROWS }, () => CREDENTIAL_ROW_SKELETON),
        }))}
      />
    );
  }

  const aligned = pageAlignment(answer, Date.now());

  return (
    <ReplayMask>
      <Stack gap={gap}>
        {HARNESSES.map((provider) => (
          <HarnessCredentials
            key={provider}
            provider={provider}
            answer={answer}
            open={open?.provider === provider ? open : undefined}
            onOpen={(steps) => setOpen({ ...steps, provider })}
            onClose={() => setOpen(undefined)}
            aligned={aligned}
          />
        ))}
      </Stack>
    </ReplayMask>
  );
}

/** Settings › Agents' credentials, whose every answer New agents' Model row hears. */
export function AgentAuthSection({
  signedIn,
  onKeys,
}: {
  signedIn: boolean;
  /** The API keys as last read or changed, none where they could not be read; not called while the read is out. */
  onKeys: (keys: readonly ProviderKeySummary[]) => void;
}): React.JSX.Element {
  return <CredentialLists signedIn={signedIn} gap={GAP.PAGE} onKeys={onKeys} />;
}

/**
 * Setup's Connect an agent: the same lists; `onConnected` hears whether
 * either harness can start an agent, as each answer leaves them.
 */
export function AgentConnectSection({
  onConnected,
}: {
  onConnected: (connected: boolean) => void;
}): React.JSX.Element {
  return <CredentialLists signedIn gap={GAP.SECTION} onConnected={onConnected} />;
}
