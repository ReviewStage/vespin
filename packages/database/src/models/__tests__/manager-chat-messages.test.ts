import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { VOICE_SPEAKER } from "@repo/features/agent-wire";
import { MANAGER_CHAT_AUTHOR } from "@repo/features/manager-chat-live";
import { Effect, Option } from "effect";
import { Database } from "../../core/query.js";
import { user } from "../../schemas/auth.js";
import { MESSAGE_SENDER } from "../../storage-vocabulary.js";
import { getTestDB, joinWorkspace, openManagerAgent } from "../../testing/index.js";
import {
  deleteDroppedManagerChat,
  editManagerChatMessage,
  MANAGER_CHAT_OUTCOME,
  type ManagerChatOutcome,
  type ManagerChatWrite,
  readManagerChatMessage,
  readManagerChatPage,
  readManagerChatThread,
  searchManagerChat,
  writeManagerChatMessage,
} from "../manager-chat-messages.js";
import { storeWriter } from "../writer.js";

/**
 * A Manager's chat, over a real dialect: a write lands once under its key,
 * a reply stands in its root's thread, half a character is kept as the
 * replacement character, a clashing id and a reply to no message are
 * refused, the chat reads by page and by words, a rewind's drop takes its
 * messages and their threads, a call's line grows in place, a person edits
 * their own message alone, and no other account reads or writes any of it.
 * Synthetic accounts.
 */

const SENT_AT = new Date("2026-11-24T12:00:00Z");

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

const openManager = (userId: string) => Effect.map(openManagerAgent(userId), (agent) => agent.id);

/** A message from the person to the Manager, under a key and an id of its own unless named. */
const personSays = (
  agentId: string,
  userId: string,
  text: string,
  rest: Partial<ManagerChatWrite> = {},
): ManagerChatWrite => ({
  agentId,
  id: randomUUID().slice(0, 8),
  clientKey: randomUUID(),
  authorKind: MANAGER_CHAT_AUTHOR.PERSON,
  authorUserId: userId,
  authorName: "Test User",
  text,
  attachments: [],
  inReplyTo: null,
  broadcast: false,
  turnId: null,
  lineId: null,
  now: SENT_AT,
  ...rest,
});

/** The message a write landed as; fails the test on any refusal. */
function landed(outcome: ManagerChatOutcome) {
  assert.equal(outcome.status, MANAGER_CHAT_OUTCOME.DONE);

  return outcome.message;
}

