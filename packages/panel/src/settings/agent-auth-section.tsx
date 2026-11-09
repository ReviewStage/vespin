import { signedInAccountId } from "@repo/credentials/snapshot";
import { INTEGRATION_STATUS_WORDS } from "@repo/features/integration-status-words";
import { INTEGRATION_STATUS } from "@repo/features/integration-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
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
  SUBSCRIPTION_LABEL_MAX_CHARS,
  type SubscriptionKeySummary,
} from "@repo/features/provider-key-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { dayAndTimeText } from "@repo/features/time-format";
import { readingWords, SIGNED_OUT_WORDS } from "@repo/features/words";
import { ACT_KIND } from "@repo/host/acts";
import type { PortActPayload } from "@repo/host/contract";
import { SETTINGS_SECTION } from "@repo/settings/settings-views";
import {
  ANNOUNCE,
  Badge,
  BUTTON_VARIANT,
  Button,
  ButtonLink,
  CONFIRM_LOSS,
  COPY_FIELD_PROMPT,
  COPY_FIELD_WIDTH,
  ConfirmDialog,
  CopyField,
  type DialogConfirm,
  type DialogQuestion,
  GAP,
  type Gap,
  GlyphSlot,
  INLINE_EDIT_LOOK,
  InlineEdit,
  LAYOUT_ELEMENT,
  MARK_PROVIDER,
  type MarkProvider,
  MoreButton,
  moreLabel,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  SETTINGS_ORDER_HANDLE,
  SETTINGS_ROW_CONTROLS,
  SETTINGS_ROW_MARK_WIDTH,
  SETTINGS_ROW_STATE,
  SETTINGS_SKELETON_CONTROL,
  SecretField,
  SettingsLine,
  SettingsOrderedRows,
  SettingsRow,
  type SettingsRowSkeletonShape,
  SettingsRowStateLine,
  SettingsSection,
  SettingsSectionsSkeleton,
  STATUS_TONE,
  STEP_STATE,
  Stack,
  Step,
  Steps,
  TEXT_LINK_LOOK,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextLink,
  useConfirmDialog,
  useMenu,
} from "@repo/ui";
import { GLYPH, ICON_SIZE } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { actMutation } from "../act-mutations.js";
import { useConfirmAct } from "../confirm-act.js";
import { copyThroughShell } from "../copy-feedback.js";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { useRowDrag } from "../desktop/use-row-drag.js";
import { confirmFailure, refusedShown } from "../failure-report.js";
import { providerKeysQuery, providerKeysRetryMutation } from "../live-reads.js";
import { linkPressOf, useOpenLink } from "../tasks/use-open-link.js";
import { useAnnounceShown } from "../use-announce-shown.js";
import { appStateQuery, selectAccount } from "../use-app-state.js";
import { ChatGptDeviceLogin } from "./chatgpt-device-login.js";
import { ReadFailed } from "./marks.js";

