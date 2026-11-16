import {
  AGENT_SENDER,
  type AgentTranscriptMessage,
  agentMessageReplyLine,
} from "@repo/features/agent-wire";
import { MESSAGE_ROLE } from "@repo/wire";
import { expect, test } from "vitest";
import { sentLineOf } from "./sent-lines.js";

/**
 * sent-lines.test.ts -- the lines a transcript's rail marks: the reader's own
 * as theirs, anyone else's under who sent it, another agent's message by its
 * words alone, and none for the agent's own turn or wakeup. Synthetic lines.
 */

const READER = "user-reader";

function line(
  id: string,
  text: string,
  rest: Partial<AgentTranscriptMessage> = {},
): AgentTranscriptMessage {
  return { id, role: MESSAGE_ROLE.USER, parts: [{ type: "text", text }], ...rest };
}

test("the reader's line is theirs, anyone else's is under its sender, and the agent's own are none", () => {
  const messages: readonly AgentTranscriptMessage[] = [
    line("own", "Build the invite flow.", {
      sentBy: { kind: AGENT_SENDER.MEMBER, userId: READER, name: "Ada Lovelace" },
    }),
    line("teammate", "What if two people open the link?", {
      sentBy: { kind: AGENT_SENDER.MEMBER, userId: "user-grace", name: "Grace Hopper" },
    }),
    line(
      "agent",
      [
        "Message · [@Invite emails](https://vespin.dev/acme/agent/7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f) to you:",
        "Rebase before you push.",
        agentMessageReplyLine("7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f"),
      ].join("\n\n"),
      { metadata: { channel: "agent_message" }, sentBy: { name: "Invite emails", agent: true } },
    ),
    line("wakeup", "Read the checks on #214.", { metadata: { channel: "app" } }),
    { id: "turn", role: MESSAGE_ROLE.ASSISTANT, parts: [{ type: "text", text: "Done." }] },
  ];

  const read = messages.flatMap((message) => {
    const sent = sentLineOf(message, READER, undefined);

    return sent === undefined
      ? []
      : [{ id: sent.messageId, from: sent.sender?.kind ?? "reader", words: sent.words }];
  });

  expect(read).toEqual([
    { id: "own", from: "reader", words: "Build the invite flow." },
    { id: "teammate", from: "person", words: "What if two people open the link?" },
    { id: "agent", from: "agent", words: "Rebase before you push." },
  ]);
});
