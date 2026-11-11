import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { createAgent } from "@repo/database/models/agent-store";
import { writePage } from "@repo/database/models/task-pages";
import { createTask } from "@repo/database/models/task-store";
import { user } from "@repo/database/schemas/auth";
import { inboxItem } from "@repo/database/schemas/inbox";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import {
  getTestDB,
  joinWorkspace,
  leaveWorkspace,
  openWorkspace,
  startTask,
} from "@repo/database/testing";
import { AGENT_ATTACHMENT_TYPE, AGENT_BOUNDS } from "@repo/features/agent-wire";
import { inboxAttachmentOf } from "@repo/features/inbox-attachment-link";
import {
  INBOX_ASK,
  INBOX_ASK_STATUS,
  INBOX_BOUNDS,
  INBOX_FIELD,
  INBOX_FILE_TYPE,
  INBOX_IMAGE_TYPE,
  INBOX_MESSAGE_AUTHOR,
  INBOX_OPTION_MEDIA,
  INBOX_REPLY,
  INBOX_STATUS,
  type InboxItem,
} from "@repo/features/inbox-wire";
import { encodeMention, MENTION_KIND } from "@repo/features/mention-link";
import { PAGE_SHOWER, taskPageOwner } from "@repo/features/page-wire";
import { unparsedWire, type WireBoundaryInput } from "@repo/wire";
import { paddedTo, webmBytes } from "@repo/wire/testing";
import { eq } from "drizzle-orm";
import { Duration, Effect, Option } from "effect";
import { TestClock } from "effect/testing";
import { ACTION_RESULT_STATUS } from "../../core.js";
import {
  acknowledgeInboxItem,
  answerInboxAsk,
  closeInboxItemAsMember,
  type InboxAgent,
  postInboxMessage,
  readInboxAttachment,
  taskInboxItems,
} from "../../inbox/inbox-store.js";
import { CODER } from "./bounds.js";
import {
  INBOX_REFUSAL,
  type InboxListResult,
  type InboxReadResult,
  listThreads,
  postToInbox,
  readThread,
  type ThreadPoster,
  withdrawAsk,
} from "./inbox.js";
import type { InboxSandboxDoor } from "./inbox-image.js";

/**
 * The coding agent's inbox tools, through their public functions against a
 * real dialect: a first post under a key opens a thread the task's inbox
 * reads, a later one adds a message, its ask replacing the open one, the
 * pictures its body draws are read from the sandbox and kept, a withdrawal
 * settles the open ask with why, and every call answers the agent's whole
 * inbox, each thread's messages with their asks and answers. Nothing of
 * another account's agent is read or written.
 *
 * Synthetic accounts, tasks, and words throughout.
 */

const openUser = Effect.gen(function* () {
  const db = yield* Database;
  const userId = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
  return userId;
});

/** An agent the account starts on the task, in its repository. */
const agentOn = (userId: string, task: { readonly id: string; readonly workspaceId: string }) =>
  Effect.gen(function* () {
    const started = yield* createAgent(userId, {
      taskId: task.id,
      idempotencyKey: randomUUID(),
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/relay",
      descriptionSnapshot: "# Teammate invitations\n",
      prompt: null,
      runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
    });
    assert.ok(Option.isSome(started));
    const agent = {
      userId,
      taskId: task.id,
      agentId: started.value.agent.id,
      organizationId: started.value.agent.organizationId,
    } satisfies ThreadPoster;
    return { ...agent, workspaceId: task.workspaceId };
  });

/** An account with one task and one agent started on it, in its repository. */
const openAgent = Effect.gen(function* () {
  const userId = yield* openUser;
  const task = yield* startTask(userId, { name: "Teammate invitations" });
  return yield* agentOn(userId, task);
});

const QUEUE = {
  key: "invite-queue",
  title: "Which queue sends the invitation emails?",
  body: "The repo already runs **Postgres**.",
  ask: {
    type: INBOX_ASK.DECIDE,
    options: [{ label: "Postgres outbox", detail: "No new service." }, { label: "Redis" }],
    recommended: "Postgres outbox",
  },
};

const SETTINGS = {
  key: "branch-protection",
  title: "Require a review on main",
  body: "Add a rule for `main`.\n\nhttps://github.com/acme/relay/settings/branches",
  ask: {
    type: INBOX_ASK.DO,
    steps: ["Open Settings → Branches.", "Require one review on `main`."],
  },
};

/** A tool's input as a harness hands it over. */
const input = (value: WireBoundaryInput) => unparsedWire(value);

/** A sandbox door no post with words alone opens: one that fails if it is. */
const noSandbox: InboxSandboxDoor = () => Promise.reject(new Error("the sandbox was opened"));

/** A sandbox holding the files given by their path from the checkout, each read as one stream. */
function sandboxWith(files: Readonly<Record<string, Uint8Array>>): InboxSandboxDoor {
  const byPath = new Map(
    Object.entries(files).map(([path, bytes]) => [posix.resolve(CODER.CHECKOUT_PATH, path), bytes]),
  );
  return () =>
    Promise.resolve({
      readFile: ({ path }: { path: string }) => {
        const bytes = byPath.get(path);
        if (bytes === undefined) return Promise.resolve(null);
        return Promise.resolve(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
        );
      },
    });
}

