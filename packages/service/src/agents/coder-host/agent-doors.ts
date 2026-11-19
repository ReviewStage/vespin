/**
 * agent-doors.ts -- the doors every runtime's call of one of our tools by a coding agent goes through: the agent the conversation is, then the tool.
 *
 * A native harness's runner reaches them through our MCP server
 * (`../tool-catalog/catalog.ts`), as it reaches the inbox's
 * own door (`inbox-door.ts`). Nothing here imports a sandbox,
 * because the web function that serves the MCP server bundles none:
 * a door that reads a file the agent names is handed the door to its
 * sandbox, and one that reaches an agent's session or the store's writer is handed the
 * seams it reads (`AgentDoorSeams`).
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  type Agent,
  agentTaskId,
  hasRepository,
  readAgentHeaderOfConversation,
  readAgentOfConversation,
} from "@repo/database/models/agent-store";
import { readTaskHeader } from "@repo/database/models/task-store";
import type { StoreWriter } from "@repo/database/models/writer";
import { DESCRIPTION_COMMENT_ACTOR } from "@repo/features/description-comment-wire";
import type { InboxAttachmentRef } from "@repo/features/inbox-attachment-link";
import { PAGE_SHOWER } from "@repo/features/page-wire";
import { Effect, Option, Result } from "effect";
import type { HttpClient } from "effect/http";
import type { UnparsedWireValue, WireRecord } from "../../core.js";
import type { GitHubApp } from "../../github/github-app.js";
import { logStoreFailure } from "../../http/store-failure.js";
import { type InboxStoreEffect, readInboxItemHome } from "../../inbox/inbox-store.js";
import {
  COMMENT_TOOL_REFUSAL,
  type CommentToolName,
  commentedTaskOf,
  commentToolRejected,
  runCommentTool,
} from "../../tasks/comment-tools.js";
import { runShowPage, SHOW_PAGE_REFUSAL, showPageRejected } from "../../tasks/page-tool.js";
import {
  lookedTaskOf,
  lookedThreadPictureOf,
  type PdfWrite,
  PICTURE_LOOK_REFUSAL,
  PICTURE_LOOK_STATUS,
  type PictureLookResult,
  pictureNotLooked,
  runLookAtPicture,
  runLookAtThreadPicture,
} from "../../tasks/picture-look.js";
import type { AdmittedConversation } from "../sessions/admitted-conversation.js";
import { taskIdOfInput } from "../task-ref.js";
import { CODER_REFUSAL } from "./bounds.js";
import {
  DESCRIPTION_EDIT_REFUSAL,
  type DescriptionEditResult,
  descriptionEditRejected,
  editedTaskOf,
  recordDescriptionEdit,
} from "./description-edit.js";
import type { InboxSandboxDoor } from "./inbox-image.js";
import {
  openPullRequest,
  PULL_REQUEST_UNAVAILABLE,
  type PullRequestToolResult,
  pullRequestRejected,
} from "./pull-request.js";
import type { SummaryModelOf } from "./replay-summary.js";
import { runShowMedia } from "./show-media.js";

/** What the doors that reach an agent's session or the store's writer read of the deployment, as the web function serving the MCP server builds them (`../workspace-mcp/door-seams.ts`). */
export interface AgentDoorSeams {
  /** The writer over the coding agent's tool set, composed once per instance. */
  readonly writer: () => Effect.Effect<StoreWriter>;
  /** How an agent this one starts from another summarizes the steps its replay cannot keep, as the Start route's does; none leaves them out. */
  readonly summaryModel?: SummaryModelOf;
}

/** The agent a read found, or the refusal that the conversation is none. */
function foundOrRefused<A>(found: Option.Option<A>) {
  return Option.match(found, {
    onNone: () => Result.fail(CODER_REFUSAL.NO_AGENT),
    onSome: (agent) => Result.succeed(agent),
  });
}

/** The coding agent the admitted conversation is, whole, or the refusal that it is none. */
function agentOfConversation(admitted: AdmittedConversation) {
  return Effect.map(
    readAgentOfConversation(admitted.target.userId, admitted.target.conversationId),
    foundOrRefused,
  );
}

/** The header of the coding agent the admitted conversation is, for a tool that needs no more of it, or the refusal that it is none. */
function agentHeaderOfConversation(admitted: AdmittedConversation) {
  return Effect.map(
    readAgentHeaderOfConversation(admitted.target.userId, admitted.target.conversationId),
    foundOrRefused,
  );
}

/**
 * The task a call names by its id or key, where it stands in the agent's own
 * workspace, as the member whose turn this is reaches it; or why not, in the
 * tool's words: a key read nowhere else (`taskIdOfRef`), and an id of no task
 * there as the tool's own `noTask`. Note that a task of another workspace the
 * member is also in is none of the agent's, as `read_task` reads one, and
 * answers as no task at all.
 */
