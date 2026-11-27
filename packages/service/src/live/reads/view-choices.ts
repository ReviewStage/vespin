/**
 * view-choices.ts -- the account's view choices, as a live read bound: its one statement, the table it reads, and the topic that wakes it.
 *
 * Every view choice the account keeps (`VIEW_CHOICES_READ`): the account's
 * own, and each of a workspace it is still a member of, so one kept in a
 * workspace it left reads as nothing. The statement reads the account's own
 * rows alone, so no account reads another's choices, a teammate's included.
 * It is woken on the account's topic by a choice made, changed, or
 * forgotten (`accountViewChoiceSync`).
 */

import { queryBuilder } from "@repo/database/core/query";
import { workspaceReachableBy } from "@repo/database/models/workspace-store";
import { accountViewChoice } from "@repo/database/schemas";
import { TOPIC } from "@repo/database/sync/notification";
import { accountViewChoiceSync } from "@repo/database/sync/tables";
import { VIEW_CHOICES_READ } from "@repo/features/view-choice-live";
import { and, eq, isNull, or } from "drizzle-orm";
import { bindLiveRead, columnAs, liveRowsStatement } from "../live-read-binding.js";

export const viewChoicesRead = bindLiveRead(VIEW_CHOICES_READ, {
  reads: [accountViewChoiceSync],
  topics: ({ userId }) => [[TOPIC.ACCOUNT, userId]],
  statements: ({ userId }) => ({
    choices: liveRowsStatement(
      VIEW_CHOICES_READ.parts.choices,
      {
        columns: {
          id: accountViewChoice.id,
          key: accountViewChoice.key,
          workspaceId: accountViewChoice.organizationId,
          // Note that a value is read past where this build cannot read it, as a newer build may keep a key it does not know.
          value: columnAs<unknown>(accountViewChoice.value),
        },
      },
      (selection) =>
        queryBuilder
          .select(selection)
          .from(accountViewChoice)
          .where(
            and(
              eq(accountViewChoice.userId, userId),
              or(
                isNull(accountViewChoice.organizationId),
                workspaceReachableBy(userId, accountViewChoice.organizationId),
              ),
            ),
          ),
    ),
  }),
});
