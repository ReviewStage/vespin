/**
 * account-preferences.ts -- the signed-in account's preferences snapshot, read and written: the one operation `account.preferences` and `account.writePreferences` and the member MCP server's `update_preferences` all run.
 *
 * The snapshot is the settings preferences the desktop syncs, the account's
 * own parts each of its own, the coding agents' default model, effort, and
 * context window, the chapters model, and the experiments
 * (`account-procedures.ts` says what each is). A write carries any of them,
 * each read by its owner, and answers the snapshot as it then stands, or
 * the refusal a procedure answers: a part that does not read as one, or a
 * coding-agent choice the catalog does not offer the account or no
 * credential of theirs pays for, as a bad request, and a catalog or store
 * that cannot be read as unavailable.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import type {
  AccountPreferencesRow,
  AccountPreferencesWrite,
  AccountPreferencesWritten,
  AccountSeamEffect,
} from "@repo/database/models/account-store";
import type { TaskStoreFailure } from "@repo/database/models/task-store";
import type { accountPreferencesWriteSchema } from "@repo/features/account-wire";
import { contextWindowSchema } from "@repo/features/agent-wire";
import { CHAPTERS_MODEL_DEFAULT, isChaptersModel } from "@repo/features/chapters-model-choice";
import type { ModelChoice } from "@repo/features/models-wire";
import { AGENT_DEFAULT_CHOICE } from "@repo/features/models-wire";
import { failureKind } from "@repo/runtime/effect";
import {
  accountPreferencesFromWire,
  accountPreferencesParts,
  experimentChoicesFrom,
  NO_EXPERIMENTS,
  type OnboardingSurvey,
  onboardingSurveyFrom,
  onboardingSurveyStored,
  ownPreferenceFromWire,
} from "@repo/settings";
import type { UnparsedWireValue } from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Effect, Result, Schema } from "effect";
import { unconnectedProviders } from "../agents/coder-host/agent-runtime-choice.js";
import { accountModelChoices } from "../agents/coder-host/start.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
} from "../http/http-effect.js";
import {
  type AccountFastOffer,
  acceptedModelChoice,
  type ModelCatalog,
  providerModelOf,
} from "../providers/model-catalog.js";
import { onboardingSurveyAnswered } from "./onboarding-survey-response.js";

/** The store the preferences are read from and written to, and the account's fast offer a coding-agent choice is checked against. */
export interface AccountPreferenceSeams {
  readPreferences: (userId: string) => AccountSeamEffect<AccountPreferencesRow | undefined>;
  /** Which fast versions the account is offered, by which its coding-agent choice may name one (`offeredToAccount`). */
  accountFastOffer: (
    userId: string,
  ) => Effect.Effect<AccountFastOffer, TaskStoreFailure, DatabaseServices | ModelCatalog>;
  /** Writes each part the write carries and answers the snapshot as it then stands, with the transaction it committed in. */
  writePreferences: (
    userId: string,
    write: AccountPreferencesWrite,
  ) => AccountSeamEffect<AccountPreferencesWritten>;
}

/** A coding-agent choice as a write names it; the catalog decides whether it is one. */
const ModelChoiceSchema = Schema.Struct({
  model: Schema.String,
  effort: Schema.String,
  contextWindow: Schema.optionalKey(contextWindowSchema),
});

const readModelChoice = readEither(ModelChoiceSchema);

/**
 * The coding-agent default the snapshot answers: the account's stored one,
 * or where it stored none the fallback a Start naming no model runs on
 * (`accountModelChoices`), so Settings and every chip draw what that Start
 * would run. Note that a catalog or a store that cannot be read meanwhile
 * answers Anthropic's fallback rather than refusing the settings beside it,
 * because a Start is refused as unavailable then anyway.
 */
const snapshotAgent = (
  userId: string,
  row: AccountPreferencesRow | undefined,
): Effect.Effect<ModelChoice, never, DatabaseServices | ModelCatalog> =>
  row?.agent === undefined
    ? accountModelChoices(userId).pipe(
        Effect.map((choices) => choices.defaultChoice),
        Effect.catch(() => Effect.succeed(AGENT_DEFAULT_CHOICE)),
      )
    : Effect.succeed(row.agent);

/**
 * The snapshot as the account answers it, the coding-agent default as
 * `snapshotAgent` reads it, the preferences' instant beside it where the
 * preferences were ever written, and the link choice as a part of its own
 * where the account made one.
 */