/**
 * agent-auth-section.tsx -- the agents' credentials, Settings › Agents' and setup's Connect an agent alike: a section each for Claude and Codex, its plans in the order new turns try them and its API key behind them, each set up, replaced, renamed, reordered, and removed in place.
 *
 * The account holds as many plans per harness as it adds (Claude's
 * `claude setup-token`, or the ChatGPT sign-in) and one API key. Each
 * harness is a section of its own, named for it: its plans first, in the
 * account's order, each led by its provider's logo and dragged up and down
 * by its grip (`@repo/ui`'s `SettingsOrderedRows`) or moved from its ⋯; then
 * a row to add another; then the key, led by a key, which pays once every
 * plan is at its limit. A turn starts on the first plan with room left, and
 * that one says In use. A plan is named by the name the account gave it,
 * renamed in place for a Claude plan, whose token names no account; else by
 * the ChatGPT account it signed in as; else by its harness's plan name,
 * numbered where there are several. Under its name it says Ready, or Limit
 * until when its limit resets, or what is wrong with it in the attention
 * tint, and ends in a ⋯ holding Rename, Move up and down, Replace token, and
 * Disconnect, the fix its state asks for standing beside it: Replace token
 * for a Claude token Anthropic refused, Sign in again for a ChatGPT plan
 * OpenAI signed out, and Manage usage, which opens ChatGPT's usage
 * settings, for one at its limit. With neither a plan nor a key, no agent
 * starts on that provider's models, since our key pays for no coding agent.
 * Calls and dictation run on the OpenAI API key alone, so every answer here
 * is handed to the window too (`../openai-key.tsx`), and removing that key
 * says they stop.
 *
 * Connect, Add key, and Replace open their steps under their own row, one
 * row at a time across both harnesses, the row's end turning into Cancel,
 * which puts them away as Escape in the field does, handing the focus back
 * to the press that opened them: a paste's two steps, getting the secret
 * and pasting it, or the ChatGPT plan's device code
 * (`chatgpt-device-login.tsx`). A plan connected from the add row joins the
 * bottom of the order, but one signed in as a ChatGPT account the order
 * holds replaces that one. The steps go once their credential is kept.
 *
 * The service never answers a key or a token, so nothing here holds one but
 * what is being pasted: it stands in the open field alone, is sent once,
 * and is cleared as soon as the service keeps it. Every answer is the
 * account's credentials whole, which Settings hands to the Default model
 * row (`onKeys`) so its note follows a save at once, and setup reads for
 * whether either harness can start an agent (`onConnected`). The lists
 * stand under the mask mark, since a saved key's hint, a plan's email, and
 * its name are the account's, and the field a secret is pasted into is
 * kept out of the screen recording, which masks a field's characters but
 * not their count.
 *
 * Disconnecting a plan or removing a key asks first, over the window
 * (`ConfirmDialog`).
 */

/** The class PostHog's recorder leaves out of a recording, element and children alike. */
const NO_CAPTURE = "ph-no-capture";

/** Where ChatGPT's usage settings are, which Manage usage opens as OpenAI's guidelines ask. */
const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

/** What a harness's section and rows are drawn from. */
interface Harness {
  readonly name: string;
  /** What its plan is called wherever a surface names the credential: its row's label, a disconnect's title. */
  readonly planName: string;
  readonly plan: SubscriptionKeySummary["kind"];
  /** The logo its plan's row leads with. */
  readonly planMark: MarkProvider;
  readonly keyName: string;
  readonly keyUrl: string;
  /** What the site a key is made on is called, which its link names. */
  readonly keySite: string;
  /** How a key of its begins, which its empty field shows. */
  readonly keyShape: string;
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
    planName: "Claude plan",
    plan: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
    planMark: MARK_PROVIDER.CLAUDE,
    keyName: "Anthropic",
    keyUrl: "https://console.anthropic.com/settings/keys",
    keySite: "Anthropic Console",
    keyShape: "sk-ant-api03-…",
    anchor: SETTINGS_SECTION.CLAUDE,
  },
  [PROVIDER_KEY_PROVIDER.OPENAI]: {
    name: "Codex",
    planName: "ChatGPT plan",
    plan: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
    planMark: MARK_PROVIDER.CHATGPT,
    keyName: "OpenAI",
    keyUrl: "https://platform.openai.com/api-keys",
    keySite: "OpenAI Platform",
    keyShape: "sk-proj-…",
    anchor: SETTINGS_SECTION.CODEX,
  },
} as const satisfies Record<ProviderKeyProvider, Harness>;

const HARNESSES: readonly ProviderKeyProvider[] = [
  PROVIDER_KEY_PROVIDER.ANTHROPIC,
  PROVIDER_KEY_PROVIDER.OPENAI,
];

/** The rows a harness's section draws with no plan connected: the plan's Connect and the key's. */
const SECTION_ROWS = 2;

/** A credential's row while the keys are read: its mark, its name, and its press. */
const CREDENTIAL_ROW_SKELETON: SettingsRowSkeletonShape = {
  described: false,
  mark: SETTINGS_ROW_MARK_WIDTH,
  controls: [SETTINGS_SKELETON_CONTROL.BUTTON],
};

