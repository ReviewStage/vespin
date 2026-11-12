import { Schema } from "effect";
import { CONTEXT_WINDOW } from "./agent-wire.js";
import { type ChaptersPick, chaptersModelFrom } from "./chapters-model-choice.js";
import {
  LIVE_MODE,
  LIVE_PARAM,
  type LiveReadAnswer,
  type LiveRowOf,
  liveRead,
  liveRows,
  ORDER,
  orderedLiveRows,
} from "./live-read.js";
import { LIVE_READ, LIVE_USER_QUERY } from "./live-wire.js";
import {
  AGENT_DEFAULT_CHOICE,
  agentFallbackChoice,
  type CatalogModel,
  type ModelChoice,
} from "./models-wire.js";
import { HOSTED_SERVICE_PATH } from "./service-paths.js";
import { countedNumber } from "./service-wire.js";
import { SOUND_CLIP_SLOT, type Sound, type SoundClipSlot } from "./sound-clip-wire.js";

/**
 * account-preferences-live.ts -- the account's preferences row as the host follows it over the service's held poll: the read declared, and the choices every surface draws from it.
 *
 * The service answers one statement, the account's own row as stored, or
 * none for an account that stored nothing: the coding agents' default as
 * its three columns stand, the chapters model, and whether our Slack bot
 * writes the account; and beside it the sounds the account keeps of its
 * own, by id, name, and hash, and which of them each of its two sounds
 * plays. Each is read here as the preferences snapshot reads
 * it (`account-store.ts`'s `snapshotOf` calls `storedAgentChoice`), so the
 * live read and `/api/account/preferences` never disagree. Where the account
 * stored no default, the default a surface draws is worked out from the
 * models it is offered by the service's own rule (`agentDefaultOf`).
 */

/**
 * The account's preferences as the host follows them: the account's own
 * row, none for an account that stored nothing; the sounds it keeps of its
 * own, never their bytes; and which of them each of its two sounds plays. Note that the
 * context window and the chapters model are read as text, because a value a
 * later build adds or an older one dropped reads as the default rather than
 * failing the row. The row has no id of its own, since it is the account's
 * one, so it is keyed and ordered by its first column, which orders one row
 * as it stands.
 */
export const ACCOUNT_PREFERENCES_READ = liveRead({
  name: LIVE_READ.ACCOUNT_PREFERENCES,
  path: HOSTED_SERVICE_PATH.LIVE_ACCOUNT_PREFERENCES,
  params: { [LIVE_USER_QUERY]: LIVE_PARAM.USER },
  mode: LIVE_MODE.SNAPSHOT,
  parts: {
    preferences: liveRows({
      row: Schema.Struct({
        agentModel: Schema.NullOr(Schema.String),
        agentEffort: Schema.NullOr(Schema.String),
        agentContextWindow: Schema.NullOr(Schema.String),
        chaptersModel: Schema.NullOr(Schema.String),
        slackNotifications: Schema.NullOr(Schema.Boolean),
      }),
      key: "agentModel",
      order: [["agentModel", ORDER.ASC]],
    }),
    sounds: liveRows({
      row: Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        sha256: Schema.String,
        createdAt: countedNumber,
      }),
      key: "id",
      order: [
        ["createdAt", ORDER.ASC],
        ["id", ORDER.ASC],
      ],
    }),
    soundChoices: liveRows({
      row: Schema.Struct({ slot: Schema.String, soundId: Schema.String }),
      key: "slot",
      order: [["slot", ORDER.ASC]],
    }),
  },
});

export type AccountPreferencesLiveAnswer = LiveReadAnswer<typeof ACCOUNT_PREFERENCES_READ>;

/** The account's row as the statement delivers it, each column as stored and null where never chosen. */
export type AccountPreferencesLiveRow = LiveRowOf<
  typeof ACCOUNT_PREFERENCES_READ.parts.preferences
>;

/** One of the account's own sounds as the read delivers it: its id, its name, its hash, and when it was added. */
export type AccountSoundLiveRow = LiveRowOf<typeof ACCOUNT_PREFERENCES_READ.parts.sounds>;

/** Which sound one of the account's two sounds plays, as the read delivers it, the slot read as text. */
export type AccountSoundChoiceLiveRow = LiveRowOf<
  typeof ACCOUNT_PREFERENCES_READ.parts.soundChoices
>;

