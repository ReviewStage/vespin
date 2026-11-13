import {
  AUTOMATION_FIRING,
  AUTOMATION_RUN_STATUS,
  FIRING_HANDS_OUTSIDE_WORDS,
} from "@repo/features/automation-wire";
import {
  MACHINE_COMMAND_KIND,
  MACHINE_COMMAND_MODE,
  type MachineCommand,
  type MachineCommandKind,
  type MachineCommandMode,
  type MachineCommandResult,
  machineCommandOfStored,
  machineCommandResultSchema,
  storedMachineCommandText,
} from "@repo/features/machine-command-wire";
import { MESSAGE_CHANNEL, MESSAGE_ROLE } from "@repo/wire";
import {
  and,
  asc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  notLike,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database, queryBuilder } from "../core/query.js";
import { agentTable } from "../schemas/agent.js";
import { member, user } from "../schemas/auth.js";
import { automationRun } from "../schemas/automation.js";
import { device } from "../schemas/device.js";
import {
  machineCommand,
  machineCommandDeviceListener,
  machineCommandListener,
} from "../schemas/machine-command.js";
import { conversations, messages, standingLine } from "../schemas/storage.js";
import { task } from "../schemas/task.js";
import { MESSAGE_SENDER, messageSenderSchema } from "../storage-vocabulary.js";
import { InstantColumnSchema } from "./columns.js";
import type { TaskStoreEffect } from "./task-store.js";
import type { ConversationTarget } from "./writer.js";

/**
 * machine-command-store.ts -- the commands an account's agents queued for its Mac, and when a Mac last listened for them.
 *
 * Every function is an effect over the ambient `SqlClient`, keyed by the
 * account, so no account claims, settles, or reads another's commands. A
 * command is claimed once, by the first Mac whose read names its kind and
 * takes it, and settled once, by a Mac after it was claimed; the call that
 * queued it reads the result and withdraws the row. A command queued for a
 * device is claimed by that device alone; one queued for none, by any Mac of
 * the account, whether it claims as a device or, on a build from before
 * devices claimed, as the account alone, which claims no device's command. A Mac that follows its
 * account's commands live subscribes to the unclaimed ones of its kinds
 * (`packages/service/src/live/reads/machine-commands.ts`) and claims each by its id.
 */

const CommandKeySchema = Schema.Struct({ userId: Schema.String, id: Schema.String });

const KindSchema = Schema.Literals(Object.values(MACHINE_COMMAND_KIND));

const KindsSchema = Schema.Array(KindSchema);

/** The device a read or a claim is made as; null for a Mac that claims as its account alone. */
const ClaimingDeviceSchema = Schema.NullOr(Schema.String);

/** A claimed row as the Mac is handed it: a shell command's text, and how long it may run. */
const ClaimedSchema = Schema.Struct({
  id: Schema.String,
  kind: KindSchema,
  command: Schema.String,
  timeoutSeconds: Schema.Number,
});

const upsertListener = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, now: Schema.Date }),
  execute: ({ userId, now }) =>
    Database.use((db) =>
      db
        .insert(machineCommandListener)
        .values({ userId, seenAt: now })
        .onConflictDoUpdate({ target: machineCommandListener.userId, set: { seenAt: now } }),
    ),
});

/** Moves the device's own listener, where the device is the account's. */
const upsertDeviceListener = SqlSchema.void({
  Request: Schema.Struct({ userId: Schema.String, deviceId: Schema.String, now: Schema.Date }),
  execute: ({ userId, deviceId, now }) =>
    Database.use((db) =>
      db
        .insert(machineCommandDeviceListener)
        .select((qb) =>
          qb
            .select({
              deviceId: sql<string>`${device.id}`.as("device_id"),
              seenAt: sql<Date>`${now}::timestamptz`.as("seen_at"),
            })
            .from(device)
            .where(and(eq(device.id, deviceId), eq(device.userId, userId))),
        )
        .onConflictDoUpdate({
          target: machineCommandDeviceListener.deviceId,
          set: { seenAt: now },
        }),
    ),
});

const findListener = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, since: Schema.Date }),
  Result: Schema.Struct({ userId: Schema.String }),
  execute: ({ userId, since }) =>
    Database.use((db) =>
      db
        .select({ userId: machineCommandListener.userId })
        .from(machineCommandListener)
        .where(
          and(eq(machineCommandListener.userId, userId), gte(machineCommandListener.seenAt, since)),
        ),
    ),
});