/** The first bytes of a PNG, as a screenshot's file starts. */
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

/** A post run as the tool runs one, over the sandbox given. */
const post = (agent: ThreadPoster, value: WireBoundaryInput, sandbox = noSandbox) =>
  postToInbox(agent, input(value), sandbox);

/** The one thread of the agent's task, as the task's inbox reads it. */
const onlyItem = (agent: Pick<InboxAgent, "userId"> & { readonly taskId: string }) =>
  Effect.map(taskInboxItems(agent.userId, agent.taskId), (items) => {
    assert.equal(items.length, 1, "one thread per key");
    const [item] = items;
    assert.ok(item);
    return item;
  });

/** The lines a list accepted, failing where it refused. */
function acceptedList(result: InboxListResult) {
  assert.ok("threads" in result, "the list was accepted");
  return result.threads;
}

/** The thread a read accepted, failing where it refused. */
function acceptedRead(result: InboxReadResult) {
  assert.ok("thread" in result, "the read was accepted");
  return result.thread;
}

/** A read's messages without when each was written, which the store's clock sets. */
function untimed<Line extends { readonly at: string }>(messages: readonly Line[]) {
  return messages.map(({ at: _at, ...line }) => line);
}

/** The message whose ask the thread holds open. */
function openAsk(item: InboxItem) {
  const asking = item.thread?.find((message) => message.ask?.status === INBOX_ASK_STATUS.OPEN);
  assert.ok(asking);
  return asking;
}

/** The refusal a call answered, or a failure where it was taken. */
function refusalOf(result: { readonly status: string; readonly reason?: string }): string {
  assert.equal(result.status, ACTION_RESULT_STATUS.REJECTED);
  return result.reason ?? "";
}

