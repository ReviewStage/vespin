import { signedInAccountId } from "@repo/credentials/snapshot";
import { AGENT_PAYER, type AgentPayer, type AgentUsage } from "@repo/features/agent-wire";
import type { ModelProvider } from "@repo/features/models-wire";
import type { SubscriptionKeySummary } from "@repo/features/provider-key-wire";
import {
  GLYPH_INK,
  GlyphSlot,
  type MenuLastLine,
  OutsideLink,
  USAGE_METERS_WIDTH,
  UsageMeters,
} from "@repo/ui";
import type { Actor } from "@repo/ui/actor-model";
import { ICON_SIZE, KeyRoundIcon, LaptopIcon } from "@repo/ui/icons";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useQuery } from "@tanstack/react-query";
import { ActorLine, ActorRef } from "../actor-ref.js";
import { HarnessMark } from "../harness-marks.js";
import { providerKeysQuery } from "../live-reads.js";
import { planUsageMeters } from "../plan-usage.js";
import { appStateQuery, selectAccount } from "../use-app-state.js";
import {
  agentPayerParts,
  PAYER_MARK,
  type PayerMark,
  type PayerParts,
  payerPlanOf,
  planNameOf,
} from "./agent-model.js";
import { useOpenLink } from "./use-open-link.js";

/**
 * agent-payer.tsx -- who pays for a coding agent, as one line: a mark, whose it is, and the plan or key.
 *
 * The line leads with a mark, as Capy's model picker does: the harness's own
 * mark for a plan, a key for an API key, and a laptop for a Mac's sign-in.
 * Then whose it is. The reader's own reads "Your Claude plan"; a teammate's,
 * whose plan or key every message to the agent spends whoever sends it, names
 * them by their person chip, "[Dean’s] Claude plan", so a teammate's agent
 * never reads as the reader's own. The app's own key names no one. The same
 * line closes the model chip's menu and the context popover. The reader's
 * own plan names itself after it where they hold several, "Your Codex plan
 * (ana@work.com)", which a screen recording masks, since it may be an email.
 *
 * An agent its starter's ChatGPT plan pays for ends the menu's line on
 * Manage usage, as OpenAI's UI guidelines ask
 * (developers.openai.com/siwc/ui-ux-guidelines), opening ChatGPT's usage
 * settings; a teammate's leaves it off, since the link opens the reader's
 * own ChatGPT account, not the plan that pays.
 */

/** Where OpenAI's guidelines send Manage usage: ChatGPT's own usage settings. */
const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";

/** The link at the menu line's end on an agent the reader's own ChatGPT plan pays for. */
const MANAGE_USAGE = "Manage usage";

/** Whose a payer is where it is the reader's own. */
const YOUR = "Your";

/** Manage usage, opening ChatGPT's usage settings. */
function ManageUsageLink(): React.JSX.Element {
  const openLink = useOpenLink();
  return (
    <OutsideLink href={CHATGPT_USAGE_URL} open={openLink}>
      {MANAGE_USAGE}
    </OutsideLink>
  );
}

/** The payer's mark: its plan's harness, a key, or a laptop. */
function PayerGlyph({
  mark,
  provider,
}: {
  mark: PayerMark;
  provider: ModelProvider | undefined;
}): React.JSX.Element {
  if (mark === PAYER_MARK.PLAN && provider !== undefined)
    return <HarnessMark provider={provider} />;
  if (mark === PAYER_MARK.MAC) return <LaptopIcon />;
  return <KeyRoundIcon />;
}

/** The payer's words after whose it is: "Your Claude plan", or the teammate's chip and "Claude plan". */
function PayerWords({
  parts,
  owner,
}: {
  parts: PayerParts;
  owner: Actor | undefined;
}): React.JSX.Element {
  if (!parts.owned) return <>{parts.words}</>;
  if (owner === undefined) return <>{`${YOUR} ${parts.words}`}</>;
  return (
    <ActorLine>
      <ReplayMask>
        <ActorRef actor={owner} possessive />
      </ReplayMask>
      {` ${parts.words}`}
    </ActorLine>
  );
}

/**
 * The reader's own plan that pays for the agent (`payerPlanOf`), read from
 * their keys: the subscription the page named, or, for one a new agent
 * would start on (`next`), the first with room left; none on a teammate's
 * agent (`owner`), whose own plan pays.
 */
export function usePayerPlan(
  payer: AgentPayer | undefined,
  subscriptionId: string | undefined,
  next: boolean,
  owner: Actor | undefined,
): SubscriptionKeySummary | undefined {
  // Note that a plan is read from the reader's own keys, so a teammate's agent reads none of its starter's, nor its usage.
  const accountId = signedInAccountId(useQuery({ ...appStateQuery, select: selectAccount }).data);
  const keys = useQuery(providerKeysQuery(accountId)).data;
  return payerPlanOf(payer, keys?.subscriptions, subscriptionId, next, owner !== undefined);
}

/**
 * The model menu's last line: who pays, its mark before it, with Manage
 * usage at its end where the reader's own ChatGPT plan does, and the plan's
 * usage under it where it is the reader's own (`plan`); nothing where no
 * payer is named. `owner` is the teammate who started the agent, none for
 * the reader's own.
 */
export function payerLastLine(
  payer: AgentPayer | undefined,
  provider: ModelProvider | undefined,
  usage: AgentUsage | undefined,
  owner: Actor | undefined,
  plan?: SubscriptionKeySummary | undefined,
): MenuLastLine | undefined {
  const parts = agentPayerParts(payer, provider, usage?.costUsd, planNameOf(plan));
  if (parts === undefined) return undefined;
  const meters = plan === undefined ? undefined : planUsageMeters(plan, Date.now());
  const line = {
    glyph: <PayerGlyph mark={parts.mark} provider={provider} />,
    words: <PayerWords parts={parts} owner={owner} />,
    masked: parts.masked,
    // Note that the meters stand under the line only where some usage was heard, so a plan with none keeps the line's own height.
    ...(meters === undefined
      ? undefined
      : {
          below: (
            <UsageMeters rows={meters.rows} heard={meters.heard} width={USAGE_METERS_WIDTH.FILL} />
          ),
        }),
  };
  return payer === AGENT_PAYER.CHATGPT_SUBSCRIPTION && owner === undefined
    ? { ...line, end: <ManageUsageLink /> }
    : line;
}

/** Who pays, as the context popover's last line draws it: the mark and the words, as the menu's line says them. */
export function PayerValue({
  payer,
  provider,
  usage,
  owner,
  planName,
}: {
  payer: AgentPayer;
  provider: ModelProvider | undefined;
  usage: AgentUsage | undefined;
  owner: Actor | undefined;
  /** The reader's own plan that pays, by its name (`payerPlanName`); none for a teammate's. */
  planName?: string | undefined;
}): React.JSX.Element | null {
  const parts = agentPayerParts(payer, provider, usage?.costUsd, planName);
  if (parts === undefined) return null;
  const words = <PayerWords parts={parts} owner={owner} />;
  return (
    <span className="inline-flex min-w-0 items-center gap-icon-gap">
      <GlyphSlot ink={GLYPH_INK.INHERIT} size={ICON_SIZE.SMALL}>
        <PayerGlyph mark={parts.mark} provider={provider} />
      </GlyphSlot>
      <span className="min-w-0">{parts.masked ? <ReplayMask>{words}</ReplayMask> : words}</span>
    </span>
  );
}
