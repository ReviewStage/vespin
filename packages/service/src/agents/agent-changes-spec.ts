/**
 * agent-changes-spec.ts -- `read_agent_changes` as a model is shown it: its input, its bound, and its words.
 *
 * Kept apart from its run (`agent-changes-tool.ts`), which reads the
 * pull request through `agents-procedures.ts`, because that module imports
 * the tool catalog, which declares this tool while it loads: a spec here
 * imports nothing of the service's that leads back to it.
 */

import { AGENT_TOOL } from "@repo/features/agent-tools";
import { CHANGED_FILE_STATUS, CHECK_SUMMARY, PULL_REQUEST_STATE } from "@repo/features/agent-wire";
import { describeWire } from "@repo/wire/effect";
import { Schema } from "effect";
import { wireUuidSchema } from "../core.js";

/** The most characters of one file's patch a read answers, about ten thousand tokens: the rest is counted, never sent. */
export const PATCH_READ_CHARS = 40_000;

/** A read names the agent and, at most, one file whose patch to answer beside the list. */
export const READ_AGENT_CHANGES_INPUT = Schema.Struct({
  agentId: describeWire(
    wireUuidSchema,
    `The agent's id, as ${AGENT_TOOL.LIST_AGENTS} answered it.`,
  ),
  path: Schema.optionalKey(
    describeWire(
      Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(4_096)),
      "One file the pull request changes, by its path from the repository's root as files " +
        "names it, to read its patch as well; leave it out to list the files alone.",
    ),
  ),
});

/** What a read of an agent's changes answers, which the coding agent's and the member MCP's descriptions share. */
export const READ_AGENT_CHANGES_WORDS =
  "as its Pull request and Changes tabs show it: the repository it works in, the branch it " +
  "pushed, and the pull request from it as GitHub holds it now, with its number, title, link, " +
  `state (${Object.values(PULL_REQUEST_STATE).join(", ")}), the head commit it stands on ` +
  `(headSha), which a merge names, its checks (${Object.values(CHECK_SUMMARY).join(", ")}), ` +
  "the lines it adds and removes, who opened it, its reviewers and where each stands, its " +
  "reviews that said something, and every file it changes in the order GitHub lists them, " +
  `each with what became of it (${Object.values(CHANGED_FILE_STATUS).join(", ")}) and the ` +
  "lines it adds and removes, truncated true where the list was cut short; the pull request " +
  "is null where the agent opened none yet. Name a path among its files to read that file's " +
  `patch as well, cut on a line at ${PATCH_READ_CHARS} characters with how many were left ` +
  "out, or why GitHub carried none. It only reads: the agent is not told.";

/** `read_agent_changes` as a coding agent is offered it, which reads any agent of its workspace's pull request, its own among them. */
export const READ_AGENT_CHANGES_TOOL = {
  name: AGENT_TOOL.READ_AGENT_CHANGES,
  description:
    "Read what an agent of your workspace published, by its id, on any task and started by " +
    `any member, your own agent id included, ${READ_AGENT_CHANGES_WORDS}`,
  inputSchema: READ_AGENT_CHANGES_INPUT,
} as const;