/** One command to queue, as a row keeps it. */
const QueuedRowSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  kind: KindSchema,
  command: Schema.String,
  timeoutSeconds: Schema.Number,
  now: Schema.Date,
});

/** Queues a command for any of the account's Macs. */
const insertCommand = SqlSchema.void({
  Request: QueuedRowSchema,
  execute: (row) =>
    Database.use((db) =>
      db.insert(machineCommand).values({
        id: row.id,
        userId: row.userId,
        kind: row.kind,
        command: row.command,
        timeoutSeconds: row.timeoutSeconds,
        queuedAt: row.now,
      }),
    ),
});

/** Queues a command for one device, where the device is the account's and not removed; the row it wrote, or none. */
const insertDeviceCommand = SqlSchema.findAll({
  Request: Schema.Struct({ ...QueuedRowSchema.fields, deviceId: Schema.String }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(machineCommand)
        .select((qb) =>
          qb
            .select({
              id: sql<string>`${row.id}::uuid`.as("id"),
              userId: sql<string>`${device.userId}`.as("user_id"),
              deviceId: sql<string>`${device.id}`.as("device_id"),
              kind: sql<MachineCommandKind>`${row.kind}`.as("kind"),
              command: sql<string>`${row.command}::text`.as("command"),
              timeoutSeconds: sql<number>`${row.timeoutSeconds}::integer`.as("timeout_seconds"),
              queuedAt: sql<Date>`${row.now}::timestamptz`.as("queued_at"),
            })
            .from(device)
            .where(
              and(
                eq(device.id, row.deviceId),
                eq(device.userId, row.userId),
                isNull(device.removedAt),
              ),
            ),
        )
        .returning({ id: machineCommand.id }),
    ),
});

/**
 * Whether a command still waits to be claimed by a read naming the kinds
 * given, made as the device given: of one of them, for that device or for
 * none, unclaimed, and queued at or after the instant given, so a command
 * no Mac took in time, or a row a call that died left behind, is never run
 * by a Mac that reads later, a Mac is never handed a kind it did not name,
 * and no machine is handed what was meant for another.
 */
function waiting(
  userId: string,
  deviceId: string | null,
  queuedSince: Date,
  kinds: readonly MachineCommandKind[],
): SQL | undefined {
  return and(
    eq(machineCommand.userId, userId),
    deviceId === null
      ? isNull(machineCommand.deviceId)
      : or(isNull(machineCommand.deviceId), eq(machineCommand.deviceId, deviceId)),
    inArray(machineCommand.kind, kinds),
    isNull(machineCommand.claimedAt),
    gte(machineCommand.queuedAt, queuedSince),
  );
}

const claimWaiting = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    deviceId: ClaimingDeviceSchema,
    queuedSince: Schema.Date,
    kinds: KindsSchema,
    now: Schema.Date,
  }),
  Result: ClaimedSchema,
  execute: ({ userId, deviceId, queuedSince, kinds, now }) =>
    Database.use((db) =>
      db
        .update(machineCommand)
        .set({ claimedAt: now })
        .where(waiting(userId, deviceId, queuedSince, kinds))
        .returning({
          id: machineCommand.id,
          kind: machineCommand.kind,
          command: machineCommand.command,
          timeoutSeconds: machineCommand.timeoutSeconds,
        }),
    ),
});

const claimOne = SqlSchema.findOneOption({
  Request: Schema.Struct({
    ...CommandKeySchema.fields,
    deviceId: ClaimingDeviceSchema,
    queuedSince: Schema.Date,
    kinds: KindsSchema,
    now: Schema.Date,
  }),
  Result: ClaimedSchema,
  execute: ({ userId, id, deviceId, queuedSince, kinds, now }) =>
    Database.use((db) =>
      db
        .update(machineCommand)
        .set({ claimedAt: now })
        .where(and(eq(machineCommand.id, id), waiting(userId, deviceId, queuedSince, kinds)))
        .returning({
          id: machineCommand.id,
          kind: machineCommand.kind,
          command: machineCommand.command,
          timeoutSeconds: machineCommand.timeoutSeconds,
        }),
    ),
});