function agentTaskOf(
  admitted: AdmittedConversation,
  agent: Pick<Agent, "organizationId">,
  written: string,
  words: { readonly opening: string; readonly noTask: string },
) {
  return Effect.gen(function* () {
    const named = yield* taskIdOfInput(
      admitted.caller,
      agent.organizationId,
      { opening: words.opening, field: "taskId" },
      written,
    );

    if (Result.isFailure(named)) return named;

    const task = Option.filter(
      yield* readTaskHeader(admitted.caller, named.success),
      (header) => header.workspaceId === agent.organizationId,
    );

    return Option.isSome(task) ? named : Result.fail(words.noTask);
  });
}

/** Takes one `edit_description` call's notes into the description of the task it names, given how many notes the turn has taken already, its pictures read through the sandbox door given. */
export function runAgentEditDescription(
  admitted: AdmittedConversation,
  input: UnparsedWireValue,
  takenInTurn: number,
  sandbox: InboxSandboxDoor,
): Effect.Effect<DescriptionEditResult, never, DatabaseServices> {
  return Effect.gen(function* () {
    const found = yield* agentOfConversation(admitted);

    if (Result.isFailure(found)) return descriptionEditRejected(found.failure);
    const taskId = editedTaskOf(input);

    if (taskId === undefined)
      return descriptionEditRejected(DESCRIPTION_EDIT_REFUSAL.NO_TASK_NAMED);

    const task = yield* agentTaskOf(admitted, found.success, taskId, {
      opening: "Not saved",
      noTask: DESCRIPTION_EDIT_REFUSAL.NO_TASK,
    });

    if (Result.isFailure(task)) return descriptionEditRejected(task.failure);
    const agentId = found.success.id;
    // The description is written as the member whose turn this is, whoever started the agent.
    const binding = { userId: admitted.caller, taskId: task.success };

    return yield* recordDescriptionEdit(binding, { agentId }, input, takenInTurn, sandbox);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() =>
      Effect.succeed(descriptionEditRejected(DESCRIPTION_EDIT_REFUSAL.UNAVAILABLE)),
    ),
  );
}

/**
 * A look at a thread's picture as the agent: one of a thread of its own
 * workspace that its starter may read, as `read_thread` reads the thread;
 * refused for a thread of another workspace, as for none.
 */
function lookInThread(
  agent: Pick<Agent, "userId" | "organizationId">,
  named: InboxAttachmentRef,
): InboxStoreEffect<PictureLookResult> {
  return Effect.gen(function* () {
    const home = yield* readInboxItemHome(agent.userId, named.itemId);

    if (Option.isNone(home) || home.value.workspaceId !== agent.organizationId) {
      return pictureNotLooked(PICTURE_LOOK_REFUSAL.ELSEWHERE);
    }

    return yield* runLookAtThreadPicture(agent.userId, named);
  });
}

/** Where a description's PDF is written in the agent's machine, under its attachments folder: by its attachment's id, which is a UUID, so no two PDFs share a name and none names a path of its own. */
function descriptionPdfName(attachmentId: string): string {
  return `description/${attachmentId}.pdf`;
}

/**
 * A description's PDF written into the agent's machine through the sandbox
 * door given, answering where it stands; refused where the door writes
 * nothing or the write failed, a Mac away among them, which the model may
 * try again.
 */
function pdfWriteThrough(sandbox: InboxSandboxDoor): PdfWrite {
  return ({ attachmentId, bytes }) =>
    Effect.tryPromise(async () => {
      const door = await sandbox();

      if (door.writeFile === undefined) throw new Error("the sandbox door writes no file");

      return door.writeFile({ name: descriptionPdfName(attachmentId), contents: bytes });
    }).pipe(
      Effect.map((path): PictureLookResult => ({ status: PICTURE_LOOK_STATUS.WRITTEN, path })),
      Effect.catch(() => Effect.succeed(pictureNotLooked(PICTURE_LOOK_REFUSAL.PDF_UNWRITTEN))),
    );
}

/** A PDF of another task's description, which no agent reads, refused before anything is written. */
const pdfElsewhere: PdfWrite = () =>
  Effect.succeed(pictureNotLooked(PICTURE_LOOK_REFUSAL.PDF_ELSEWHERE));

/**
 * Runs one `look_at_picture` call: one of the pictures of the description
 * its address names, in the agent's workspace, read as the member whose turn
 * this is, or of a thread's message there, read as the agent reads the
 * thread. A PDF of the description is written into the agent's machine
 * through the sandbox door given, and only one of its own task's: a picture
 * of another task's description is something to look at, but its PDF is
 * read whole by the agent's own tools, so it stays with its task.
 */
