import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { INTEGRATION_PROVIDER } from "@repo/features/integration-wire";
import { eq } from "drizzle-orm";
import { DateTime, Effect, Option, Redacted, Result } from "effect";
import { TestClock } from "effect/testing";
import { Database } from "../../core/query.js";
import { INTEGRATION_ROW_STATUS } from "../../integration-vocabulary.js";
import { member as memberTable, organization, user } from "../../schemas/auth.js";
import { integrationConnection } from "../../schemas/integration.js";
import { slackInstallation } from "../../schemas/slack-installation.js";
import { getTestDB, leaveWorkspace } from "../../testing/index.js";
import { parseKeyRing } from "../provider-key-seal.js";
import {
  deleteSlackBotToken,
  deleteSlackInstallation,
  deleteSlackTeamInstallations,
  linkSlackInstallation,
  openSlackBot,
  recordSlackMemberLookup,
  saveSlackBotToken,
  slackMemberByEmail,
  slackMemberLookup,
  slackMemberOf,
  slackStartRepositories,
  slackUnresolvedConnections,
  workspaceSlackInstallation,
  writeSlackChannelRepository,
  writeSlackDefaultRepository,
} from "../slack-installation-store.js";

/**
 * The Slack team a workspace's bot is connected to, over a real dialect:
 * each workspace reads only its own installation and its own members' Slack
 * ids, emails, and own Slack accounts, and a Disconnect forgets the ids it
 * kept.
 *
 * Synthetic accounts, workspaces, keys, tokens, and Slack ids throughout.
 */

const ring = Result.getOrThrow(
  parseKeyRing(Redacted.make(`1:${randomBytes(32).toString("base64")}`)),
);

const openAccount = Effect.gen(function* () {
  const db = yield* Database;
  const id = `user-${randomUUID()}`;
  yield* db.insert(user).values({ id, name: "Test User", email: `${id}@app.test` });

  return id;
});

const openWorkspace = Effect.gen(function* () {
  const db = yield* Database;
  const id = randomUUID();
  yield* db.insert(organization).values({
    id,
    name: "Test Workspace",
    slug: `workspace-${id}`,
    createdAt: yield* DateTime.nowAsDate,
  });

  return id;
});