const findWaiting = SqlSchema.findAll({
  Request: Schema.Struct({
    userId: Schema.String,
    deviceId: ClaimingDeviceSchema,
    queuedSince: Schema.Date,
    kinds: KindsSchema,
  }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, deviceId, queuedSince, kinds }) =>
    Database.use((db) =>
      db
        .select({ id: machineCommand.id })
        .from(machineCommand)
        .where(waiting(userId, deviceId, queuedSince, kinds))
        .orderBy(asc(machineCommand.queuedAt)),
    ),
});

const writeResult = SqlSchema.findAll({
  Request: Schema.Struct({ ...CommandKeySchema.fields, result: machineCommandResultSchema }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id, result }) =>
    Database.use((db) =>
      db
        .update(machineCommand)
        .set({ result })
        .where(
          and(
            eq(machineCommand.id, id),
            eq(machineCommand.userId, userId),
            isNotNull(machineCommand.claimedAt),
            isNull(machineCommand.result),
          ),
        )
        .returning({ id: machineCommand.id }),
    ),
});

const writeRecording = SqlSchema.findAll({
  Request: Schema.Struct({ ...CommandKeySchema.fields, recording: Schema.Uint8Array }),
  Result: Schema.Struct({ id: Schema.String }),
  execute: ({ userId, id, recording }) =>
    Database.use((db) =>
      db
        .update(machineCommand)
        .set({ recording })
        .where(
          and(
            eq(machineCommand.id, id),
            eq(machineCommand.userId, userId),
            eq(machineCommand.kind, MACHINE_COMMAND_KIND.COMPUTER),
            isNotNull(machineCommand.claimedAt),
            isNull(machineCommand.result),
          ),
        )
        .returning({ id: machineCommand.id }),
    ),
});

const findRecording = SqlSchema.findOneOption({
  Request: CommandKeySchema,
  Result: Schema.Struct({ recording: Schema.Uint8Array }),
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({ recording: machineCommand.recording })
        .from(machineCommand)
        .where(
          and(
            eq(machineCommand.id, id),
            eq(machineCommand.userId, userId),
            isNotNull(machineCommand.recording),
          ),
        ),
    ),
});

const findResult = SqlSchema.findOneOption({
  Request: CommandKeySchema,
  Result: Schema.Struct({ result: machineCommandResultSchema }),
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .select({ result: machineCommand.result })
        .from(machineCommand)
        .where(
          and(
            eq(machineCommand.id, id),
            eq(machineCommand.userId, userId),
            isNotNull(machineCommand.result),
          ),
        ),
    ),
});

/** A child conversation, which a worker runs in, read through to the root its lines were sent to. */
const parent = alias(conversations, "parent");

/** The agent that sent a line, read for whose it is. */
const sendingAgent = alias(agentTable, "sending_agent");

/** The root's developer lines before one of them, read for whether it is the first, the prompt the agent was started on. */
const earlierLine = alias(messages, "earlier_line");

/** The agent the root conversation is of, read for whether it was started on a prompt or a description at all, and what fired the automation's run that started it. */
const startedAgent = alias(agentTable, "started_agent");

/** The firings whose run hands its agent words its owner did not write beside the automation's prompt. */
const OUTSIDE_FIRINGS = Object.values(AUTOMATION_FIRING).filter(
  (kind) => FIRING_HANDS_OUTSIDE_WORDS[kind],
);

/** That the automation's run that started the root's agent was fired by words its owner did not write, as the agent's origin keeps it whatever becomes of the automation. */
const STARTED_ON_OUTSIDE_WORDS = inArray(
  sql<string | null>`${startedAgent.automationOrigin} -> 'firing' ->> 'kind'`,
  OUTSIDE_FIRINGS,
);

/**
 * That a run fired by words its owner did not write was handed to the root's
 * agent: the run that started it, or one sent to it, which is claimed for
 * the agent before its line is sent. A run that failed handed it nothing,
 * since a send refused withdraws its line, so only one that started counts.
 * Note that the runs go with their automation, so this holds only while it
 * stands.
 */
const HANDED_OUTSIDE_RUN = exists(
  queryBuilder
    .select({ id: automationRun.id })
    .from(automationRun)
    .where(
      and(
        or(
          eq(automationRun.claimedAgentId, startedAgent.id),
          eq(automationRun.agentId, startedAgent.id),
        ),
        eq(automationRun.status, AUTOMATION_RUN_STATUS.STARTED),
        inArray(sql<string>`${automationRun.firing} ->> 'kind'`, OUTSIDE_FIRINGS),
      ),
    ),
);