const WORDS = {
  READ_FAILED: "Your keys could not be read.",
  SIGNED_OUT: SIGNED_OUT_WORDS,
  CONNECT: "Connect",
  ADD_ANOTHER: "Add another",
  ADD_KEY: "Add key",
  READY: "Ready",
  LIMIT_UNTIL: "Limit until",
  IN_USE: "In use",
  RENAME: "Rename",
  PLAN_NAME: "Plan name",
  MOVE_UP: "Move up",
  MOVE_DOWN: "Move down",
  ORDER_CAPTION:
    "Agents use your first plan with room left, then the next. Once every plan is at its limit, they use your API key.",
  KEY_FALLBACK: "Used once every plan is at its limit",
  SIGN_IN_AGAIN: "Sign in again",
  MANAGE_USAGE: "Manage usage",
  API_KEY: "API key",
  CANCEL: "Cancel",
  TOKEN_SHAPE: "sk-ant-oat01-…",
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
  CONNECTED: INTEGRATION_STATUS_WORDS[INTEGRATION_STATUS.CONNECTED],
  USAGE_LIMIT: "Usage limit reached",
  TOKEN_INVALID: "Anthropic rejected this token. Paste a new one.",
  TOKEN_QUOTA: "Out of usage on your Claude plan.",
  TOKEN_UNREADABLE: "This token can no longer be read. Paste a new one.",
  CHATGPT_SIGNED_OUT: "Signed out of ChatGPT.",
  CHATGPT_UNREADABLE: "This sign-in can no longer be read.",
  CHATGPT_INELIGIBLE:
    "OpenAI says this ChatGPT plan isn't eligible for Codex. Sign in again to use another.",
  REVOCATION_UNCONFIRMED: `${PRODUCT_NAME} signed out of ChatGPT, but OpenAI didn't confirm it ended. To end it there too, remove ${PRODUCT_NAME} in your ChatGPT settings.`,
  SAVE_TOKEN_FAILED: "Couldn't save the token. Try again.",
  SAVE_KEY_FAILED: "Couldn't save the key. Try again.",
  REMOVE_KEY_FAILED: "Couldn't remove the key. Try again.",
  CLAUDE_DISCONNECT_FAILED: "Couldn't disconnect your Claude plan. Try again.",
  CHATGPT_DISCONNECT_FAILED: "Couldn't disconnect your ChatGPT plan. Try again.",
  REORDER_FAILED: "Couldn't reorder your plans. Try again.",
  RENAME_FAILED: "Couldn't rename your plan. Try again.",
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
    title: "Disconnect your ChatGPT plan?",
    body: `Codex agents stop running on your ChatGPT plan, and ${PRODUCT_NAME} signs out of ChatGPT.`,
    verb: "Disconnect ChatGPT plan",
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

/** The provider's API key among the account's keys, or none. */
function keyOf(
  answer: ProviderKeysAnswer,
  provider: ProviderKeyProvider,
): ProviderKeySummary | undefined {
  return answer.keys.find((one) => one.provider === provider);
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
  const key = keyOf(answer, provider);
  return (
    plansOf(answer, provider).some(
      (plan) => standing(plan) && plan.status !== PROVIDER_KEY_STATUS.LIMIT_REACHED,
    ) ||
    (key !== undefined && keyStanding(key.status))
  );
}

/**
 * Each plan's name by its id: the name the account gave it, else the
 * ChatGPT account it signed in as, else its harness's plan name, numbered
 * by when it was added where the harness holds more than one, so a plan
 * keeps its number however it is reordered.
 */
function planNames(
  provider: ProviderKeyProvider,
  plans: readonly SubscriptionKeySummary[],
): ReadonlyMap<string, string> {
  const { planName } = HARNESS[provider];
  const added = plans.toSorted((a, b) => a.addedAt - b.addedAt);
  return new Map(
    added.map((plan, at) => [
      plan.id,
      plan.label ?? plan.email ?? (plans.length > 1 ? `${planName} ${at + 1}` : planName),
    ]),
  );
}

/* ----- What a credential says ----- */

/** A reached limit's words, with its reset where the provider named one. */
function limitWords(plan: SubscriptionKeySummary): string {
  return plan.limitResetsAt === undefined
    ? WORDS.USAGE_LIMIT
    : `${WORDS.LIMIT_UNTIL} ${dayAndTimeText(plan.limitResetsAt)}`;
}

/** What a Claude token's status says. */
function tokenWords(plan: SubscriptionKeySummary): string {
  switch (plan.status) {
    case PROVIDER_KEY_STATUS.UNVERIFIED:
    case PROVIDER_KEY_STATUS.VERIFIED:
      return WORDS.READY;
    case PROVIDER_KEY_STATUS.LIMIT_REACHED:
      return limitWords(plan);
    case PROVIDER_KEY_STATUS.QUOTA_EXCEEDED:
      return WORDS.TOKEN_QUOTA;
    case PROVIDER_KEY_STATUS.UNREADABLE:
      return WORDS.TOKEN_UNREADABLE;
    default:
      return WORDS.TOKEN_INVALID;
  }
}

/** What a ChatGPT sign-in's status says. */
function signInWords(plan: SubscriptionKeySummary): string {
  switch (plan.status) {
    case PROVIDER_KEY_STATUS.UNVERIFIED:
    case PROVIDER_KEY_STATUS.VERIFIED:
      return WORDS.READY;
    case PROVIDER_KEY_STATUS.LIMIT_REACHED:
      return limitWords(plan);
    case PROVIDER_KEY_STATUS.UNREADABLE:
      return WORDS.CHATGPT_UNREADABLE;
    case PROVIDER_KEY_STATUS.INELIGIBLE:
      return WORDS.CHATGPT_INELIGIBLE;
    default:
      return WORDS.CHATGPT_SIGNED_OUT;
  }
}

/** What a plan's status says, by its harness. */
function planWords(provider: ProviderKeyProvider, plan: SubscriptionKeySummary): string {
  return provider === PROVIDER_KEY_PROVIDER.ANTHROPIC ? tokenWords(plan) : signInWords(plan);
}

/** What an API key's status says, by the provider it names. */
function keyStatusWords(provider: ProviderKeyProvider, status: ProviderKeyStatus): string {
  const name = HARNESS[provider].keyName;
  switch (status) {
    case PROVIDER_KEY_STATUS.VERIFIED:
    case PROVIDER_KEY_STATUS.UNVERIFIED:
      return WORDS.CONNECTED;
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

/** How a credential stands, in the connected tint or the attention tint, announced where it needs a hand. */
function State({ ok, children }: { ok: boolean; children: string }): React.JSX.Element {
  useAnnounceShown(ANNOUNCE.ALERT, ok ? "" : children);
  return (
    <SettingsRowStateLine state={ok ? SETTINGS_ROW_STATE.CONNECTED : SETTINGS_ROW_STATE.ATTENTION}>
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
    <TextLink
      look={TEXT_LINK_LOOK.UNDERLINED}
      href={keyUrl}
      external
      onClick={(event) => {
        event.preventDefault();
        openLink(keyUrl);
        onOpened();
      }}
    >
      {`Open ${keySite}`}
    </TextLink>
  );
}

/** A credential row's ⋯ and the menu it opens. */
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
  const [saving, setSaving] = useState(false);
  const [rejection, setRejection] = useState<string | undefined>(undefined);

  const save = (value = pasted) => {
    const key = value.trim();
    if (key === "" || saving) return;
    if (!pastedKeyFits(key)) {
      setRejection(refused(PROVIDER_KEY_REJECTION.INVALID));
      return;
    }
    setSaving(true);
    setRejection(undefined);
    void sendProviderKeysSave(payload(key))
      .catch(() => undefined)
      .then((answer) => {
        setSaving(false);
        if (answer === undefined || "failure" in answer) {
          setRejection(failed);
          return;
        }
        if (answer.rejected !== undefined) {
          setRejection(refused(answer.rejected));
          return;
        }
        // Kept: the secret leaves the field, and the row draws the service's word for it.
        setPasted("");
        onKept();
      });
  };
  return {
    pasted,
    saving,
    rejection,
    change: (value) => {
      setPasted(value);
      setRejection(undefined);
    },
    save: () => save(),
    paste: (value) => save(value),
  };
}

/** A paste's first step: what to do, and what it needs, told once it is done. */
interface FirstStep {
  readonly title: string;
  readonly body: (done: () => void) => React.ReactNode;
}

/** A setup-token's first step: its command, copied to run in a terminal. */
const SETUP_TOKEN_FIRST: FirstStep = {
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
function keyFirst(provider: ProviderKeyProvider): FirstStep {
  return {
    title: WORDS.CREATE_KEY,
    body: (done) => <GetKeyLink provider={provider} onOpened={done} />,
  };
}

/** What a paste's steps save, by the credential they stand under. */
interface PasteKind {
  readonly first: FirstStep;
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
    placeholder: WORDS.TOKEN_SHAPE,
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

/** The provider's API key, pasted. */
function keyPaste(provider: ProviderKeyProvider): PasteKind {
  return {
    first: keyFirst(provider),
    label: WORDS.PASTE_KEY,
    placeholder: HARNESS[provider].keyShape,
    running: WORDS.CHECKING_KEY,
    payload: (key) => ({ provider, key }),
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
function PasteSteps({
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
  const [firstDone, setFirstDone] = useState(false);
  useEffect(() => field.current?.focus(), []);
  return (
    <Stack
      as={LAYOUT_ELEMENT.FORM}
      onSubmit={(event) => {
        event.preventDefault();
        secret.save();
      }}
    >
      <Steps>
        <Step
          number={1}
          title={kind.first.title}
          state={firstDone ? STEP_STATE.DONE : STEP_STATE.CURRENT}
        >
          {kind.first.body(() => setFirstDone(true))}
        </Step>
        <Step number={2} state={firstDone ? STEP_STATE.CURRENT : STEP_STATE.TO_DO}>
          <div className={NO_CAPTURE}>
            <SecretField
              ref={field}
              label={kind.label}
              description={secret.saving ? kind.running : undefined}
              error={refusedShown(secret.rejection, FAILURE_SURFACE.AGENT_KEY_SAVE)}
              saved={held}
              placeholder={kind.placeholder}
              disabled={secret.saving}
              value={secret.pasted}
              onEscape={onEscape}
              onChange={secret.change}
              onPasted={secret.paste}
            />
          </div>
        </Step>
      </Steps>
    </Stack>
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

/** The provider's API key's Remove, asked first. */
function useKeyRemoval(
  provider: ProviderKeyProvider,
  key: ProviderKeySummary | undefined,
): DialogConfirm {
  const { mutateAsync: sendProviderKeysRemove, ...keyRemoving } = useMutation(
    actMutation(ACT_KIND.PROVIDER_KEYS_REMOVE),
  );
  const remove = useCallback(
    (): Promise<ActionResult> =>
      sendProviderKeysRemove({ provider })
        .catch(() => undefined)
        .then((answer): ActionResult => {
          if (answer === undefined || "failure" in answer) return KEY_REMOVE_REFUSED;
          return ACCEPTED_KEY;
        }),
    [sendProviderKeysRemove, provider],
  );
  const removalAct = useConfirmAct(keyRemoving, {
    send: remove,
    answered: (answer): ActionResult => ("failure" in answer ? KEY_REMOVE_REFUSED : ACCEPTED_KEY),
    failed: () => KEY_REMOVE_REFUSED,
  });
  return useConfirmDialog(
    { subject: key !== undefined, surfaceOpen: true },
    removalAct,
    confirmFailure(FAILURE_SURFACE.AGENT_KEY_REMOVE),
  );
}

/* ----- Ordering and naming the plans ----- */

/**
 * The harness's plans in the order the account keeps, a reorder drawn at
 * once and sent as the whole order, and a rename sent as the row's; the
 * list rests on the order sent until the service answers, and says why
 * under the list where either was refused.
 */
function usePlanOrder(
  provider: ProviderKeyProvider,
  plans: readonly SubscriptionKeySummary[],
): {
  ordered: readonly SubscriptionKeySummary[];
  move: (from: number, to: number) => void;
  rename: (plan: SubscriptionKeySummary, label: string) => void;
  refused: string | undefined;
} {
  const { mutateAsync: sendReorder } = useMutation(actMutation(ACT_KIND.SUBSCRIPTIONS_REORDER));
  const { mutateAsync: sendRename } = useMutation(actMutation(ACT_KIND.SUBSCRIPTION_RENAME));
  const [sentOrder, setSentOrder] = useState<readonly string[] | undefined>(undefined);
  const [refused, setRefused] = useState<string | undefined>(undefined);
  const byId = new Map(plans.map((plan) => [plan.id, plan]));
  // Note that a plan added or removed meanwhile is drawn where the service says, after those sent.
  const ordered =
    sentOrder === undefined
      ? plans
      : [
          ...sentOrder.flatMap((id) => byId.get(id) ?? []),
          ...plans.filter((plan) => !sentOrder.includes(plan.id)),
        ];
  const kind = HARNESS[provider].plan;
  const move = (from: number, to: number) => {
    const ids = ordered.map((plan) => plan.id);
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
  const rename = (plan: SubscriptionKeySummary, label: string) => {
    setRefused(undefined);
    void sendRename({ provider, kind, subscriptionId: plan.id, label })
      .catch(() => undefined)
      .then((answer) => {
        if (answer === undefined || "failure" in answer) setRefused(WORDS.RENAME_FAILED);
      });
  };
  return { ordered, move, rename, refused };
}

/* ----- A harness's list ----- */

/** What a harness's steps stand open for: adding a plan, a plan's own replace or rename, or its key. */
const STEPS = {
  ADD: "add",
  REPLACE: "replace",
  RENAME: "rename",
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
      readonly steps: typeof STEPS.REPLACE | typeof STEPS.RENAME;
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

/** A credential not set up: its own press, which opens its steps. */
function SetUpPress({
  words,
  label,
  press,
  onOpen,
}: {
  words: string;
  /** Its accessible name, which says which credential it sets up. */
  label: string;
  press: React.RefObject<HTMLButtonElement | null>;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <Button ref={press} variant={BUTTON_VARIANT.OUTLINE} label={label} onClick={onOpen}>
      {words}
    </Button>
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
  const openLink = useOpenLink();
  const chatGpt = provider === PROVIDER_KEY_PROVIDER.OPENAI;
  if (chatGpt && plan.status === PROVIDER_KEY_STATUS.LIMIT_REACHED) {
    return (
      <ButtonLink
        href={CHATGPT_USAGE_URL}
        variant={BUTTON_VARIANT.OUTLINE}
        onClick={linkPressOf(openLink, CHATGPT_USAGE_URL)}
      >
        {WORDS.MANAGE_USAGE}
      </ButtonLink>
    );
  }
  if (standing(plan)) return null;
  return (
    <Button variant={BUTTON_VARIANT.OUTLINE} onClick={onOpen}>
      {chatGpt ? WORDS.SIGN_IN_AGAIN : WORDS.REPLACE_TOKEN}
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
    <PasteSteps kind={setupTokenPaste(placement)} held={held} onKept={onDone} onEscape={onDone} />
  ) : (
    <ChatGptDeviceLogin add onConnected={onDone} />
  );
}

/**
 * One plan's row in its harness's order: its logo, its name, renamed in
 * place for a Claude plan, how it stands, and In use on the one new turns
 * start on; its fix where its state asks for one, and a ⋯ holding Rename,
 * Move up and down, Replace token, and Disconnect. Its replace's steps open
 * under it.
 */
function PlanRow({
  provider,
  plan,
  name,
  inUse,
  at,
  count,
  open,
  onOpen,
  onClose,
  onMove,
  onRename,
  onUnconfirmed,
}: {
  provider: ProviderKeyProvider;
  plan: SubscriptionKeySummary;
  name: string;
  /** Whether new turns start on it: the first in the order that stands short of its limit. */
  inUse: boolean;
  at: number;
  count: number;
  open: typeof STEPS.REPLACE | typeof STEPS.RENAME | undefined;
  onOpen: (steps: typeof STEPS.REPLACE | typeof STEPS.RENAME) => void;
  onClose: () => void;
  onMove: (from: number, to: number) => void;
  onRename: (label: string) => void;
  onUnconfirmed: (unconfirmed: boolean) => void;
}): React.JSX.Element {
  const harness = HARNESS[provider];
  const claude = provider === PROVIDER_KEY_PROVIDER.ANTHROPIC;
  const removal = usePlanRemoval(provider, plan, onUnconfirmed);
  const door = useRef<HTMLButtonElement | null>(null);
  const ok = standing(plan) && plan.status !== PROVIDER_KEY_STATUS.LIMIT_REACHED;
  const renaming = open === STEPS.RENAME;
  return (
    <>
      <SettingsRow
        leading={<ProviderMark provider={harness.planMark} size={PROVIDER_MARK_SIZE.ROW} />}
        label={
          <InlineEdit
            value={name}
            label={WORDS.PLAN_NAME}
            editing={renaming}
            look={INLINE_EDIT_LOOK.INPUT}
            maxLength={SUBSCRIPTION_LABEL_MAX_CHARS}
            onEnd={({ value }) => {
              onClose();
              if (value !== undefined) onRename(value);
            }}
          />
        }
        adornment={inUse ? <Badge tone={STATUS_TONE.NEUTRAL}>{WORDS.IN_USE}</Badge> : undefined}
        description={<State ok={ok}>{planWords(provider, plan)}</State>}
        controls={SETTINGS_ROW_CONTROLS.BESIDE}
        end={() => (
          <CredentialMenu
            thing={name}
            door={door}
            groups={[
              [
                ...(claude ? [{ label: WORDS.RENAME, onSelect: () => onOpen(STEPS.RENAME) }] : []),
                ...(at > 0 ? [{ label: WORDS.MOVE_UP, onSelect: () => onMove(at, at - 1) }] : []),
                ...(at < count - 1
                  ? [{ label: WORDS.MOVE_DOWN, onSelect: () => onMove(at, at + 1) }]
                  : []),
                ...(claude
                  ? [{ label: WORDS.REPLACE_TOKEN, onSelect: () => onOpen(STEPS.REPLACE) }]
                  : []),
                { label: WORDS.DISCONNECT, danger: true, onSelect: removal.ask },
              ],
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
    </>
  );
}

/**
 * A harness's section: its plans in the order new turns try them, each
 * dragged by its grip or moved from its ⋯, a row to add another, and its
 * API key, which pays once every plan is at its limit. Each row ends in its
 * press, its steps opening under it while `open` names it. The focus goes
 * back to the add row's or the key's press as their steps go.
 */
function HarnessCredentials({
  provider,
  answer,
  open,
  onOpen,
  onClose,
}: {
  provider: ProviderKeyProvider;
  answer: ProviderKeysAnswer;
  /** Which of this harness's steps stand open, if any. */
  open: HarnessSteps | undefined;
  onOpen: (steps: HarnessSteps) => void;
  onClose: () => void;
}): React.JSX.Element {
  const harness = HARNESS[provider];
  const plans = plansOf(answer, provider);
  const key = keyOf(answer, provider);
  const order = usePlanOrder(provider, plans);
  const drag = useRowDrag(order.move, { handle: SETTINGS_ORDER_HANDLE });
  const keyRemoval = useKeyRemoval(provider, key);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const addPress = useRef<HTMLButtonElement | null>(null);
  const keyPress = useRef<HTMLButtonElement | null>(null);
  const handBack = useRef<typeof STEPS.ADD | typeof STEPS.KEY | undefined>(undefined);
  const keyName = `${harness.keyName} ${WORDS.API_KEY}`;
  const inUse = order.ordered.find(
    (plan) => standing(plan) && plan.status !== PROVIDER_KEY_STATUS.LIMIT_REACHED,
  );
  const names = planNames(provider, plans);

  // Note that the focus goes back to the row's press wherever the steps' going left it on nothing, and again once a credential they kept draws in its place, since the keys the host lays can land a draw after the steps go.
  const keyHeld = key !== undefined;
  useEffect(() => {
    const back = handBack.current;
    if (open !== undefined || back === undefined) return;
    const lost = document.activeElement === null || document.activeElement === document.body;
    if (lost) (back === STEPS.ADD ? addPress : keyPress).current?.focus();
  }, [open, plans.length, keyHeld]);
  const close = (steps: typeof STEPS.ADD | typeof STEPS.KEY) => () => {
    handBack.current = steps;
    onClose();
  };
  const openSteps = (steps: typeof STEPS.ADD | typeof STEPS.KEY) => () => {
    handBack.current = undefined;
    if (steps === STEPS.ADD) setUnconfirmed(false);
    onOpen({ steps });
  };
  const addWords =
    plans.length === 0 ? harness.planName : `${WORDS.ADD_ANOTHER} ${harness.planName}`;

  return (
    <>
      <SettingsSection
        title={harness.name}
        anchor={harness.anchor}
        caption={plans.length === 0 ? undefined : WORDS.ORDER_CAPTION}
      >
        {order.ordered.length === 0 ? null : (
          <SettingsOrderedRows
            label={`${harness.planName}s`}
            onPointerDown={drag}
            rows={order.ordered.map((plan, at) => ({
              key: plan.id,
              row: (
                <PlanRow
                  provider={provider}
                  plan={plan}
                  name={names.get(plan.id) ?? harness.planName}
                  inUse={plan.id === inUse?.id}
                  at={at}
                  count={order.ordered.length}
                  open={
                    open !== undefined &&
                    "subscriptionId" in open &&
                    open.subscriptionId === plan.id
                      ? open.steps
                      : undefined
                  }
                  onOpen={(steps) => onOpen({ steps, subscriptionId: plan.id })}
                  onClose={onClose}
                  onMove={order.move}
                  onRename={(label) => order.rename(plan, label)}
                  onUnconfirmed={setUnconfirmed}
                />
              ),
            }))}
          />
        )}
        <SettingsRow
          leading={
            <GlyphSlot size={ICON_SIZE.LARGE}>
              <GLYPH.ADD />
            </GlyphSlot>
          }
          label={addWords}
          controls={SETTINGS_ROW_CONTROLS.BESIDE}
          below={
            open?.steps === STEPS.ADD
              ? () => (
                  <PlanSteps
                    provider={provider}
                    placement={ADD_TOKEN}
                    held={false}
                    onDone={close(STEPS.ADD)}
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
            open?.steps === STEPS.ADD ? (
              <CancelPress onCancel={close(STEPS.ADD)} />
            ) : (
              <SetUpPress
                words={WORDS.CONNECT}
                label={`${WORDS.CONNECT} ${harness.planName}`}
                press={addPress}
                onOpen={openSteps(STEPS.ADD)}
              />
            )
          }
        </SettingsRow>
        <SettingsRow
          leading={
            <GlyphSlot size={ICON_SIZE.LARGE}>
              <GLYPH.API_KEY />
            </GlyphSlot>
          }
          label={keyName}
          description={
            key === undefined ? undefined : (
              <State ok={keyStanding(key.status)}>
                {plans.length === 0
                  ? keyStatusWords(provider, key.status)
                  : `${keyStatusWords(provider, key.status)} · ${WORDS.KEY_FALLBACK}`}
              </State>
            )
          }
          controls={SETTINGS_ROW_CONTROLS.BESIDE}
          end={
            key === undefined
              ? undefined
              : () => (
                  <CredentialMenu
                    thing={keyName}
                    door={keyPress}
                    groups={[
                      [
                        { label: WORDS.REPLACE_KEY, onSelect: openSteps(STEPS.KEY) },
                        { label: WORDS.REMOVE_KEY, danger: true, onSelect: keyRemoval.ask },
                      ],
                    ]}
                  />
                )
          }
          below={
            open?.steps === STEPS.KEY
              ? () => (
                  <PasteSteps
                    kind={keyPaste(provider)}
                    held={key !== undefined}
                    onKept={close(STEPS.KEY)}
                    onEscape={close(STEPS.KEY)}
                  />
                )
              : undefined
          }
        >
          {() =>
            open?.steps === STEPS.KEY ? (
              <CancelPress onCancel={close(STEPS.KEY)} />
            ) : key === undefined ? (
              <SetUpPress
                words={WORDS.ADD_KEY}
                label={`Add ${keyName}`}
                press={keyPress}
                onOpen={openSteps(STEPS.KEY)}
              />
            ) : keyStanding(key.status) ? null : (
              <Button variant={BUTTON_VARIANT.OUTLINE} onClick={openSteps(STEPS.KEY)}>
                {WORDS.REPLACE_KEY}
              </Button>
            )
          }
        </SettingsRow>
        {order.refused === undefined ? null : (
          <SettingsLine>
            <State ok={false}>{order.refused}</State>
          </SettingsLine>
        )}
      </SettingsSection>
      <RemovalQuestion confirm={keyRemoval} question={keyRemovalQuestion(provider)} />
    </>
  );
}

/* ----- The lists ----- */

/**
 * The account's credentials as the host holds them (`LIVE_READ.PROVIDER_KEYS`),
 * each write's own answer laid there, which the Default model row
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
}): { answer: ProviderKeysAnswer | undefined; readFailed: boolean; retry: () => void } {
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const keys = useQuery(providerKeysQuery(signedIn ? accountId : undefined));
  const retryKeys = useMutation(providerKeysRetryMutation());
  const answer = keys.data;
  const readFailed = keys.isError;

  // The Default model row hears every answer, so nothing there says what a key used to be.
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
          headed: true,
          rows: Array.from({ length: SECTION_ROWS }, () => CREDENTIAL_ROW_SKELETON),
        }))}
      />
    );
  }
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
          />
        ))}
      </Stack>
    </ReplayMask>
  );
}

/** Settings › Agents' credentials, whose every answer the Default model row hears. */
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