/** The sounds the account keeps of its own, in the order it added them, and the one each of its two sounds plays, none for a sound that plays none. */
export interface AccountSounds {
  readonly list: readonly Sound[];
  readonly choices: Readonly<Record<SoundClipSlot, string | undefined>>;
}

/** The account's own sounds as the read delivers them; a choice of a slot no build lists any more is passed over. */
export function accountSoundsOfLiveRows(
  sounds: readonly AccountSoundLiveRow[],
  choices: readonly AccountSoundChoiceLiveRow[],
): AccountSounds {
  const of = (slot: SoundClipSlot) => choices.find((row) => row.slot === slot)?.soundId;

  return {
    list: orderedLiveRows(ACCOUNT_PREFERENCES_READ.parts.sounds, sounds).map(
      ({ id, name, sha256 }) => ({ id, name, sha256 }),
    ),
    choices: {
      [SOUND_CLIP_SLOT.FINISH]: of(SOUND_CLIP_SLOT.FINISH),
      [SOUND_CLIP_SLOT.ASK]: of(SOUND_CLIP_SLOT.ASK),
    },
  };
}

/** The account's choices as the row holds them, each read as the preferences snapshot reads it. */
export interface AccountPreferencesLive {
  /** The coding agents' default the account stored; none until it chooses, where a surface draws the fallback (`agentDefaultOf`). */
  readonly agent: ModelChoice | undefined;
  /** What a Generate chapters the account presses runs on; Haiku until the account chooses. */
  readonly chaptersModel: ChaptersPick;
  /** Whether our Slack bot writes the account the threads that wait on it; on until the account chooses. */
  readonly slackNotifications: boolean;
  /** The sounds the account keeps of its own, each named by the hash of its bytes so a client fetches it again only once it changed, and the one each of its two sounds plays. */
  readonly sounds: AccountSounds;
}

/** The models as a read of them stands, as the host holds it: its answer once it answered, and whether it said it could not before it ever had. */
interface OfferedModelsRead {
  readonly rows?: {
    readonly models: readonly Pick<CatalogModel, "id" | "provider" | "credentialMissing">[];
  };
  readonly failed?: true;
}

/**
 * The coding agents' default a row holds. It stands only with both halves
 * written; one half alone is no choice the catalog could have accepted, so
 * it reads as none stored, as a row never written does. The context window
 * is named only where it is the standard one, as the wire names it.
 */
export function storedAgentChoice(
  row: Pick<AccountPreferencesLiveRow, "agentModel" | "agentEffort" | "agentContextWindow">,
): ModelChoice | undefined {
  if (row.agentModel === null || row.agentEffort === null) return undefined;
  const standard = row.agentContextWindow === CONTEXT_WINDOW.STANDARD;

  return {
    model: row.agentModel,
    effort: row.agentEffort,
    ...(standard ? { contextWindow: CONTEXT_WINDOW.STANDARD } : undefined),
  };
}

/** The account's choices as its row holds them; each choice's default where the account stored no row. */
export function accountPreferencesOfLiveRows(
  rows: readonly AccountPreferencesLiveRow[],
  sounds: AccountSounds,
): AccountPreferencesLive {
  const [row] = rows;

  return {
    agent: row === undefined ? undefined : storedAgentChoice(row),
    // Note that a stored model no build lists any more reads as Haiku, as a row never written does.
    chaptersModel: chaptersModelFrom(row?.chaptersModel),
    // Note that a switch never chosen reads as on, as the Slack bot reads it (`slackNotificationsOn`).
    slackNotifications: row?.slackNotifications !== false,
    sounds,
  };
}

/**
 * The default every surface draws, as the preferences snapshot answers it
 * (`account-procedures.ts`'s `snapshotAgent`): the stored choice where there
 * is one; otherwise the fallback the models the account is offered mark as
 * paid for (`agentFallbackChoice`), once they answered; otherwise
 * Anthropic's, where the models could not be read, as the service answers
 * when its catalog cannot be. None while nothing is stored and the models
 * have not answered yet.
 */
export function agentDefaultOf(
  stored: ModelChoice | undefined,
  models: OfferedModelsRead,
): ModelChoice | undefined {
  if (stored !== undefined) return stored;

  if (models.rows !== undefined) return agentFallbackChoice(models.rows.models);

  return models.failed === true ? AGENT_DEFAULT_CHOICE : undefined;
}