/** What an automation's, GitHub's, or a Slack message's line says of whether it carries words its owner did not write: `true` or `false`, or null on a line kept before it said. */
const LINE_OUTSIDE_WORDS = sql<string | null>`${messages.metadata} ->> 'outside_words'`;

/** The channel a line says carried it. */
const LINE_CHANNEL = sql<string | null>`${messages.metadata} ->> 'channel'`;

/** The logins of GitHub's Apps, every one of which ends with `[bot]`, which no person's login can spell. */
const APP_LOGINS = "%[bot]";

/** That a GitHub line carries words a person chose, what a review or a comment says or a review's inline comments, which its metadata keeps only where there are some, by no App. */
const GITHUB_LINE_HAS_PERSONS_WORDS = and(
  or(
    isNotNull(sql`${messages.metadata} ->> 'words'`),
    isNotNull(sql`${messages.metadata} -> 'comments'`),
  ),
  notLike(sql<string>`${messages.metadata} ->> 'by'`, APP_LOGINS),
);

/** A line another account put into a conversation: what kind of sender put it there, none for a line kept before senders were, when, and whether the transcript shows it, which a line its hand-over withdrew it does not. */
const ForeignLineSchema = Schema.Struct({
  sender: Schema.NullOr(messageSenderSchema),
  createdAt: InstantColumnSchema,
  shown: Schema.Boolean,
});

/**
 * The first line of the conversation's root, or the root's own where it is one,
 * that another account put there: a member other than the owner, a former
 * member, or an agent that is not the owner's own or is gone. An
 * automation's line counts where what fired its run put words its owner did
 * not write beside the automation's prompt: a webhook's body, an
 * integration's event, or a GitHub event's (`FIRING_HANDS_OUTSIDE_WORDS`),
 * as the line says itself (`outside_words`); a line kept before it said
 * counts where the run that started the agent was so fired, or a run so
 * fired was sent to it while its automation stands. A schedule's run and a
 * "Run now" carry the owner's prompt alone. A Slack message's line counts
 * where its prompt carries the thread's earlier messages anyone but its
 * writer wrote (`outside_words`, `slack/slack-agent-starts.ts`); a later
 * message from another member counts as any teammate's line does. A GitHub line counts where it carries a review's or a
 * comment's words by a person other than the owner, which on a public
 * repository anyone may write, as the line says itself (`outside_words`,
 * `github/agent-wakes.ts`); an App's words never count. A line kept before
 * it said counts where it carries a person's words, whoever wrote them,
 * since nothing kept says whose GitHub account wrote them. A failed check's
 * line carries none. A developer's
 * line written before senders were kept, a `user` row with no sender, counts
 * too, because nothing says whose it was; all but the root's first where the
 * agent was started on a prompt or a description, which that first line is, written
 * untagged by the retired runtime's relay for every agent started before the start wrote it
 * with its sender (`coder-host/start.ts`), unless the automation's run that
 * started the agent was fired by words its owner did not write, which that
 * first line holds. A blank agent was started on
 * none, so its first line is whoever's first steer, and counts. A line its hand-over withdrew counts as
 * well, unlike in every read that shows a line, because its runtime may still hand
 * it to a turn (`writer.ts`'s `withdrawUntakenLine`).
 */