it.layer(getTestDB())("a Manager's chat", (it) => {
  it.effect(
    "a write sent again lands once, and a reply to a reply stands in its root's thread",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const agentId = yield* openManager(owner);

        const sent = personSays(agentId, owner, "Ship the table?");
        const root = landed(yield* writeManagerChatMessage(owner, sent));
        const again = yield* writeManagerChatMessage(owner, { ...sent, id: "ffffffff" });

        const reply = landed(
          yield* writeManagerChatMessage(
            owner,
            personSays(agentId, owner, "Yes", {
              authorKind: MANAGER_CHAT_AUTHOR.AGENT,
              authorUserId: null,
              authorName: "Manager",
              inReplyTo: root.id,
            }),
          ),
        );

        landed(
          yield* writeManagerChatMessage(
            owner,
            personSays(agentId, owner, "Thanks", { inReplyTo: reply.id }),
          ),
        );

        assert.deepEqual(again, {
          status: MANAGER_CHAT_OUTCOME.DONE,
          message: root,
          repeated: true,
        });
        assert.deepEqual(
          (yield* readManagerChatThread(owner, agentId, root.id)).map((message) => [
            message.text,
            message.threadRoot,
          ]),
          [
            ["Ship the table?", null],
            ["Yes", root.id],
            ["Thanks", root.id],
          ],
        );
      }),
  );

  it.effect(
    "a message holding half a character, as a cut that split an emoji leaves, lands with the half replaced rather than refused",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const agentId = yield* openManager(owner);

        const message = landed(
          yield* writeManagerChatMessage(
            owner,
            personSays(agentId, owner, "Done \ud83d", {
              authorName: "Test \udc4d",
              attachments: [{ id: "picture-1", mediaType: "image/png", caption: "Before \ud83d" }],
            }),
          ),
        );

        assert.deepEqual(
          [message.text, message.authorName, message.attachments],
          [
            "Done \uFFFD",
            "Test \uFFFD",
            [{ id: "picture-1", mediaType: "image/png", caption: "Before \uFFFD" }],
          ],
        );
      }),
  );

  it.effect("refuses an id another message holds, and a reply to no message", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const agentId = yield* openManager(owner);
      landed(
        yield* writeManagerChatMessage(
          owner,
          personSays(agentId, owner, "First", { id: "a1b2c3d4" }),
        ),
      );

      assert.deepEqual(
        [
          yield* writeManagerChatMessage(
            owner,
            personSays(agentId, owner, "Second", { id: "a1b2c3d4" }),
          ),
          yield* writeManagerChatMessage(
            owner,
            personSays(agentId, owner, "Third", { inReplyTo: "00000000" }),
          ),
        ],
        [{ status: MANAGER_CHAT_OUTCOME.ID_TAKEN }, { status: MANAGER_CHAT_OUTCOME.NO_THREAD }],
      );
    }),
  );

  it.effect(
    "reads a page newest first before a message, and finds every word whatever its case",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const agentId = yield* openManager(owner);

        for (const text of ["Deploy the web app", "All done", "the WEB deploy failed"]) {
          landed(yield* writeManagerChatMessage(owner, personSays(agentId, owner, text)));
        }

        const [newest] = yield* readManagerChatPage(owner, agentId, { limit: 1 });

        const older = yield* readManagerChatPage(owner, agentId, {
          before: newest?.seq ?? 0,
          limit: 5,
        });

        const found = yield* searchManagerChat(owner, agentId, "web  DEPLOY", 5);

        assert.deepEqual(
          [newest?.text, older.map((message) => message.text)],
          ["the WEB deploy failed", ["All done", "Deploy the web app"]],
        );
        assert.deepEqual(
          found.map((message) => message.text),
          ["the WEB deploy failed", "Deploy the web app"],
        );
      }),
  );

  it.effect(
    "a rewind's drop deletes a dropped line's message and its thread, and leaves the rest",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const agentId = yield* openManager(owner);
        const droppedLine = randomUUID();

        const dropped = landed(
          yield* writeManagerChatMessage(
            owner,
            personSays(agentId, owner, "Undo me", { lineId: droppedLine }),
          ),
        );

        landed(
          yield* writeManagerChatMessage(
            owner,
            personSays(agentId, owner, "A reply", { inReplyTo: dropped.id }),
          ),
        );
        landed(
          yield* writeManagerChatMessage(
            owner,
            personSays(agentId, owner, "Keep me", { lineId: randomUUID() }),
          ),
        );

        yield* deleteDroppedManagerChat(owner, agentId, {
          turnIds: [],
          lineIds: [droppedLine],
          lineKeys: [],
        });

        assert.deepEqual(
          (yield* readManagerChatPage(owner, agentId, { limit: 10 })).map(
            (message) => message.text,
          ),
          ["Keep me"],
        );
      }),
  );

  it.effect(
    "a call's line recorded in fragments stands whole as the caller's message, a fragment ending on half an emoji waiting for the rest of it",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const manager = yield* openManagerAgent(owner);
        const writer = yield* storeWriter({ tools: {} });
        const target = { userId: owner, conversationId: manager.conversationId };
        const callId = randomUUID();
        const sender = { kind: MESSAGE_SENDER.MEMBER, userId: owner } as const;
        const asked = { key: randomUUID(), callId, speaker: VOICE_SPEAKER.CALLER, sender };

        // The second record ends between 👍's two halves, which the third completes.
        for (const text of [
          "Can you",
          "Can you ship \uD83D",
          "Can you ship \uD83D\uDC4D the table?",
        ]) {
          yield* writer.recordVoiceLine(target, { ...asked, text });

          if (text.endsWith("\uD83D")) {
            const [standing] = yield* readManagerChatPage(owner, manager.id, { limit: 1 });
            assert.equal(standing?.text, "Can you ship ");
          }
        }

        // A late copy of that second record is a repeat, never a cut back.
        yield* writer.recordVoiceLine(target, { ...asked, text: "Can you ship \uD83D" });

        yield* writer.recordVoiceLine(target, {
          key: randomUUID(),
          callId,
          speaker: VOICE_SPEAKER.VOICE,
          text: "On it.",
          sender,
        });

        assert.deepEqual(
          (yield* readManagerChatPage(owner, manager.id, { limit: 10 })).map((message) => [
            message.text,
            message.authorKind,
            message.authorUserId,
          ]),
          [
            ["On it.", MANAGER_CHAT_AUTHOR.AGENT, null],
            ["Can you ship \uD83D\uDC4D the table?", MANAGER_CHAT_AUTHOR.PERSON, owner],
          ],
        );
      }),
  );

  it.effect("another account reads, writes, and deletes none of a Manager's chat", () =>
    Effect.gen(function* () {
      const owner = yield* openAccount;
      const outsider = yield* openAccount;
      const agentId = yield* openManager(owner);
      const lineId = randomUUID();

      const root = landed(
        yield* writeManagerChatMessage(
          owner,
          personSays(agentId, owner, "Private plan", { lineId }),
        ),
      );

      assert.deepEqual(
        [
          yield* writeManagerChatMessage(outsider, personSays(agentId, outsider, "Let me in")),
          Option.isNone(yield* readManagerChatMessage(outsider, agentId, root.id)),
          yield* readManagerChatPage(outsider, agentId, { limit: 10 }),
          yield* readManagerChatThread(outsider, agentId, root.id),
          yield* searchManagerChat(outsider, agentId, "private", 10),
        ],
        [{ status: MANAGER_CHAT_OUTCOME.NO_CHAT }, true, [], [], []],
      );

      yield* deleteDroppedManagerChat(outsider, agentId, {
        turnIds: [],
        lineIds: [lineId],
        lineKeys: [],
      });
      assert.equal(Option.isSome(yield* readManagerChatMessage(owner, agentId, root.id)), true);
    }),
  );

  it.effect(
    "a member edits their own message in place, and neither a teammate's message nor the Manager's",
    () =>
      Effect.gen(function* () {
        const owner = yield* openAccount;
        const teammate = yield* openAccount;
        const manager = yield* openManagerAgent(owner);
        const agentId = manager.id;
        yield* joinWorkspace(manager.organizationId, teammate);
        const editedAt = new Date("2026-11-24T12:05:00Z");

        const own = landed(
          yield* writeManagerChatMessage(owner, personSays(agentId, owner, "Shp it")),
        );

        const theirs = landed(
          yield* writeManagerChatMessage(teammate, personSays(agentId, teammate, "Hold off")),
        );

        const managers = landed(
          yield* writeManagerChatMessage(
            owner,
            personSays(agentId, owner, "On it", {
              authorKind: MANAGER_CHAT_AUTHOR.AGENT,
              authorUserId: null,
              authorName: "Manager",
            }),
          ),
        );

        const edit = (userId: string, messageId: string, text: string) =>
          editManagerChatMessage(userId, { agentId, messageId, text, now: editedAt });

        const edited = yield* edit(owner, own.id, "Ship it");

        assert.deepEqual(
          [
            Option.isNone(yield* edit(owner, theirs.id, "Ship it now")),
            Option.isNone(yield* edit(teammate, own.id, "Never mind")),
            Option.isNone(yield* edit(owner, managers.id, "Done")),
          ],
          [true, true, true],
        );
        assert.deepEqual(
          Option.map(edited, (message) => [message.text, message.editedAt]),
          Option.some(["Ship it", editedAt]),
        );
        assert.deepEqual(
          (yield* readManagerChatPage(owner, agentId, { limit: 10 })).map((message) => [
            message.text,
            message.editedAt,
          ]),
          [
            ["On it", null],
            ["Hold off", null],
            ["Ship it", editedAt],
          ],
        );
      }),
  );
});
