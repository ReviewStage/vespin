import assert from "node:assert/strict";
import {
  AGENT_SENDER,
  type AgentSender,
  type AgentTranscriptMessage,
} from "@repo/features/agent-wire";
import type { WorkspaceMember } from "@repo/features/workspace-wire";
import { MESSAGE_ROLE } from "@repo/wire";
import { test } from "vitest";
import { type FollowOfferInput, followOffer } from "./follow-offer.js";

/**
 * follow-offer.test.ts -- whom a line of the reader's own offers to add as a
 * follower: the first person it mentions who doesn't follow, never anyone an
 * agent's or a teammate's line names. Synthetic workspace and members.
 */

const READER = "user_dean";
const CHARLES = "user_charles";
const ADA = "user_ada";

const person = (userId: string, name: string) =>
  `[@${name}](https://vespin.dev/acme/person/${userId})`;

const member = (userId: string, name: string): WorkspaceMember => ({
  userId,
  name,
  email: `${userId}@example.com`,
  role: "member",
});

const MEMBERS = [member(READER, "Dean"), member(CHARLES, "Charles Lin"), member(ADA, "Ada")];

const line = (id: string, text: string, sentBy: AgentSender): AgentTranscriptMessage => ({
  id,
  role: MESSAGE_ROLE.USER,
  parts: [{ type: "text", text }],
  sentBy,
});

const BOTH = `Ask ${person(CHARLES, "Charles Lin")} and ${person(ADA, "Ada")} to look.`;

const input = (over: Partial<FollowOfferInput>): FollowOfferInput => ({
  messages: [line("m1", BOTH, { name: "Dean", userId: READER, kind: AGENT_SENDER.MEMBER })],
  pending: [],
  readerId: READER,
  followers: [{ userId: READER, assignee: true, machines: true }],
  members: MEMBERS,
  declined: [],
  ...over,
});

test("the reader's own line offers the first person it mentions who doesn't follow", () => {
  assert.equal(followOffer(input({})), CHARLES);
});

test("a line an agent or a teammate sent offers no one", () => {
  const agent = line("m2", BOTH, { name: "Builder", userId: READER, agent: true });
  const teammate = line("m3", BOTH, { name: "Ada", userId: ADA, kind: AGENT_SENDER.MEMBER });

  assert.equal(followOffer(input({ messages: [agent, teammate] })), undefined);
});

test("a follower, the reader, and someone turned down here are passed over", () => {
  const words = `${person(READER, "Dean")} ${person(CHARLES, "Charles Lin")} ${person(ADA, "Ada")}`;
  const own = line("m4", words, { name: "Dean", userId: READER, kind: AGENT_SENDER.MEMBER });
  const followers = [{ userId: CHARLES, assignee: false, machines: false }];

  assert.equal(followOffer(input({ messages: [own], followers })), ADA);
  assert.equal(followOffer(input({ messages: [own], followers, declined: [ADA] })), undefined);
});

test("a line still on its way is read before the transcript's", () => {
  assert.equal(followOffer(input({ pending: [`Thanks ${person(ADA, "Ada")}`] })), ADA);
});