const findForeignLine = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: ForeignLineSchema,
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({
          sender: messages.sender,
          createdAt: messages.createdAt,
          shown: sql<boolean>`${standingLine(messages)}`,
        })
        .from(conversations)
        .leftJoin(parent, eq(parent.id, conversations.parentConversationId))
        .innerJoin(
          messages,
          eq(messages.conversationId, sql`coalesce(${parent.id}, ${conversations.id})`),
        )
        .leftJoin(sendingAgent, eq(sendingAgent.id, messages.senderAgentId))
        .leftJoin(
          startedAgent,
          eq(startedAgent.conversationId, sql`coalesce(${parent.id}, ${conversations.id})`),
        )
        .where(
          and(
            eq(conversations.id, conversationId),
            eq(conversations.userId, userId),
            or(
              and(
                eq(messages.sender, MESSAGE_SENDER.MEMBER),
                or(isNull(messages.senderUserId), ne(messages.senderUserId, userId)),
              ),
              and(
                eq(messages.sender, MESSAGE_SENDER.AGENT),
                or(isNull(sendingAgent.userId), ne(sendingAgent.userId, userId)),
              ),
              and(
                eq(messages.sender, MESSAGE_SENDER.AUTOMATION),
                or(
                  eq(LINE_OUTSIDE_WORDS, "true"),
                  and(isNull(LINE_OUTSIDE_WORDS), or(STARTED_ON_OUTSIDE_WORDS, HANDED_OUTSIDE_RUN)),
                ),
              ),
              and(
                eq(messages.sender, MESSAGE_SENDER.MEMBER),
                eq(LINE_CHANNEL, MESSAGE_CHANNEL.SLACK),
                eq(LINE_OUTSIDE_WORDS, "true"),
              ),
              and(
                eq(messages.sender, MESSAGE_SENDER.GITHUB),
                or(
                  eq(LINE_OUTSIDE_WORDS, "true"),
                  and(isNull(LINE_OUTSIDE_WORDS), GITHUB_LINE_HAS_PERSONS_WORDS),
                ),
              ),
              and(
                eq(messages.role, MESSAGE_ROLE.USER),
                isNull(messages.sender),
                or(
                  and(isNull(startedAgent.prompt), isNull(startedAgent.descriptionSnapshot)),
                  STARTED_ON_OUTSIDE_WORDS,
                  exists(
                    db
                      .select({ seq: earlierLine.seq })
                      .from(earlierLine)
                      .where(
                        and(
                          eq(earlierLine.conversationId, messages.conversationId),
                          eq(earlierLine.role, MESSAGE_ROLE.USER),
                          lt(earlierLine.seq, messages.seq),
                        ),
                      ),
                  ),
                ),
              ),
            ),
          ),
        )
        .orderBy(asc(messages.seq))
        .limit(1),
    ),
});

/** The agent whose conversation, or whose worker's, is asked after, read for its task. */
const ownAgent = alias(agentTable, "own_agent");

/**
 * The account whose Mac the conversation's commands run on: the assignee of
 * the task its agent works on, or else the agent's starter, read through a
 * worker's conversation to the agent it was delegated from.
 */
const findMacOwner = SqlSchema.findOneOption({
  Request: Schema.Struct({ userId: Schema.String, conversationId: Schema.String }),
  Result: Schema.Struct({
    userId: Schema.String,
    taskId: Schema.NullOr(Schema.String),
    workspaceId: Schema.NullOr(Schema.String),
    targetDeviceId: Schema.NullOr(Schema.String),
    deviceId: Schema.NullOr(Schema.String),
  }),
  execute: ({ userId, conversationId }) =>
    Database.use((db) =>
      db
        .select({
          userId: sql<string>`coalesce(${member.userId}, ${ownAgent.userId})`,
          taskId: task.id,
          workspaceId: task.organizationId,
          targetDeviceId: ownAgent.targetDeviceId,
          deviceId: ownAgent.deviceId,
        })
        .from(conversations)
        .leftJoin(parent, eq(parent.id, conversations.parentConversationId))
        .innerJoin(
          ownAgent,
          eq(ownAgent.conversationId, sql`coalesce(${parent.id}, ${conversations.id})`),
        )
        .leftJoin(task, eq(task.id, ownAgent.taskId))
        // Note that an assignee who left the task's workspace hands it no Mac, so their machine never runs its agents' commands.
        .leftJoin(
          member,
          and(eq(member.organizationId, task.organizationId), eq(member.userId, task.assigneeId)),
        )
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, userId)))
        .limit(1),
    ),
});

/** The machines of the accounts given, as a call is routed to one: each with its owner's name, its command mode, and when it last listened for commands as a device, the latest first. */
const findCommandMachines = SqlSchema.findAll({
  Request: Schema.Struct({ userIds: Schema.Array(Schema.String) }),
  Result: Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    userId: Schema.String,
    ownerName: Schema.String,
    commandMode: Schema.NullOr(Schema.Literals(Object.values(MACHINE_COMMAND_MODE))),
    seenAt: Schema.NullOr(InstantColumnSchema),
  }),
  execute: ({ userIds }) =>
    Database.use((db) =>
      db
        .select({
          id: device.id,
          name: device.name,
          userId: device.userId,
          ownerName: user.name,
          commandMode: device.commandMode,
          seenAt: machineCommandDeviceListener.seenAt,
        })
        .from(device)
        .innerJoin(user, eq(user.id, device.userId))
        .leftJoin(
          machineCommandDeviceListener,
          eq(machineCommandDeviceListener.deviceId, device.id),
        )
        .where(and(inArray(device.userId, [...userIds]), isNull(device.removedAt)))
        .orderBy(sql`${machineCommandDeviceListener.seenAt} desc nulls last`, asc(device.name)),
    ),
});

