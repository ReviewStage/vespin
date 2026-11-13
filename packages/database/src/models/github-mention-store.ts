import { and, desc, eq, isNull } from "drizzle-orm";
import { DateTime, Effect, Option, Schema } from "effect";
import { SqlSchema } from "effect/sql";
import { Database } from "../core/query.js";
import { GITHUB_INSTALLATION_STATUS } from "../github-installation-vocabulary.js";
import { account, member } from "../schemas/auth.js";
import { githubInstallation } from "../schemas/github-installation.js";
import { githubMentionAgent } from "../schemas/github-mention.js";
import type { TaskStoreEffect } from "./task-store.js";

/**
 * github-mention-store.ts -- who a mention of our GitHub App's bot is from, and the agents such a mention started.
 *
 * A comment that names the App's bot is read as the member who wrote it:
 * the member of the workspace the delivery's installation stands for whose
 * linked GitHub account is the comment's author, by GitHub's own id for it
 * (`githubMentionMember`). An installation stands for exactly one
 * workspace (`github_installation`'s key), and only one GitHub still runs
 * answers (`githubMentionWorkspace`). An agent a mention started is kept with where the comment stood
 * (`recordGitHubMentionAgent`), and its first settled turn claimed once for
 * the reply posted there (`claimGitHubMentionTurn`). Every function is an
 * effect over the ambient `SqlClient`.
 */

/** Better Auth's provider id for a GitHub account row. */
const GITHUB_PROVIDER_ID = "github";

const MentionPlaceSchema = Schema.Struct({
  repository: Schema.String,
  number: Schema.Number,
});

/** Where the comment that started an agent stood: the repository as GitHub spelled it, and the issue's or pull request's number. */
export type GitHubMentionPlace = typeof MentionPlaceSchema.Type;

const findInstallationWorkspace = SqlSchema.findOneOption({
  Request: Schema.Number,
  Result: Schema.Struct({ organizationId: Schema.String }),
  execute: (installationId) =>
    Database.use((db) =>
      db
        .select({ organizationId: githubInstallation.organizationId })
        .from(githubInstallation)
        .where(
          and(
            eq(githubInstallation.installationId, installationId),
            eq(githubInstallation.status, GITHUB_INSTALLATION_STATUS.ACTIVE),
          ),
        ),
    ),
});

const findMentionMember = SqlSchema.findOneOption({
  Request: Schema.Struct({ organizationId: Schema.String, githubUserId: Schema.String }),
  Result: Schema.Struct({ userId: Schema.String }),
  execute: ({ organizationId, githubUserId }) =>
    Database.use((db) =>
      db
        .select({ userId: member.userId })
        .from(member)
        .innerJoin(account, eq(account.userId, member.userId))
        .where(
          and(
            eq(member.organizationId, organizationId),
            eq(account.providerId, GITHUB_PROVIDER_ID),
            eq(account.accountId, githubUserId),
          ),
        )
        .orderBy(desc(account.updatedAt))
        .limit(1),
    ),
});

const insertMentionAgent = SqlSchema.void({
  Request: Schema.Struct({
    agentId: Schema.String,
    userId: Schema.String,
    repository: Schema.String,
    number: Schema.Number,
    now: Schema.Date,
  }),
  execute: (row) =>
    Database.use((db) =>
      db
        .insert(githubMentionAgent)
        .values({
          agentId: row.agentId,
          userId: row.userId,
          repository: row.repository,
          number: row.number,
          createdAt: row.now,
        })
        .onConflictDoNothing(),
    ),
});

const claimMentionTurn = SqlSchema.findOneOption({
  Request: Schema.Struct({ agentId: Schema.String, turnId: Schema.String }),
  Result: MentionPlaceSchema,
  execute: ({ agentId, turnId }) =>
    Database.use((db) =>
      db
        .update(githubMentionAgent)
        .set({ postedTurnId: turnId })
        .where(
          and(eq(githubMentionAgent.agentId, agentId), isNull(githubMentionAgent.postedTurnId)),
        )
        .returning({
          repository: githubMentionAgent.repository,
          number: githubMentionAgent.number,
        }),
    ),
});

/** The workspace the installation stands for, while GitHub still runs it; nothing for one no workspace connected, or one removed or suspended. */
export function githubMentionWorkspace(
  installationId: number,
): TaskStoreEffect<Option.Option<string>> {
  return Effect.map(findInstallationWorkspace(installationId), (found) =>
    Option.map(found, (row) => row.organizationId),
  );
}

/** The member of the workspace whose linked GitHub account GitHub names by the id given, the latest linked where more than one is; nothing where none is. */
export function githubMentionMember(
  organizationId: string,
  githubUserId: string,
): TaskStoreEffect<Option.Option<string>> {
  return Effect.map(findMentionMember({ organizationId, githubUserId }), (found) =>
    Option.map(found, (row) => row.userId),
  );
}

/** Keeps the agent a mention started, with where the comment stood; one kept already stands. */
export function recordGitHubMentionAgent(
  started: { readonly agentId: string; readonly userId: string } & GitHubMentionPlace,
): TaskStoreEffect<void> {
  return Effect.flatMap(DateTime.nowAsDate, (now) => insertMentionAgent({ ...started, now }));
}

/** Where the agent's first settled turn is posted, claimed for the turn as it is read; nothing for an agent no mention started, or one whose first turn was posted. */
export function claimGitHubMentionTurn(
  agentId: string,
  turnId: string,
): TaskStoreEffect<Option.Option<GitHubMentionPlace>> {
  return claimMentionTurn({ agentId, turnId });
}
