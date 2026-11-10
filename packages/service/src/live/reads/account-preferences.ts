/**
 * account-preferences.ts -- the account's preferences' live read bound: its three statements, the tables they read, and the topic that wakes it.
 *
 * The account's own row, as stored: the coding agents' default as its three
 * columns stand, the chapters model, and whether our Slack bot writes the
 * account, each null where never chosen, which the reader reads as the
 * snapshot does (`ACCOUNT_PREFERENCES_READ`). No row for an account that
 * stored none. Beside it, the sounds the account keeps of its own, by id,
 * name, and hash, never their bytes, so a client fetches one again only once
 * its hash moved; and which of them each of its two sounds plays.
 *
 * It is woken on the account's topic by a write to any column a view
 * reads, a sound added, renamed, removed, or chosen among them. Note that a Start with Runs
 * on, an enroll, and a register write only the row's runs-on pick, and a settings push that changes nothing
 * writes only its instant; the capture ignores both, so none of them wakes
 * this read or the account's other reads.
 */

import { queryBuilder } from "@repo/database/core/query";
import { accountSound, accountSoundChoice } from "@repo/database/schemas/account-sound";
import { accountPreference } from "@repo/database/schemas/preferences";
import { TOPIC } from "@repo/database/sync/notification";
import {
  accountPreferenceSync,
  accountSoundChoiceSync,
  accountSoundSync,
} from "@repo/database/sync/tables";
import { ACCOUNT_PREFERENCES_READ } from "@repo/features/account-preferences-live";
import { eq } from "drizzle-orm";
import { bindLiveRead, liveRowsStatement } from "../live-read-binding.js";

export const accountPreferencesRead = bindLiveRead(ACCOUNT_PREFERENCES_READ, {
  reads: [accountPreferenceSync, accountSoundSync, accountSoundChoiceSync],
  topics: ({ userId }) => [[TOPIC.ACCOUNT, userId]],
  statements: ({ userId }) => ({
    preferences: liveRowsStatement(
      ACCOUNT_PREFERENCES_READ.parts.preferences,
      {
        ordered: false,
        columns: {
          agentModel: accountPreference.agentModel,
          agentEffort: accountPreference.agentEffort,
          agentContextWindow: accountPreference.agentContextWindow,
          chaptersModel: accountPreference.chaptersModel,
          slackNotifications: accountPreference.slackNotifications,
        },
      },
      (selection) =>
        queryBuilder
          .select(selection)
          .from(accountPreference)
          .where(eq(accountPreference.userId, userId)),
    ),
    sounds: liveRowsStatement(
      ACCOUNT_PREFERENCES_READ.parts.sounds,
      {
        ordered: false,
        columns: { id: accountSound.id, name: accountSound.name, sha256: accountSound.sha256 },
        instants: { createdAt: accountSound.createdAt },
      },
      (selection) =>
        queryBuilder.select(selection).from(accountSound).where(eq(accountSound.userId, userId)),
    ),
    soundChoices: liveRowsStatement(
      ACCOUNT_PREFERENCES_READ.parts.soundChoices,
      {
        ordered: false,
        columns: { slot: accountSoundChoice.slot, soundId: accountSoundChoice.soundId },
      },
      (selection) =>
        queryBuilder
          .select(selection)
          .from(accountSoundChoice)
          .where(eq(accountSoundChoice.userId, userId)),
    ),
  }),
});
