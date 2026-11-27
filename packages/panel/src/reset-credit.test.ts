// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  type ProviderKeysAnswer,
  RESET_CREDIT_OUTCOME,
  type SubscriptionKeySummary,
} from "@repo/features/provider-key-wire";
import { ACT_KIND } from "@repo/host/acts";
import { USAGE_LIMIT_AGENT } from "@repo/wire/ui-messages";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, test, vi } from "vitest";
import { TranscriptAgentOn, TranscriptUsageLimitNotice } from "./reset-credit.js";
import { type AnyAct, FAKE_ANSWER, type FakeActAnswer, fakeActs } from "./testing/app-bridge.js";
import { fakeAppPlatform, QUIET_PANEL } from "./testing/app-platform.js";
import { handHostReads, handState } from "./testing/app-state.js";
import { withQueryClient } from "./testing/copy-feedback.js";

/**
 * A Codex agent's limit notice in its transcript, offering a credit on the
 * plan it runs on, over a bridge answering as the service would. Synthetic
 * plans throughout.
 */

const AT = Date.UTC(2026, 9, 20, 12);

/** A ChatGPT plan holding one credit. */
const planOf = (id: string, email: string): SubscriptionKeySummary => ({
  provider: PROVIDER_KEY_PROVIDER.OPENAI,
  kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
  hint: "ChatGPT",
  status: PROVIDER_KEY_STATUS.LIMIT_REACHED,
  addedAt: AT,
  statusAt: AT,
  forAgents: true,
  id,
  position: 0,
  email,
  resetCredits: 1,
});

const KEYS: ProviderKeysAnswer = {
  keys: [],
  subscriptions: [planOf("chatgpt-a", "ana@work.test"), planOf("chatgpt-b", "bo@work.test")],
};

/** Every act the transcript sent, in order. */
let sent: AnyAct[] = [];
const roots: Root[] = [];

function answer(request: AnyAct): Promise<FakeActAnswer> {
  sent.push(request);

  return Promise.resolve(
    request.kind === ACT_KIND.PROVIDER_KEYS_USE_RESET_CREDIT
      ? { status: FAKE_ANSWER.DONE, value: { ...KEYS, resetCredit: RESET_CREDIT_OUTCOME.RESET } }
      : { status: FAKE_ANSWER.UNKNOWN_ACT },
  );
}

beforeEach(() => {
  sent = [];
  fakeAppPlatform(QUIET_PANEL);
  fakeActs({ act: answer });
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The agent's paused notice, drawn while the agent runs on `planId`. */
const transcriptOn = (planId: string) =>
  withQueryClient(
    createElement(TranscriptAgentOn, {
      agentId: "agent-1",
      planId,
      children: createElement(TranscriptUsageLimitNotice, {
        notice: { agent: USAGE_LIMIT_AGENT.CODEX, resetsAt: Date.now() + 60 * 60 * 1000 },
      }),
    }),
  );

const button = (within: Element | Document, words: string) =>
  [...within.querySelectorAll<HTMLButtonElement>("button")].find(
    (each) => each.textContent === words && each.closest("[inert]") === null,
  );

/** The question standing over the window, or none. */
const question = () =>
  document.querySelector<HTMLElement>('[role="alertdialog"], [role="dialog"]') ?? undefined;

test("a question asked on one plan never spends another's credit when the agent moves to it", async () => {
  handState({});
  handHostReads({ keys: { rows: KEYS } });
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(transcriptOn("chatgpt-a")));
  await settle();

  await vi.waitFor(() => assert.ok(button(container, "Use reset")));
  act(() => button(container, "Use reset")?.click());
  await settle();
  assert.match(question()?.textContent ?? "", /ana@work\.test/u);

  // The agent's payer moves to the other plan while the question stands.
  act(() => root.render(transcriptOn("chatgpt-b")));
  await settle();

  // Note that a question still standing is answered, so one that would spend the other plan's credit does.
  const asking = question();
  const confirm = asking === undefined ? undefined : button(asking, "Use reset");

  if (confirm !== undefined) act(() => confirm.click());
  await settle();

  assert.deepEqual(
    sent.filter((each) => each.kind === ACT_KIND.PROVIDER_KEYS_USE_RESET_CREDIT),
    [],
  );
});