const deleteCommand = SqlSchema.void({
  Request: CommandKeySchema,
  execute: ({ userId, id }) =>
    Database.use((db) =>
      db
        .delete(machineCommand)
        .where(and(eq(machineCommand.id, id), eq(machineCommand.userId, userId))),
    ),
});

/**
 * Records that a Mac of the account is listening now, for shell commands,
 * which every Mac runs, and, where it listens as a device of the account,
 * that the device is.
 */
export function markMachineListening(userId: string, deviceId?: string): TaskStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.andThen(
      upsertListener({ userId, now }),
      deviceId === undefined ? Effect.void : upsertDeviceListener({ userId, deviceId, now }),
    ),
  );
}

/** Whether a Mac of the account listened at or after the instant given. */
export function macListeningSince(userId: string, since: Date): TaskStoreEffect<boolean> {
  return Effect.map(findListener({ userId, since }), Option.isSome);
}

/**
 * Whether anyone but the conversation's owner has put words into it: a line
 * another member sent, one an agent that is not the owner's own sent, one an
 * automation sent with words its owner did not write, such as a webhook's
 * body, one GitHub sent with a review or a comment by a person other than
 * the owner, or one whose sender was never kept past the opening prompt, in the conversation
 * or, for a worker's, in the agent's it was delegated from. Note that a line
 * the service itself sends, such as a wakeup or a failed check, is not
 * counted, because no other account wrote it.
 */
export function heardFromAnotherAccount(target: ConversationTarget): TaskStoreEffect<boolean> {
  return Effect.map(findForeignLine(target), Option.isSome);
}

/**
 * The account whose Mac the conversation's `run_on_mac` runs on: the
 * assignee of its agent's task, while a member of its workspace, whoever
 * started the agent and whoever has written to it since, or the
 * conversation's own account where its task is assigned to no one or to a
 * member who left, or it is no agent's.
 */
export function machineOwnerOf(target: ConversationTarget): TaskStoreEffect<string> {
  return Effect.map(machineRoutingOf(target), (routing) => routing.userId);
}

/** What a conversation's commands are routed by: whose Mac runs them (`machineOwnerOf`), the task and workspace of its agent, the agent's default machine, and the machine it runs on itself; each none for a conversation that is no agent's. */
export interface MachineRouting {
  readonly userId: string;
  readonly taskId: string | null;
  readonly workspaceId: string | null;
  readonly targetDeviceId: string | null;
  readonly deviceId: string | null;
}

/** What the conversation's commands are routed by (`MachineRouting`). */
export function machineRoutingOf(target: ConversationTarget): TaskStoreEffect<MachineRouting> {
  return Effect.map(
    findMacOwner(target),
    Option.getOrElse(() => ({
      userId: target.userId,
      taskId: null,
      workspaceId: null,
      targetDeviceId: null,
      deviceId: null,
    })),
  );
}

/** One machine a call may be routed to: its id and name, its owner, its command mode (none for a machine whose app never joined), and when it last listened for commands as a device (none where it never did). */
export interface CommandMachine {
  readonly id: string;
  readonly name: string;
  readonly userId: string;
  readonly ownerName: string;
  readonly commandMode: MachineCommandMode | null;
  readonly seenAt: Date | null;
}

/** The machines of the accounts given, none removed, the one that listened last first; nothing for no account. Note that the caller decides whose machines a call may reach; this reads only those. */
export function commandMachinesOf(
  userIds: readonly string[],
): TaskStoreEffect<readonly CommandMachine[]> {
  return userIds.length === 0 ? Effect.succeed([]) : findCommandMachines({ userIds });
}

/**
 * Queues one command for the account's Mac, under the id its caller minted:
 * for the device given alone, or for any of its Macs where none is given.
 * Answers whether it was queued: a device that is not the account's, or
 * was removed, queues nothing, since no Mac could ever claim it, and its caller says so at once
 * rather than waiting out its result.
 */