it.layer(getTestDB())("the coding agent's inbox", (it) => {
  it.effect(
    "a first post opens a thread under its title; a later post adds a message, one with an ask replacing the open one and keeping the title where it names none",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const posted = yield* post(agent, QUEUE);
        const first = yield* onlyItem(agent);
        assert.deepEqual(posted, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          thread: {
            key: QUEUE.key,
            title: QUEUE.title,
            id: first.id,
            status: INBOX_STATUS.OPEN,
            thread: [
              {
                from: "you",
                text: QUEUE.body,
                ask: { ...QUEUE.ask, status: INBOX_ASK_STATUS.OPEN },
              },
            ],
          },
          open: [],
        });
        assert.deepEqual(openAsk(first).ask, { ...QUEUE.ask, status: INBOX_ASK_STATUS.OPEN });

        yield* TestClock.adjust(Duration.seconds(1));
        yield* post(agent, { key: QUEUE.key, body: "Redis would need a new service." });
        const noted = yield* onlyItem(agent);
        assert.equal(
          noted.status,
          INBOX_STATUS.OPEN,
          "a post that asks nothing leaves the ask open",
        );
        assert.equal(openAsk(noted).id, openAsk(first).id);

        yield* TestClock.adjust(Duration.seconds(1));
        const askedAgain = yield* post(agent, {
          key: QUEUE.key,
          body: "Redis is gone; how many workers?",
          ask: { type: INBOX_ASK.ANSWER, fields: [{ type: INBOX_FIELD.NUMBER, label: "Workers" }] },
        });
        assert.equal(askedAgain.status, ACTION_RESULT_STATUS.ACCEPTED);
        const item = yield* onlyItem(agent);
        assert.equal(item.id, first.id);
        assert.equal(item.title, QUEUE.title, "a post naming no title keeps the thread's");
        assert.deepEqual(
          item.thread?.map((message) => [message.text, message.ask?.status]),
          [
            [QUEUE.body, INBOX_ASK_STATUS.REPLACED],
            ["Redis would need a new service.", undefined],
            ["Redis is gone; how many workers?", INBOX_ASK_STATUS.OPEN],
          ],
        );
        assert.deepEqual(openAsk(item).ask, {
          type: INBOX_ASK.ANSWER,
          fields: [{ type: INBOX_FIELD.NUMBER, label: "Workers" }],
          status: INBOX_ASK_STATUS.OPEN,
        });
      }),
  );

  it.effect(
    "a post is addressed to the member its link names; a link naming no member of the workspace is refused and posts nothing",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const person = (id: string) =>
          `[@Ada](${encodeMention({ kind: MENTION_KIND.PERSON, userId: id }, { workspace: "acme", repository: null })})`;
        const posted = yield* post(agent, { ...QUEUE, to: person(agent.userId) });
        assert.equal(posted.status, ACTION_RESULT_STATUS.ACCEPTED, JSON.stringify(posted));

        const agentLink = `[@Agent](${encodeMention({ kind: MENTION_KIND.AGENT, agentId: agent.agentId }, { workspace: "acme", repository: null })})`;
        for (const [place, reason] of [
          [{ to: person(`user-${randomUUID()}`) }, INBOX_REFUSAL.NO_ADDRESSEE],
          [{ to: agentLink }, INBOX_REFUSAL.NO_MEMBER],
        ] as const) {
          assert.deepEqual(
            yield* post(agent, { ...QUEUE, key: "elsewhere", ...place }),
            { status: ACTION_RESULT_STATUS.REJECTED, reason },
            JSON.stringify(place),
          );
        }
        assert.equal((yield* onlyItem(agent)).key, QUEUE.key);
      }),
  );

  it.effect(
    "a first post naming no title is refused and writes nothing; a first post that asks nothing opens a notice the agent reads as no ask of its own, which no withdrawal finds",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const { title: _title, ...untitled } = QUEUE;
        assert.equal(refusalOf(yield* post(agent, untitled)), INBOX_REFUSAL.NO_TITLE);
        assert.deepEqual(yield* taskInboxItems(agent.userId, agent.taskId), []);

        const noted = yield* post(agent, { key: "pr-ready", title: "PR ready", body: "Opened." });
        const notice = yield* onlyItem(agent);
        assert.deepEqual(noted, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          thread: {
            key: "pr-ready",
            title: "PR ready",
            id: notice.id,
            status: INBOX_STATUS.OPEN,
            thread: [{ from: "you", text: "Opened." }],
          },
          open: [],
        });
        assert.deepEqual([notice.status, notice.needsReply], [INBOX_STATUS.OPEN, false]);
        assert.equal(
          refusalOf(yield* withdrawAsk(agent, input({ key: "pr-ready", reason: "Merged." }))),
          INBOX_REFUSAL.NO_OPEN_ASK,
        );
      }),
  );

  it.effect(
    "every ask is heard back, a do as a decide and an answer, and an older post's waits is taken and changes nothing",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const cases = [
          ["decide", QUEUE.ask, undefined],
          ["answer", { type: INBOX_ASK.ANSWER }, undefined],
          ["do", SETTINGS.ask, undefined],
          ["do-quiet", SETTINGS.ask, false],
        ] as const;
        for (const [key, ask, waits] of cases) {
          const value = { key, title: key, body: "Words.", ask };
          const posted = yield* post(agent, waits === undefined ? value : { ...value, waits });
          assert.equal(posted.status, ACTION_RESULT_STATUS.ACCEPTED, key);
        }
        const items = yield* taskInboxItems(agent.userId, agent.taskId);
        assert.deepEqual(
          cases.map(([key]) => [key, items.find((item) => item.key === key)?.needsReply]),
          cases.map(([key]) => [key, true]),
        );
      }),
  );

  it.effect(
    "an ask its shape admits but cannot ask is refused, and a select field keeps the option it recommends",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const decide = (ask: WireBoundaryInput) => ({ ...QUEUE, ask });
        const answer = (fields: readonly WireBoundaryInput[]) => ({
          key: "invite-channel",
          title: "How are invitations sent?",
          body: "Pick a channel.",
          ask: { type: INBOX_ASK.ANSWER, fields },
        });
        const refusals = [
          [
            decide({ ...QUEUE.ask, options: [{ label: "A" }, { label: "A" }] }),
            INBOX_REFUSAL.NO_OPTIONS,
          ],
          [decide({ ...QUEUE.ask, recommended: "Kafka" }), INBOX_REFUSAL.UNKNOWN_RECOMMENDATION],
          [
            decide({ ...QUEUE.ask, multiple: true, recommended: ["Redis", "Kafka"] }),
            INBOX_REFUSAL.UNKNOWN_RECOMMENDATION,
          ],
          [
            decide({ ...QUEUE.ask, recommended: ["Postgres outbox", "Redis"] }),
            INBOX_REFUSAL.SEVERAL_RECOMMENDED,
          ],
          [
            decide({ ...QUEUE.ask, multiple: true, recommended: ["Redis", "Redis"] }),
            INBOX_REFUSAL.SEVERAL_RECOMMENDED,
          ],
          [answer([{ type: INBOX_FIELD.SELECT, label: "Channel" }]), INBOX_REFUSAL.SELECT_OPTIONS],
          [
            answer([
              {
                type: INBOX_FIELD.SELECT,
                label: "Channel",
                options: ["Email", "Slack"],
                recommended: "SMS",
              },
            ]),
            INBOX_REFUSAL.SELECT_RECOMMENDATION,
          ],
          [
            answer([{ type: INBOX_FIELD.TEXT, label: "Channel", recommended: "Slack" }]),
            INBOX_REFUSAL.SELECT_RECOMMENDATION,
          ],
          [
            answer([
              { type: INBOX_FIELD.TEXT, label: "Channel" },
              { type: INBOX_FIELD.BOOLEAN, label: "Channel" },
            ]),
            INBOX_REFUSAL.FIELD_LABELS,
          ],
          [{ key: "Not A Slug", title: "T", body: "B" }, INBOX_REFUSAL.UNREADABLE_POST],
          [{ key: "empty", title: "T", body: "" }, INBOX_REFUSAL.UNREADABLE_POST],
          [{ key: "blank", title: "T", body: " \n\t " }, INBOX_REFUSAL.UNREADABLE_POST],
        ] as const;
        for (const [value, reason] of refusals) {
          assert.equal(refusalOf(yield* post(agent, value)), reason);
        }
        // A link written before the tool that answers its id has answered holds a placeholder, which leads nowhere.
        const placeholder = "https://vespin.dev/acme/agent/{AGENT}";
        const unread = refusalOf(
          yield* post(agent, { ...QUEUE, body: `Started [@its agent](${placeholder}).` }),
        );
        assert.ok(unread.startsWith("Not posted:") && unread.includes(placeholder), unread);
        assert.deepEqual(yield* taskInboxItems(agent.userId, agent.taskId), []);

        const channel = {
          type: INBOX_FIELD.SELECT,
          label: "Channel",
          options: ["Email", "Slack"],
          recommended: "Slack",
        };
        yield* post(agent, answer([channel]));
        const item = yield* onlyItem(agent);
        assert.deepEqual(openAsk(item).ask, {
          type: INBOX_ASK.ANSWER,
          fields: [channel],
          status: INBOX_ASK_STATUS.OPEN,
        });
      }),
  );

  it.effect(
    "a decide that takes several recommends several, kept as its first label and every label, and a list of one is kept as its label",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const options = [{ label: "Email" }, { label: "Slack" }, { label: "SMS" }];
        yield* post(agent, {
          key: "invite-channels",
          title: "Which channels send invitations?",
          body: "Pick any.",
          ask: { type: INBOX_ASK.DECIDE, options, multiple: true, recommended: ["Slack", "Email"] },
        });
        const several = yield* onlyItem(agent);
        const kept = {
          type: INBOX_ASK.DECIDE,
          options,
          multiple: true,
          recommended: "Slack",
          recommendations: ["Slack", "Email"],
        };
        assert.deepEqual(openAsk(several).ask, { ...kept, status: INBOX_ASK_STATUS.OPEN });

        yield* TestClock.adjust(Duration.seconds(1));
        yield* post(agent, {
          key: "invite-channels",
          body: "Only one, then.",
          ask: { type: INBOX_ASK.DECIDE, options, recommended: ["SMS"] },
        });
        const one = yield* onlyItem(agent);
        assert.deepEqual(openAsk(one).ask, {
          type: INBOX_ASK.DECIDE,
          options,
          recommended: "SMS",
          status: INBOX_ASK_STATUS.OPEN,
        });
      }),
  );

  it.effect(
    "an option's media is kept with the message, its files after the body's pictures and named by the ask, its page at the version the agent was shown, and a page of another task is refused",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const shown = { kind: PAGE_SHOWER.AGENT, agentId: agent.agentId } as const;
        const page = yield* writePage(
          agent.userId,
          taskPageOwner(agent.taskId),
          { title: "Done card directions", html: "<p>Directions</p>" },
          shown,
        ).pipe(Effect.map(Option.getOrThrow));
        // A later version stands by the time the agent posts the one it was shown.
        yield* writePage(
          agent.userId,
          taskPageOwner(agent.taskId),
          { pageId: page.id, title: "Done card directions", html: "<p>Later</p>" },
          shown,
        );
        const sandbox = sandboxWith({ "shots/body.png": PNG, "shots/card.png": PNG });
        const options = [
          {
            label: "A card",
            media: [
              { path: "shots/card.png", caption: "The card on a desktop" },
              { page: page.id, version: 1 },
              { url: "https://preview.example.com/card", label: "Preview" },
            ],
          },
          { label: "No card" },
        ];
        const ask = { type: INBOX_ASK.DECIDE, options };
        const body = "How should a turn end? ![Today](shots/body.png)";

        const posted = yield* post(agent, { ...QUEUE, body, ask }, sandbox);

        assert.equal(posted.status, ACTION_RESULT_STATUS.ACCEPTED);
        const item = yield* onlyItem(agent);
        const asking = openAsk(item);
        const [, card] = asking.files ?? [];
        assert.deepEqual(
          (asking.files ?? []).map((file) => file.name),
          ["body.png", "card.png"],
        );
        assert.deepEqual(openAsk(item).ask, {
          type: INBOX_ASK.DECIDE,
          options: [
            {
              label: "A card",
              media: [
                {
                  type: INBOX_OPTION_MEDIA.FILE,
                  attachmentId: card?.attachmentId,
                  mediaType: INBOX_IMAGE_TYPE.PNG,
                  caption: "The card on a desktop",
                },
                {
                  type: INBOX_OPTION_MEDIA.PAGE,
                  pageId: page.id,
                  version: 1,
                  title: "Done card directions",
                  place: { taskId: agent.taskId },
                },
                {
                  type: INBOX_OPTION_MEDIA.LINK,
                  url: "https://preview.example.com/card",
                  label: "Preview",
                },
              ],
            },
            { label: "No card" },
          ],
          status: INBOX_ASK_STATUS.OPEN,
        });

        const other = yield* startTask(agent.userId, { name: "Another task" });
        const elsewhere = yield* writePage(
          agent.userId,
          taskPageOwner(other.id),
          { title: "Elsewhere", html: "<p>Elsewhere</p>" },
          shown,
        ).pipe(Effect.map(Option.getOrThrow));
        const away = [{ label: "A card", media: [{ page: elsewhere.id }] }, { label: "No card" }];
        const refused = yield* post(agent, {
          ...QUEUE,
          ask: { type: INBOX_ASK.DECIDE, options: away },
        });
        assert.equal(refusalOf(refused), INBOX_REFUSAL.NO_PAGE);
      }),
  );

  it.effect(
    "the pictures a body draws by their paths are read from the sandbox, kept as the message's files, and written by their addresses; a web picture and one in code are left as written",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const body = [
          "The form, before and after:",
          "",
          '![Before](shots/before.png "Before") ![After](</workspace/repository/shots/after.png>)',
          "",
          "![Logo](https://example.com/logo.png)",
          "",
          "Write `![alt](shots/missing.png)` for a picture.",
        ].join("\n");
        const sandbox = sandboxWith({ "shots/before.png": PNG, "shots/after.png": PNG });

        const posted = yield* post(agent, { ...QUEUE, body }, sandbox);

        assert.equal(posted.status, ACTION_RESULT_STATUS.ACCEPTED);
        const item = yield* onlyItem(agent);
        const [message] = item.thread ?? [];
        assert.equal(message?.author, INBOX_MESSAGE_AUTHOR.AGENT);
        assert.deepEqual(
          message?.files?.map((file) => [file.name, file.mediaType]),
          [
            ["before.png", INBOX_IMAGE_TYPE.PNG],
            ["after.png", INBOX_IMAGE_TYPE.PNG],
          ],
        );
        const drawn = [...(message?.text ?? "").matchAll(/!\[[^\]]*\]\(<?([^\s)>]+)/gu)].map(
          ([, destination]) => destination ?? "",
        );
        assert.deepEqual(
          drawn.slice(0, 2).map((address) => inboxAttachmentOf(address)),
          (message?.files ?? []).map((file) => ({
            itemId: item.id,
            attachmentId: file.attachmentId,
          })),
          "each path is written as its kept picture's address",
        );
        assert.deepEqual(drawn.slice(2), ["https://example.com/logo.png", "shots/missing.png"]);
        const kept = yield* readInboxAttachment(
          agent.userId,
          item.id,
          message?.files?.[0]?.attachmentId ?? "",
        );
        assert.deepEqual(new Uint8Array(Option.getOrThrow(kept).bytes), PNG);

        const web = yield* post(agent, {
          key: "web-only",
          title: "A web picture",
          body: "![Logo](https://example.com/logo.png)",
        });
        assert.equal(web.status, ACTION_RESULT_STATUS.ACCEPTED, "a web picture opens no sandbox");
      }),
  );

  it.effect(
    "a recording a body draws is kept as a WebM past a picture's and a file's bound and read back as one, and a desktop before version 5 is shown no image block for it",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        // Past a message's file bound too, which the item's table held a recording to before.
        const recording = paddedTo(webmBytes(1280, 800), AGENT_BOUNDS.MAX_PDF_BYTES + 1);
        const sandbox = sandboxWith({ "/tmp/video/flow.webm": recording });

        const posted = yield* post(
          agent,
          { ...QUEUE, body: '![Inviting a member](/tmp/video/flow.webm "The invite flow")' },
          sandbox,
        );

        assert.equal(posted.status, ACTION_RESULT_STATUS.ACCEPTED);
        const item = yield* onlyItem(agent);
        const [message] = item.thread ?? [];
        assert.deepEqual(
          message?.files?.map((file) => [file.name, file.mediaType]),
          [["flow.webm", INBOX_FILE_TYPE.WEBM]],
        );
        const kept = yield* readInboxAttachment(
          agent.userId,
          item.id,
          message?.files?.[0]?.attachmentId ?? "",
        );
        assert.deepEqual(
          Option.map(kept, (file) => [file.contentType, file.bytes.byteLength]),
          Option.some([INBOX_FILE_TYPE.WEBM, recording.byteLength]),
        );
      }),
  );

  it.effect(
    "a picture past a picture's bound, a recording past a video's, and one that states no size are refused with the path named",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const sandbox = sandboxWith({
          "shots/huge.png": paddedTo(PNG, INBOX_BOUNDS.MAX_IMAGE_BYTES + 1),
          "/tmp/video/long.webm": paddedTo(webmBytes(1280, 800), INBOX_BOUNDS.MAX_VIDEO_BYTES + 1),
          "/tmp/video/flow.mkv": webmBytes(640, 480, "matroska"),
        });
        const tooLarge =
          "Not posted: a picture names a file larger than 1.5 MB, or a video larger than 4.0 MB; render it smaller, or record a shorter flow:";
        const refusals = [
          ["shots/huge.png", `${tooLarge} shots/huge.png`],
          ["/tmp/video/long.webm", `${tooLarge} /tmp/video/long.webm`],
          [
            "/tmp/video/flow.mkv",
            "Not posted: a picture names a file that is not a PNG, JPEG, or WebP image, or a WebM video that states its size: /tmp/video/flow.mkv",
          ],
        ] as const;
        for (const [path, reason] of refusals) {
          const refused = yield* post(agent, { ...QUEUE, body: `![Shot](${path})` }, sandbox);
          assert.equal(refusalOf(refused), reason);
        }
        assert.deepEqual(yield* taskInboxItems(agent.userId, agent.taskId), []);
      }),
  );

  it.effect(
    "a post drawing a picture that is missing, no image, or one past the count is refused with the path named, and writes nothing",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        const sandbox = sandboxWith({
          "shots/form.png": PNG,
          "notes.txt": new TextEncoder().encode("no picture"),
        });
        const drawing = (...paths: string[]) => ({
          ...QUEUE,
          body: paths.map((path) => `![Shot](${path})`).join("\n"),
        });
        const refusals = [
          [
            drawing("shots/form.png", "shots/gone.png"),
            "Not posted: a picture names no file in your sandbox: shots/gone.png",
          ],
          [
            drawing("notes.txt"),
            "Not posted: a picture names a file that is not a PNG, JPEG, or WebP image, or a WebM video that states its size: notes.txt",
          ],
          [
            drawing(...Array.from({ length: 9 }, (_none, at) => `shots/${at}.png`)),
            INBOX_REFUSAL.TOO_MANY_PICTURES,
          ],
        ] as const;
        for (const [value, reason] of refusals) {
          assert.equal(refusalOf(yield* post(agent, value, sandbox)), reason);
        }
        assert.deepEqual(yield* taskInboxItems(agent.userId, agent.taskId), []);
      }),
  );

  it.effect(
    "withdraw_ask settles the open ask with why and leaves the thread; one with no open ask, an answered one among them, is refused and changes nothing",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        yield* post(agent, SETTINGS);
        const withdrawn = yield* withdrawAsk(
          agent,
          input({ key: SETTINGS.key, reason: "Did it myself." }),
        );
        const settings = yield* onlyItem(agent);
        assert.deepEqual(withdrawn, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          thread: {
            key: SETTINGS.key,
            title: SETTINGS.title,
            id: settings.id,
            status: INBOX_STATUS.CLOSED,
            thread: [
              {
                from: "you",
                text: SETTINGS.body,
                ask: {
                  type: INBOX_ASK.DO,
                  status: INBOX_ASK_STATUS.WITHDRAWN,
                  withdrawnReason: "Did it myself.",
                },
              },
            ],
          },
          open: [],
        });
        const again = yield* withdrawAsk(agent, input({ key: SETTINGS.key, reason: "Twice." }));
        assert.equal(refusalOf(again), INBOX_REFUSAL.NO_OPEN_ASK);

        yield* post(agent, QUEUE);
        const asked = (yield* taskInboxItems(agent.userId, agent.taskId)).find(
          (item) => item.key === QUEUE.key,
        );
        assert.ok(asked);
        const answered = yield* answerInboxAsk(agent.userId, asked.id, {
          answers: { ask: openAsk(asked).id, reply: INBOX_REPLY.CHOSE, choices: ["Redis"] },
          text: "",
          clientKey: randomUUID(),
        });
        assert.equal(Option.getOrThrow(answered).item.status, INBOX_STATUS.ANSWERED);
        const late = yield* withdrawAsk(agent, input({ key: QUEUE.key, reason: "Too late." }));
        assert.equal(refusalOf(late), INBOX_REFUSAL.NO_OPEN_ASK);
        const after = (yield* taskInboxItems(agent.userId, agent.taskId)).find(
          (item) => item.key === QUEUE.key,
        );
        assert.equal(
          after?.status,
          INBOX_STATUS.ANSWERED,
          "an answered thread is never closed over",
        );

        const refusals = [
          [{ key: "no-such-thread", reason: "Gone." }, INBOX_REFUSAL.NO_OPEN_ASK],
          [{ key: QUEUE.key }, INBOX_REFUSAL.UNREADABLE_WITHDRAW],
        ] as const;
        for (const [value, reason] of refusals) {
          assert.equal(refusalOf(yield* withdrawAsk(agent, input(value))), reason);
        }
      }),
  );

  it.effect(
    "read_thread answers a thread's every message in order, each ask whole with where it stands and each answer by whom, a settled one as much as an open one",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        yield* post(agent, QUEUE);
        const asked = yield* onlyItem(agent);
        yield* TestClock.adjust(Duration.seconds(1));
        yield* postInboxMessage(agent.userId, asked.id, {
          text: "Is Redis free?",
          clientKey: randomUUID(),
          files: [
            {
              name: "pricing.txt",
              mediaType: AGENT_ATTACHMENT_TYPE.TEXT,
              data: Buffer.from("free\n").toString("base64"),
            },
          ],
        });
        yield* TestClock.adjust(Duration.seconds(1));
        yield* post(agent, { key: QUEUE.key, body: "No: it needs a new service." });

        const open = acceptedRead(yield* readThread(agent, input({ threadId: asked.id })));
        assert.deepEqual(untimed(open.messages), [
          { from: "you", text: QUEUE.body, ask: { ...QUEUE.ask, status: INBOX_ASK_STATUS.OPEN } },
          {
            from: "Test User",
            fromUserId: agent.userId,
            text: "Is Redis free?",
            files: ["pricing.txt"],
          },
          { from: "you", text: "No: it needs a new service." },
        ]);

        yield* TestClock.adjust(Duration.seconds(1));
        yield* answerInboxAsk(agent.userId, asked.id, {
          answers: {
            ask: openAsk(asked).id,
            reply: INBOX_REPLY.CHOSE,
            choices: ["Postgres outbox"],
          },
          text: "Go with the outbox.",
          clientKey: randomUUID(),
        });

        for (const text of ["Thanks.", "Shipping it."]) {
          yield* TestClock.adjust(Duration.seconds(1));
          yield* post(agent, { key: QUEUE.key, body: text });
        }
        // The agent's words after the answer bring the thread back as a notice, which the member's reply on it settles.
        const notice = yield* onlyItem(agent);
        assert.equal(notice.status, INBOX_STATUS.OPEN);
        yield* TestClock.adjust(Duration.seconds(1));
        yield* postInboxMessage(agent.userId, asked.id, {
          text: "Great.",
          clientKey: randomUUID(),
          revision: notice.revision,
        });

        const settled = acceptedRead(yield* readThread(agent, input({ threadId: asked.id })));
        assert.deepEqual(
          [settled.status, settled.answeredBy, settled.answeredByUserId, settled.older],
          [INBOX_STATUS.ANSWERED, "Test User", agent.userId, undefined],
        );
        assert.deepEqual(untimed(settled.messages), [
          {
            from: "you",
            text: QUEUE.body,
            ask: { ...QUEUE.ask, status: INBOX_ASK_STATUS.ANSWERED },
          },
          {
            from: "Test User",
            fromUserId: agent.userId,
            text: "Is Redis free?",
            files: ["pricing.txt"],
          },
          { from: "you", text: "No: it needs a new service." },
          {
            from: "Test User",
            fromUserId: agent.userId,
            text: "Go with the outbox.",
            answers: { reply: INBOX_REPLY.CHOSE, choices: ["Postgres outbox"] },
          },
          { from: "you", text: "Thanks." },
          { from: "you", text: "Shipping it." },
          { from: "Test User", fromUserId: agent.userId, text: "Great." },
        ]);
      }),
  );

  it.effect(
    "a settled do reads back whole beside the places of the steps the member ticked, so the agent knows which are left",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        yield* post(agent, SETTINGS);
        const asked = yield* onlyItem(agent);
        yield* TestClock.adjust(Duration.seconds(1));
        yield* answerInboxAsk(agent.userId, asked.id, {
          answers: { ask: openAsk(asked).id, reply: INBOX_REPLY.NOT_DONE, steps: [0] },
          text: "No admin rights for the rule.",
          clientKey: randomUUID(),
        });

        const read = acceptedRead(yield* readThread(agent, input({ threadId: asked.id })));

        assert.deepEqual(
          read.messages.map((line) => [line.ask, line.answers]),
          [
            [{ ...SETTINGS.ask, status: INBOX_ASK_STATUS.ANSWERED }, undefined],
            [undefined, { reply: INBOX_REPLY.NOT_DONE, steps: [0] }],
          ],
        );
      }),
  );

  it.effect(
    "a post answers the thread it changed and one line for each other open thread, and the list names who closed a thread without an answer and why the agent withdrew its own",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        yield* post(agent, SETTINGS);
        const second = yield* post(agent, { ...SETTINGS, key: "own" });
        assert.ok("thread" in second);
        assert.deepEqual(
          [second.thread.key, second.open.map((row) => row.key)],
          ["own", [SETTINGS.key]],
        );
        const items = yield* taskInboxItems(agent.userId, agent.taskId);
        const settings = items.find((item) => item.key === SETTINGS.key);
        assert.ok(settings);
        yield* closeInboxItemAsMember(agent.userId, settings.id, settings.revision, randomUUID());
        yield* withdrawAsk(agent, input({ key: "own", reason: "Did it myself." }));

        const listed = acceptedList(yield* listThreads(agent, input({})));
        assert.deepEqual(
          listed.map((row) => [row.key, row.status, row.closedBy, row.closedReason]).sort(),
          [
            ["own", INBOX_STATUS.CLOSED, undefined, "Did it myself."],
            [SETTINGS.key, INBOX_STATUS.CLOSED, "Test User", undefined],
          ].sort(),
        );
      }),
  );

  it.effect(
    "the list names a notice the member nodded as answered, with no answer beside it, and one closed before threads by its reason alone",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        yield* post(agent, { key: "pr-ready", title: "PR ready", body: "Opened." });
        yield* post(agent, { key: "pr-merged", title: "PR merged", body: "Merged." });
        const items = yield* taskInboxItems(agent.userId, agent.taskId);
        const itemOf = (key: string) => items.find((item) => item.key === key);
        const ready = itemOf("pr-ready");
        const merged = itemOf("pr-merged");
        assert.ok(ready && merged);
        const nodded = yield* acknowledgeInboxItem(
          agent.userId,
          ready.id,
          ready.revision,
          randomUUID(),
        );
        assert.ok(Option.isSome(nodded));
        // A deployment from before threads closed a notice with why; no tool from version 5 closes one.
        yield* Database.use((db) =>
          db
            .update(inboxItem)
            .set({ status: INBOX_STATUS.CLOSED, closedReason: "Merged by hand." })
            .where(eq(inboxItem.id, merged.id)),
        );

        const listed = acceptedList(yield* listThreads(agent, input({})));

        assert.deepEqual(
          listed.map(({ updatedAt: _at, ...row }) => row),
          [
            {
              id: ready.id,
              key: "pr-ready",
              title: "PR ready",
              status: INBOX_STATUS.ANSWERED,
              lastFrom: "you",
            },
            {
              id: merged.id,
              key: "pr-merged",
              title: "PR merged",
              status: INBOX_STATUS.CLOSED,
              lastFrom: "you",
              closedReason: "Merged by hand.",
            },
          ],
        );
      }),
  );

  it.effect(
    "an agent lists a teammate's agent's threads, and its task's, of its own workspace alone, and never lists or reads an agent's of another workspace its developer belongs to",
    () =>
      Effect.gen(function* () {
        const { workspaceId, ...agent } = yield* openAgent;
        const teammateId = yield* openUser;
        yield* joinWorkspace(workspaceId, teammateId);
        const teammateTask = yield* createTask(teammateId, {
          name: "Billing export",
          organizationId: workspaceId,
        });
        const { workspaceId: _shared, ...teammate } = yield* agentOn(teammateId, teammateTask);
        yield* post(teammate, QUEUE);
        const elsewhereId = yield* openWorkspace(agent.userId);
        const elsewhereTask = yield* createTask(agent.userId, {
          name: "Side project",
          organizationId: elsewhereId,
        });
        const { workspaceId: _elsewhere, ...elsewhere } = yield* agentOn(
          agent.userId,
          elsewhereTask,
        );
        yield* post(elsewhere, SETTINGS);

        const byAgent = acceptedList(
          yield* listThreads(agent, input({ agentId: teammate.agentId })),
        );
        const byTask = acceptedList(yield* listThreads(agent, input({ taskId: teammate.taskId })));
        const outside = acceptedList(
          yield* listThreads(agent, input({ agentId: elsewhere.agentId })),
        );
        const misspelled = yield* listThreads(agent, input({ agentID: teammate.agentId }));
        const [elsewhereItem] = yield* taskInboxItems(agent.userId, elsewhere.taskId);
        assert.ok(elsewhereItem);
        const outsideRead = yield* readThread(agent, input({ threadId: elsewhereItem.id }));

        const teammateThread = [
          {
            key: QUEUE.key,
            agentId: teammate.agentId,
            status: INBOX_STATUS.OPEN,
            lastFrom: "agent",
            ask: { type: INBOX_ASK.DECIDE, text: QUEUE.body },
          },
        ];
        const summary = (rows: typeof byAgent) =>
          rows.map(({ key, agentId, status, lastFrom, ask }) => ({
            key,
            agentId,
            status,
            lastFrom,
            ask,
          }));
        assert.deepEqual(summary(byAgent), teammateThread);
        assert.deepEqual(summary(byTask), teammateThread);
        assert.deepEqual(outside, []);
        assert.equal(refusalOf(misspelled), INBOX_REFUSAL.UNREADABLE_LIST);
        assert.equal(refusalOf(outsideRead), INBOX_REFUSAL.NO_THREAD);
      }),
  );

  it.effect(
    "list_threads with a status lists the latest threads standing there, however many settled otherwise since",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        yield* post(agent, QUEUE);
        const asked = yield* onlyItem(agent);
        yield* answerInboxAsk(agent.userId, asked.id, {
          answers: { ask: openAsk(asked).id, reply: INBOX_REPLY.CHOSE, choices: ["Redis"] },
          text: "",
          clientKey: randomUUID(),
        });
        // Note that it takes about a second, because it must settle as many threads as a list's bound to push the answered one past it.
        for (let done = 1; done <= INBOX_BOUNDS.MAX_SETTLED_TOLD; done += 1) {
          yield* TestClock.adjust(Duration.seconds(1));
          yield* post(agent, { ...SETTINGS, key: `done-${done}` });
          yield* withdrawAsk(agent, input({ key: `done-${done}`, reason: "Did it myself." }));
        }

        const answered = acceptedList(
          yield* listThreads(agent, input({ status: INBOX_STATUS.ANSWERED })),
        );

        assert.deepEqual(
          answered.map((row) => [row.key, row.status]),
          [[QUEUE.key, INBOX_STATUS.ANSWERED]],
        );
      }),
  );

  it.effect(
    "read_thread pages a long thread back from its latest messages, and names the open ask the first page leaves out",
    () =>
      Effect.gen(function* () {
        const agent = yield* openAgent;
        yield* post(agent, QUEUE);
        const asked = yield* onlyItem(agent);
        // Note that it takes about a second, because it must write one more message than a page's bound.
        const replies = INBOX_BOUNDS.MAX_MESSAGES_READ + 1;
        for (let reply = 1; reply <= replies; reply += 1) {
          yield* TestClock.adjust(Duration.seconds(1));
          yield* postInboxMessage(agent.userId, asked.id, {
            text: `Reply ${reply}.`,
            clientKey: randomUUID(),
          });
        }

        const latest = acceptedRead(yield* readThread(agent, input({ threadId: asked.id })));
        assert.ok(latest.older);
        const earlier = acceptedRead(
          yield* readThread(agent, input({ threadId: asked.id, before: latest.older })),
        );

        const texts = (messages: typeof latest.messages) => messages.map((line) => line.text);
        assert.deepEqual(
          texts(latest.messages),
          Array.from({ length: INBOX_BOUNDS.MAX_MESSAGES_READ }, (_, at) => `Reply ${at + 2}.`),
        );
        assert.equal(latest.openAsk?.text, QUEUE.body);
        assert.deepEqual(
          [texts(earlier.messages), earlier.older, earlier.openAsk],
          [[QUEUE.body, "Reply 1."], undefined, undefined],
        );
      }),
  );

  it.effect(
    "an agent whose starter left the thread's workspace posts on none of its threads there",
    () =>
      Effect.gen(function* () {
        const { workspaceId, ...agent } = yield* openAgent;
        yield* post(agent, SETTINGS);
        yield* leaveWorkspace(workspaceId, agent.userId);

        const refused = yield* post(agent, { key: SETTINGS.key, body: "Still here." });

        assert.equal(refusalOf(refused), INBOX_REFUSAL.NO_AGENT);
      }),
  );
});