function snapshotAnswer(row: AccountPreferencesRow | undefined, agent: ModelChoice) {
  const updatedAt = row?.updatedAt;

  return {
    ...accountPreferencesParts(row?.preferences ?? {}),
    agent,
    chaptersModel: row?.chaptersModel ?? CHAPTERS_MODEL_DEFAULT,
    experiments: row?.experiments ?? NO_EXPERIMENTS,
    ...(updatedAt === undefined ? undefined : { updatedAt: updatedAt.getTime() }),
  };
}

/**
 * The write's coding-agent part, as the catalog accepts it for the
 * account (`offeredToAccount`): a choice it does not offer is a bad request,
 * as is one that moves the default to a model of a provider no credential
 * of the account's pays for (`unconnectedProviders`), and a catalog the
 * instance cannot read is an outage the caller may retry. A write that keeps
 * the model the default names now, as an Effort or a Context does, is taken
 * whatever pays for it, because the default it changes was already that
 * model: the fallback a new account reads, or a default whose credential
 * has since gone. A Fast flip names another model, so it is checked.
 */
const acceptedAgentChoice = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: AccountPreferenceSeams,
  userId: string,
  value: UnparsedWireValue,
): Effect.fn.Return<ModelChoice, HostedRefusal, ModelCatalog | DatabaseServices> {
  const read = readModelChoice(value);

  if (Result.isFailure(read)) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  const fastOffer = yield* hostedStoreOrUnavailable(seams.accountFastOffer(userId));

  const accepted = yield* acceptedModelChoice(read.success, fastOffer).pipe(
    Effect.catchTag("ModelChoiceRefused", () => Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST)),
    Effect.catchTag("ModelCatalogUnavailable", (unavailable) =>
      Effect.logWarning(
        `the model catalog could not be read: ${failureKind(unavailable.cause)}`,
      ).pipe(Effect.andThen(Effect.fail(HOSTED_REFUSAL.UNAVAILABLE))),
    ),
  );

  const row = yield* hostedStoreOrUnavailable(seams.readPreferences(userId));
  const standing = yield* snapshotAgent(userId, row);

  if (accepted.model === standing.model) return accepted;
  // Note that the default never moves to a model nothing pays for, because every Start on it would be refused.
  const unconnected = yield* hostedStoreOrUnavailable(unconnectedProviders(userId));
  const provider = providerModelOf(accepted.model)?.provider;

  if (provider !== undefined && unconnected.has(provider)) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }

  return accepted;
});

/** Whether two sets of the survey's answers answer every question alike, in the same words. */
function sameSurvey(one: OnboardingSurvey | undefined, other: OnboardingSurvey): boolean {
  return one !== undefined && onboardingSurveyStored(one) === onboardingSurveyStored(other);
}

/** The account's own stored snapshot, or the defaults for one with none stored, the coding agents' the one its credentials pay for. */
export const readOwnPreferences = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: AccountPreferenceSeams,
  userId: string,
) {
  const row = yield* hostedStoreOrUnavailable(seams.readPreferences(userId));

  return snapshotAnswer(row, yield* snapshotAgent(userId, row));
});

/**
 * Writes each part the write carries and answers the snapshot as it then
 * stands. `preferences` replaces the stored settings whole, while
 * `experiments` are merged over what stood. A write carrying no part asks
 * for nothing and is refused.
 */