it.layer(getTestDB())("the Slack installation store", (it) => {
  it.effect(
    "a workspace reads only its own installation and its own members' Slack ids, never one who left",
    () =>
      Effect.gen(function* () {
        const member = yield* openAccount;
        const ours = yield* openWorkspace;
        const theirs = yield* openWorkspace;
        yield* (yield* Database).insert(memberTable).values({
          id: randomUUID(),
          organizationId: ours,
          userId: member,
          createdAt: yield* DateTime.nowAsDate,
        });

        yield* linkSlackInstallation({
          organizationId: ours,
          teamId: "T0001",
          teamName: "Ours",
          userId: member,
        });
        yield* (yield* Database).insert(integrationConnection).values({
          id: randomUUID(),
          userId: member,
          provider: INTEGRATION_PROVIDER.SLACK,
          connectSubject: member,
          connectionName: INTEGRATION_PROVIDER.SLACK,
          status: INTEGRATION_ROW_STATUS.CONNECTED,
        });
        const unresolved = yield* slackUnresolvedConnections(ours);
        const theirsUnresolved = yield* slackUnresolvedConnections(theirs);
        yield* recordSlackMemberLookup(ours, member, "U0001");

        assert.deepEqual(
          yield* workspaceSlackInstallation(ours),
          Option.some({ teamId: "T0001", teamName: "Ours" }),
        );
        assert.equal(Option.isNone(yield* workspaceSlackInstallation(theirs)), true);
        assert.deepEqual(unresolved, [{ userId: member, connectSubject: member }]);
        assert.deepEqual(theirsUnresolved, []);
        assert.deepEqual(yield* slackUnresolvedConnections(ours), []);
        assert.deepEqual(
          Option.map(yield* slackMemberLookup(ours, member), (found) => found.slackUserId),
          Option.some("U0001"),
        );
        assert.equal(Option.isNone(yield* slackMemberLookup(theirs, member)), true);
        assert.deepEqual(yield* slackMemberOf(ours, "T0001", "U0001"), Option.some(member));
        assert.equal(Option.isNone(yield* slackMemberOf(theirs, "T0001", "U0001")), true);
        assert.equal(Option.isNone(yield* slackMemberOf(ours, "T0002", "U0001")), true);
        const email = `${member}@APP.test`;
        assert.deepEqual(yield* slackMemberByEmail(ours, email), Option.some(member));
        assert.equal(Option.isNone(yield* slackMemberByEmail(theirs, email)), true);
        assert.equal(Option.isNone(yield* deleteSlackInstallation(theirs)), true);
        assert.equal(Option.isSome(yield* workspaceSlackInstallation(ours)), true);
        yield* leaveWorkspace(ours, member);
        assert.equal(
          Option.isNone(yield* slackMemberOf(ours, "T0001", "U0001")),
          true,
          "a member who left is no longer found by their kept Slack id",
        );
      }),
  );

  it.effect("a workspace opens only its own bot token, which no other workspace's row opens", () =>
    Effect.gen(function* () {
      const member = yield* openAccount;
      const ours = yield* openWorkspace;
      const theirs = yield* openWorkspace;
      const db = yield* Database;

      for (const organizationId of [ours, theirs]) {
        yield* linkSlackInstallation({
          organizationId,
          teamId: "T0001",
          teamName: "T",
          userId: member,
        });
      }

      const bot = {
        teamId: "T0001",
        botUserId: "U0BOT",
        botId: "B0BOT",
        appId: "A0APP",
        scopes: ["chat:write", "users:read"],
        enterpriseId: null,
        isEnterpriseInstall: false,
      };

      const wrongTeam = yield* saveSlackBotToken(ring, {
        ...bot,
        organizationId: ours,
        teamId: "T0002",
        token: Redacted.make("xoxb-wrong-team"),
      });

      const saved = yield* saveSlackBotToken(ring, {
        ...bot,
        organizationId: ours,
        token: Redacted.make("xoxb-ours"),
      });

      const opened = yield* openSlackBot(ring, ours);
      const theirsBefore = yield* openSlackBot(ring, theirs);

      // Copy our sealed token onto their row, which its seal must refuse.
      const [row] = yield* db
        .select()
        .from(slackInstallation)
        .where(eq(slackInstallation.organizationId, ours));

      yield* db
        .update(slackInstallation)
        .set({
          botKeyVersion: row?.botKeyVersion,
          botSealedDataKey: row?.botSealedDataKey,
          botSealedToken: row?.botSealedToken,
          botUserId: row?.botUserId,
          botScopes: row?.botScopes,
          botId: row?.botId,
          appId: row?.appId,
        })
        .where(eq(slackInstallation.organizationId, theirs));

      assert.equal(wrongTeam, false);
      assert.equal(saved, true);
      assert.equal(Option.isNone(theirsBefore), true);
      assert.deepEqual(
        Option.map(opened, (open) => ({ ...open, token: Redacted.value(open.token) })),
        Option.some({ ...bot, token: "xoxb-ours" }),
      );
      assert.equal(Option.isNone(yield* openSlackBot(ring, theirs)), true);
    }),
  );

  it.effect("deleting the bot token forgets it and leaves the installation standing", () =>
    Effect.gen(function* () {
      const member = yield* openAccount;
      const workspace = yield* openWorkspace;
      yield* linkSlackInstallation({
        organizationId: workspace,
        teamId: "T0001",
        teamName: "Team",
        userId: member,
      });
      yield* saveSlackBotToken(ring, {
        organizationId: workspace,
        teamId: "T0001",
        token: Redacted.make("xoxb-token"),
        botUserId: "U0BOT",
        botId: "B0BOT",
        appId: "A0APP",
        scopes: ["chat:write"],
        enterpriseId: null,
        isEnterpriseInstall: false,
      });

      const deleted = yield* deleteSlackBotToken(workspace);

      assert.equal(deleted, true);
      assert.equal(Option.isNone(yield* openSlackBot(ring, workspace)), true);
      assert.equal(Option.isSome(yield* workspaceSlackInstallation(workspace)), true);
      assert.equal(yield* deleteSlackBotToken(workspace), false);
    }),
  );

  it.effect(
    "a team's uninstall deletes its installations linked before it, never one linked or relinked after or another team's",
    () =>
      Effect.gen(function* () {
        const member = yield* openAccount;

        const [before, after, other] = [
          yield* openWorkspace,
          yield* openWorkspace,
          yield* openWorkspace,
        ];

        const link = { teamName: "Team", userId: member };
        // A team of this case's own, since the store is shared with the cases above.
        const teamId = `T-${randomUUID()}`;

        yield* linkSlackInstallation({ ...link, organizationId: before, teamId });
        yield* linkSlackInstallation({ ...link, organizationId: after, teamId });
        yield* linkSlackInstallation({ ...link, organizationId: other, teamId: "T0002" });
        yield* recordSlackMemberLookup(before, member, "U0001");
        const uninstalledAt = yield* DateTime.nowAsDate;

        yield* TestClock.adjust("1 minute");
        // The same team linked again, as a reinstall does before the uninstall is heard.
        yield* linkSlackInstallation({ ...link, organizationId: after, teamId });

        assert.deepEqual(yield* deleteSlackTeamInstallations(teamId, uninstalledAt), [before]);
        assert.equal(Option.isNone(yield* slackMemberLookup(before, member)), true);
        assert.equal(Option.isSome(yield* workspaceSlackInstallation(after)), true);
        assert.equal(Option.isSome(yield* workspaceSlackInstallation(other)), true);
      }),
  );

  it.effect("a disconnect, or a link to another team, forgets every member's Slack id", () =>
    Effect.gen(function* () {
      const member = yield* openAccount;
      const workspace = yield* openWorkspace;
      const link = { organizationId: workspace, teamName: "Team", userId: member };

      yield* linkSlackInstallation({ ...link, teamId: "T0001" });
      yield* recordSlackMemberLookup(workspace, member, null);
      yield* linkSlackInstallation({ ...link, teamId: "T0002" });
      const afterMove = yield* slackMemberLookup(workspace, member);
      yield* recordSlackMemberLookup(workspace, member, "U0002");
      const disconnected = yield* deleteSlackInstallation(workspace);

      assert.equal(Option.isNone(afterMove), true);
      assert.equal(Option.isSome(disconnected), true);
      assert.equal(Option.isNone(yield* slackMemberLookup(workspace, member)), true);
    }),
  );

  it.effect(
    "a workspace reads only its own Slack repositories, and a channel's cleared one is gone",
    () =>
      Effect.gen(function* () {
        const member = yield* openAccount;
        const ours = yield* openWorkspace;
        const theirs = yield* openWorkspace;

        for (const organizationId of [ours, theirs]) {
          yield* linkSlackInstallation({
            organizationId,
            teamId: "T0001",
            teamName: "Team",
            userId: member,
          });
        }

        yield* writeSlackDefaultRepository(ours, "Acme/Relay");
        yield* writeSlackChannelRepository(ours, "C0001", "Acme/Api");
        yield* writeSlackChannelRepository(ours, "C0002", "Acme/Web");
        yield* writeSlackChannelRepository(ours, "C0002", null);

        assert.deepEqual(yield* slackStartRepositories(ours), {
          defaultRepository: "Acme/Relay",
          channels: [{ channelId: "C0001", repository: "Acme/Api" }],
        });
        assert.deepEqual(yield* slackStartRepositories(theirs), {
          defaultRepository: null,
          channels: [],
        });
      }),
  );
});