export function queueMachineCommand(
  userId: string,
  queued: MachineCommand,
  deviceId?: string,
): TaskStoreEffect<boolean> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => {
    const row = {
      id: queued.id,
      userId,
      kind: queued.kind,
      command: storedMachineCommandText(queued),
      timeoutSeconds: queued.timeoutSeconds,
      now,
    };

    return deviceId === undefined
      ? Effect.as(insertCommand(row), true)
      : Effect.map(insertDeviceCommand({ ...row, deviceId }), (rows) => rows.length > 0);
  });
}

/**
 * Whether any command of the account, of the kinds given, queued at or
 * after `queuedSince` waits to be claimed by the device given, or by a Mac
 * that claims as the account alone where none is, which is what a held
 * read looks at.
 */
export function machineCommandsWaiting(
  userId: string,
  queuedSince: Date,
  kinds: readonly MachineCommandKind[],
  deviceId?: string,
): TaskStoreEffect<boolean> {
  return Effect.map(
    findWaiting({ userId, deviceId: deviceId ?? null, queuedSince, kinds }),
    (rows) => rows.length > 0,
  );
}

/**
 * Claims every command of the account, of the kinds given, queued at or
 * after `queuedSince` that waits, for the Mac whose read this is: as the
 * device given, or as the account alone where none is.
 */
export function claimMachineCommands(
  userId: string,
  queuedSince: Date,
  kinds: readonly MachineCommandKind[],
  deviceId?: string,
): TaskStoreEffect<readonly MachineCommand[]> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      claimWaiting({ userId, deviceId: deviceId ?? null, queuedSince, kinds, now }),
      (rows) =>
        rows.flatMap((row) => {
          const command = machineCommandOfStored(row);

          return command === undefined ? [] : [command];
        }),
    ),
  );
}

/**
 * Claims one command of the account by its id, for the Mac that asked, as
 * the device given or as the account alone where none is, where it is of
 * the kinds given, is for that device or for none, still waits, and was
 * queued at or after `queuedSince`; none where another Mac took it first,
 * it was meant for another machine, its call withdrew it, or it waited too
 * long.
 */
export function claimMachineCommand(
  userId: string,
  id: string,
  queuedSince: Date,
  kinds: readonly MachineCommandKind[],
  deviceId?: string,
): TaskStoreEffect<Option.Option<MachineCommand>> {
  return Effect.flatMap(DateTime.nowAsDate, (now) =>
    Effect.map(
      claimOne({ userId, id, deviceId: deviceId ?? null, queuedSince, kinds, now }),
      Option.flatMap((row) => Option.fromUndefinedOr(machineCommandOfStored(row))),
    ),
  );
}

/** Keeps a claimed command's result; false where the account holds no such command claimed and unsettled. */
export function settleMachineCommand(
  userId: string,
  id: string,
  result: MachineCommandResult,
): TaskStoreEffect<boolean> {
  return Effect.map(writeResult({ userId, id, result }), (rows) => rows.length > 0);
}

/**
 * Keeps a stopped recording's video beside a claimed, unsettled computer
 * command, over any it kept before; false where the account holds no such
 * command.
 */
export function keepMachineCommandRecording(
  userId: string,
  id: string,
  recording: Uint8Array,
): TaskStoreEffect<boolean> {
  return Effect.map(writeRecording({ userId, id, recording }), (rows) => rows.length > 0);
}

/** The video a Mac posted for a command it stopped a recording for; nothing where it posted none. */
export function machineCommandRecording(
  userId: string,
  id: string,
): TaskStoreEffect<Option.Option<Uint8Array>> {
  return Effect.map(
    findRecording({ userId, id }),
    Option.map(({ recording }) => recording),
  );
}

/** A command's result once a Mac settled it; nothing while it waits or runs. */
export function machineCommandResult(
  userId: string,
  id: string,
): TaskStoreEffect<Option.Option<MachineCommandResult>> {
  return Effect.map(
    findResult({ userId, id }),
    Option.map(({ result }) => result),
  );
}

/** Withdraws a command, settled or not, once its call stops waiting on it. */
export function withdrawMachineCommand(userId: string, id: string): TaskStoreEffect<void> {
  return deleteCommand({ userId, id });
}