export const writeOwnPreferences = /* @__PURE__ */ Effect.fnUntraced(function* (
  seams: AccountPreferenceSeams,
  userId: string,
  input: typeof accountPreferencesWriteSchema.Type,
) {
  // SAFETY: Request JSON is untrusted boundary data; each part's reader validates it before use.
  const body = input as Readonly<Record<keyof typeof input, UnparsedWireValue>>;

  if (
    body.preferences === undefined &&
    body.linkOpen === undefined &&
    body.pullRequestOpen === undefined &&
    body.agentEnter === undefined &&
    body.commitAuthor === undefined &&
    body.agentPermissionMode === undefined &&
    body.setupFinished === undefined &&
    body.setupPlace === undefined &&
    body.soundWhen === undefined &&
    body.completionSound === undefined &&
    body.askSound === undefined &&
    body.turnNotifications === undefined &&
    body.onboardingSurvey === undefined &&
    body.agent === undefined &&
    body.chaptersModel === undefined &&
    body.experiments === undefined
  ) {
    return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
  }

  const write: AccountPreferencesWrite = {};

  if (body.preferences !== undefined) {
    const preferences = accountPreferencesFromWire(body.preferences);

    if (preferences === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    write.preferences = preferences;
  }

  if (body.linkOpen !== undefined) {
    const linkOpen = ownPreferenceFromWire("linkOpen", body.linkOpen);

    if (linkOpen === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    write.linkOpen = linkOpen;
  }

  if (body.pullRequestOpen !== undefined) {
    const pullRequestOpen = ownPreferenceFromWire("pullRequestOpen", body.pullRequestOpen);

    if (pullRequestOpen === undefined) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    }

    write.pullRequestOpen = pullRequestOpen;
  }

  if (body.agentEnter !== undefined) {
    const agentEnter = ownPreferenceFromWire("agentEnter", body.agentEnter);

    if (agentEnter === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    write.agentEnter = agentEnter;
  }

  if (body.commitAuthor !== undefined) {
    const commitAuthor = ownPreferenceFromWire("commitAuthor", body.commitAuthor);

    if (commitAuthor === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    write.commitAuthor = commitAuthor;
  }

  if (body.agentPermissionMode !== undefined) {
    const agentPermissionMode = ownPreferenceFromWire(
      "agentPermissionMode",
      body.agentPermissionMode,
    );

    if (agentPermissionMode === undefined) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    }

    write.agentPermissionMode = agentPermissionMode;
  }

  if (body.setupFinished !== undefined) {
    const setupFinished = ownPreferenceFromWire("setupFinished", body.setupFinished);

    if (setupFinished === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    write.setupFinished = setupFinished;
  }

  if (body.setupPlace !== undefined) {
    const setupPlace = ownPreferenceFromWire("setupPlace", body.setupPlace);

    if (setupPlace === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    write.setupPlace = setupPlace;
  }

  if (body.soundWhen !== undefined) {
    const soundWhen = ownPreferenceFromWire("soundWhen", body.soundWhen);

    if (soundWhen === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    write.soundWhen = soundWhen;
  }

  if (body.completionSound !== undefined) {
    const completionSound = ownPreferenceFromWire("completionSound", body.completionSound);

    if (completionSound === undefined) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    }

    write.completionSound = completionSound;
  }

  if (body.askSound !== undefined) {
    const askSound = ownPreferenceFromWire("askSound", body.askSound);

    if (askSound === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    write.askSound = askSound;
  }

  if (body.turnNotifications !== undefined) {
    const turnNotifications = ownPreferenceFromWire("turnNotifications", body.turnNotifications);

    if (turnNotifications === undefined) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    }

    write.turnNotifications = turnNotifications;
  }

  if (body.onboardingSurvey !== undefined) {
    // Note that the answers are stored as read, so a key the survey does not name is not kept.
    const onboardingSurvey = onboardingSurveyFrom(
      ownPreferenceFromWire("onboardingSurvey", body.onboardingSurvey),
    );

    if (onboardingSurvey === undefined) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    }

    write.onboardingSurvey = onboardingSurveyStored(onboardingSurvey);
  }

  if (body.agent !== undefined) {
    write.agent = yield* acceptedAgentChoice(seams, userId, body.agent);
  }

  if (body.chaptersModel !== undefined) {
    if (!isChaptersModel(body.chaptersModel)) {
      return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    }

    write.chaptersModel = body.chaptersModel;
  }

  if (body.experiments !== undefined) {
    const experiments = experimentChoicesFrom(body.experiments);

    if (experiments === undefined) return yield* Effect.fail(HOSTED_REFUSAL.INVALID_REQUEST);
    write.experiments = experiments;
  }

  // Note that the survey's answers standing before are read first, because a retried or synced write of the same answers must not post them to Slack again.
  const answeredBefore =
    write.onboardingSurvey === undefined
      ? undefined
      : (yield* hostedStoreOrUnavailable(seams.readPreferences(userId)))?.preferences
          .onboardingSurvey;

  const row = yield* hostedStoreOrUnavailable(seams.writePreferences(userId, write));
  // The survey's answers, once kept and changed, are recorded as a response to our onboarding survey.
  const answered = onboardingSurveyFrom(write.onboardingSurvey);

  if (answered !== undefined && !sameSurvey(onboardingSurveyFrom(answeredBefore), answered)) {
    yield* onboardingSurveyAnswered(userId, answered);
  }

  return { ...snapshotAnswer(row, yield* snapshotAgent(userId, row)), txid: row.txid };
});