export function runAgentLookAtPicture(
  admitted: AdmittedConversation,
  input: UnparsedWireValue,
  descriptionsOn: boolean,
  sandbox: InboxSandboxDoor,
): Effect.Effect<PictureLookResult, never, DatabaseServices> {
  return Effect.gen(function* () {
    const found = yield* agentOfConversation(admitted);

    if (Result.isFailure(found)) return pictureNotLooked(found.failure);
    const inThread = lookedThreadPictureOf(input);

    if (inThread !== undefined) return yield* lookInThread(found.success, inThread);
    const taskId = lookedTaskOf(input);

    if (taskId === undefined) return pictureNotLooked(PICTURE_LOOK_REFUSAL.UNREADABLE);

    // A description's picture is none an agent is told of where its workspace has Task descriptions off.
    if (!descriptionsOn) return pictureNotLooked(PICTURE_LOOK_REFUSAL.ELSEWHERE);

    // The address names its task by id, so the only miss is a task out of the agent's workspace.
    const task = yield* agentTaskOf(admitted, found.success, taskId, {
      opening: "Not looked at",
      noTask: PICTURE_LOOK_REFUSAL.ELSEWHERE,
    });

    if (Result.isFailure(task)) return pictureNotLooked(PICTURE_LOOK_REFUSAL.ELSEWHERE);

    const writePdf = taskId === found.success.taskId ? pdfWriteThrough(sandbox) : pdfElsewhere;

    // The description is read as the member whose turn this is, as `editDescription` writes it.
    return yield* runLookAtPicture({ userId: admitted.caller, taskId }, input, writePdf);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(pictureNotLooked(PICTURE_LOOK_REFUSAL.UNAVAILABLE))),
  );
}

/** Opens the agent's pull request (`pull-request.ts`): as its developer where it writes as them, as the App otherwise. */
export function runAgentOpenPullRequest(
  admitted: AdmittedConversation,
  input: UnparsedWireValue,
): Effect.Effect<
  PullRequestToolResult,
  never,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  return Effect.gen(function* () {
    const found = yield* agentOfConversation(admitted);

    if (Result.isFailure(found)) return pullRequestRejected(found.failure);

    // Note that the catalog refuses the call of an agent with no repository at its `REPOSITORY` gate (`../tool-catalog/gates.ts`), so this only narrows the row it read since.
    if (!hasRepository(found.success)) return pullRequestRejected(CODER_REFUSAL.NO_REPOSITORY);

    return yield* openPullRequest(admitted.target, found.success, input);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(pullRequestRejected(PULL_REQUEST_UNAVAILABLE))),
  );
}

/**
 * Runs one call of a comment tool (`tasks/comment-tools.ts`) on the description of
 * the task it names, or one of its pages, in the agent's workspace, as the
 * member whose turn it is, written under the agent; the description's threads only
 * where the agent's standing has Task descriptions open, as its workspace has them (`../tool-catalog/gates.ts`).
 */
export function runAgentComment(
  admitted: AdmittedConversation,
  name: CommentToolName,
  input: UnparsedWireValue,
  descriptionsOn: boolean,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return Effect.gen(function* () {
    const found = yield* agentOfConversation(admitted);

    if (Result.isFailure(found)) return commentToolRejected(found.failure);
    const taskId = commentedTaskOf(input);

    if (taskId === undefined) return commentToolRejected(COMMENT_TOOL_REFUSAL.NO_TASK_NAMED);

    const task = yield* agentTaskOf(admitted, found.success, taskId, {
      opening: "Not run",
      noTask: COMMENT_TOOL_REFUSAL.NO_TASK,
    });

    if (Result.isFailure(task)) return commentToolRejected(task.failure);
    const agentId = found.success.id;

    // The comments are read and written as the member whose turn this is, as `editDescription` writes the description.
    const writer = {
      actor: DESCRIPTION_COMMENT_ACTOR.AGENT,
      userId: admitted.caller,
      agentId,
    } as const;

    // A page's threads stand whatever the workspace's Task descriptions; the description's are left out while it is off.
    return yield* runCommentTool(name, { taskId: task.success, writer, descriptionsOn }, input);
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(commentToolRejected(COMMENT_TOOL_REFUSAL.UNAVAILABLE))),
  );
}

/** Runs one `show_page` call on the agent's task, a page's path read from its sandbox through the door given. */
export function runAgentShowPage(
  admitted: AdmittedConversation,
  input: UnparsedWireValue,
  sandbox: InboxSandboxDoor,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return Effect.gen(function* () {
    const found = yield* agentHeaderOfConversation(admitted);

    if (Result.isFailure(found)) return showPageRejected(found.failure);
    const { id: agentId } = found.success;

    // Note that the catalog refuses the call of an agent on no task at its `TASK` gate (`../tool-catalog/gates.ts`), so the agent read here stands on one.
    const binding = {
      userId: admitted.target.userId,
      taskId: agentTaskId(found.success),
      sandbox,
    };

    return yield* runShowPage(binding, input, {
      kind: PAGE_SHOWER.AGENT,
      agentId,
    });
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(showPageRejected(SHOW_PAGE_REFUSAL.UNAVAILABLE))),
  );
}

/** Runs one `show_media` call: the pictures read from the agent's sandbox through the door given and kept beside its transcript. */
export function runAgentShowMedia(
  admitted: AdmittedConversation,
  input: UnparsedWireValue,
  sandbox: InboxSandboxDoor,
): Effect.Effect<WireRecord, never, DatabaseServices> {
  return runShowMedia({ target: admitted.target, sandbox }, input);
}
