/**
 * fixture-usage-limit-agent.ts -- the Inbox fixture's agent whose transcript holds each way a Codex agent meets its usage limit: moved on to its next payer, a worker stopped by it, stopped, and paused until a reset still to come, on a ChatGPT plan that holds reset credits.
 *
 * The Inbox fixture stages it on the rounding task, answering its page and
 * laying its transcript where the host holds one (`LIVE_READ.TRANSCRIPT`),
 * but lists it in no task's agents, so every list the fixture stages counts
 * as it did. Its plan stands among the account's keys only where a run asks
 * for it (`-resetCredits true` on the iOS app), so Settings › Agents reads
 * as it did everywhere else. Every word, name, and number here is invented.
 */

import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  AGENT_SENDER,
  AGENT_STATUS,
  type AgentSummary,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type SubscriptionKeySummary,
} from "@repo/features/provider-key-wire";
import { MESSAGE_ROLE, type WireRecord } from "@repo/wire";
import { USAGE_LIMIT_AGENT, USAGE_LIMIT_PART, type UsageLimitNotice } from "@repo/wire/ui-messages";
import type { AppTranscript } from "./app-state.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The agent's id, which a fixture run opens its page by (`-agent <id>`). */
export const FIXTURE_USAGE_LIMIT_AGENT_ID = "3b1f9c2e-6a4d-4e8b-9f17-2c5d8e0a7b43";

/** The agent's title, as its page names it in the bar. */
const TITLE = "Migrate the billing exports to Parquet";

/** The plan the agent ran out on first, and the key it went on with, as Settings names them. */
const PLAN_NAME = "ChatGPT Pro";

const KEY_NAME = "OpenAI API key";

/** The id of the ChatGPT plan the agent runs on, which its pause offers a reset credit on. */
const PLAN_ID = "b7e2a9d4-1c3f-4a6e-8d50-9f2b7c4e1a36";

/** The account's ChatGPT plan the agent runs on, holding two reset credits, the sooner expiring in a week, as a run that asks for it stages among the account's keys. */
export function fixtureResetPlan(now: number): SubscriptionKeySummary {
  return {
    provider: PROVIDER_KEY_PROVIDER.OPENAI,
    kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
    id: PLAN_ID,
    position: 0,
    label: PLAN_NAME,
    email: "ada@example.com",
    hint: "chatgpt…7f2c",
    addedAt: now - 30 * DAY,
    status: PROVIDER_KEY_STATUS.VERIFIED,
    statusAt: now - HOUR,
    forAgents: true,
    resetCredits: 2,
    resetCreditExpiries: [now + 7 * DAY, now + 21 * DAY],
  };
}

/** The usage limit's notice, as the harness left it. */
function limit(notice: Omit<UsageLimitNotice, "agent">): WireRecord {
  return { type: USAGE_LIMIT_PART, data: { agent: USAGE_LIMIT_AGENT.CODEX, ...notice } };
}

/** A finished command the agent ran. */
function ran(callId: string, command: string, stdout: string): WireRecord {
  return {
    type: `tool-${AGENT_TOOL.BASH}`,
    toolCallId: callId,
    state: "output-available",
    input: { command, description: command },
    output: { stdout, stderr: "", exitCode: 0 },
  };
}

/** A line `starter` sent, `at` epoch milliseconds. */
function said(
  id: string,
  at: number,
  text: string,
  starter: { readonly userId: string; readonly name: string },
): AgentTranscriptMessage {
  return {
    id,
    role: MESSAGE_ROLE.USER,
    parts: [{ type: "text", text }],
    sentAt: at,
    sentBy: { kind: AGENT_SENDER.MEMBER, userId: starter.userId, name: starter.name },
  };
}

/** The agent as its page reads it, from the fields `base` holds of any fixture agent: its own id and title, paused at its limit. */
export function fixtureUsageLimitAgent(base: AgentSummary): AgentSummary {
  return {
    ...base,
    id: FIXTURE_USAGE_LIMIT_AGENT_ID,
    title: TITLE,
    status: AGENT_STATUS.COMPLETED,
  };
}

/**
 * The agent's transcript, its instants counted from `startedAt`, its pause
 * resuming two hours after `now`: a first turn that moves from the plan to
 * the key, a second whose worker the limit stops, a third that stops at
 * the key's limit, and a last, on the plan again, paused until its reset.
 */
export function fixtureUsageLimitTranscript(
  startedAt: number,
  now: number,
  starter: { readonly userId: string; readonly name: string },
): AppTranscript {
  const messages: readonly AgentTranscriptMessage[] = [
    said(
      "fixture-usage-limit-ask",
      startedAt,
      "Move the nightly billing exports from CSV to Parquet.",
      starter,
    ),
    {
      id: "fixture-usage-limit-moved",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        { type: "step-start" },
        ran("fixture-usage-limit-list-run", "ls exports/", "invoices.csv\nledger.csv\npayouts.csv"),
        limit({ resetsAt: null, moved: { from: PLAN_NAME, to: KEY_NAME } }),
        { type: "text", text: "Three exports write CSV: invoices, ledger, and payouts." },
      ],
      startedAt: startedAt + MINUTE,
      finishedAt: startedAt + 9 * MINUTE,
    },
    said(
      "fixture-usage-limit-worker-ask",
      startedAt + 20 * MINUTE,
      "Have a worker check the ledger export's columns first.",
      starter,
    ),
    {
      id: "fixture-usage-limit-worker",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [
        { type: "step-start" },
        {
          type: `tool-${AGENT_TOOL.DELEGATE}`,
          toolCallId: "fixture-usage-limit-delegate",
          state: "output-available",
          input: {
            description: "Check the ledger columns",
            task: "List the ledger export's columns and the type each holds.",
          },
          output: {
            usageLimit: { agent: USAGE_LIMIT_AGENT.CODEX, resetsAt: null },
          },
        },
        { type: "text", text: "The worker stopped at the usage limit before it answered." },
      ],
      startedAt: startedAt + 20 * MINUTE,
      finishedAt: startedAt + 24 * MINUTE,
    },
    said(
      "fixture-usage-limit-stop-ask",
      startedAt + 40 * MINUTE,
      "Check the columns yourself, then.",
      starter,
    ),
    {
      id: "fixture-usage-limit-stopped",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [{ type: "step-start" }, limit({ resetsAt: null })],
      startedAt: startedAt + 40 * MINUTE,
      finishedAt: startedAt + 41 * MINUTE,
    },
    said("fixture-usage-limit-pause-ask", now - 30 * MINUTE, "Try again on the plan.", starter),
    {
      id: "fixture-usage-limit-paused",
      role: MESSAGE_ROLE.ASSISTANT,
      parts: [{ type: "step-start" }, limit({ resetsAt: now + 2 * HOUR })],
      startedAt: now - 30 * MINUTE,
      finishedAt: now - 29 * MINUTE,
    },
  ];

  return {
    messages,
    cursor: `${messages.length}:0`,
    word: {
      status: AGENT_STATUS.COMPLETED,
      runStartedAt: startedAt,
      title: TITLE,
      caughtUp: true,
      payerSubscriptionId: PLAN_ID,
    },
    pages: 1,
  };
}
