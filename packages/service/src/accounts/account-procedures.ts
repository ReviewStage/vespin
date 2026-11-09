/**
 * account-procedures.ts -- the signed-in account's own procedures: its preferences, its access, and its provider keys; its deletion is Better Auth's (`account-deletion.ts`).
 *
 * Each resolves the caller before touching anything, and answers nothing
 * about any account but the one the caller is: root AGENTS.md pins that no
 * credential or account secret ever travels in an answer, so what each
 * answers is a boolean or the caller's own stored value, never a token or
 * a session id. The caller is resolved on the resource itself, before any
 * input is read, so an unsigned caller is refused as unsigned whatever it
 * sent.
 *
 * The preferences snapshot is six parts: the settings preferences the
 * desktop syncs, where the account's app links open and what Enter does in
 * an agent's box while it works, synced settings each of its own part so a
 * build that predates it neither refuses the snapshot nor clears the choice
 * by writing the shared part back whole, the coding
 * agents' default model, effort, and context window, which Settings alone
 * writes and which reads, until it does, as the fallback a Start naming no
 * model runs on (`accountModelChoices`), the Claude model the account's Generate chapters
 * runs on, one of a fixed set (`@repo/features/chapters-model-choice`), and the experiments the account turned on in
 * Settings › Experimental. A write carries any of them, a coding-agent
 * choice is accepted only as the catalog accepts it
 * (`packages/service/src/providers/model-catalog.ts`), and moved only to a
 * model a credential of the account's pays for, so what is stored is a
 * choice a Start could run unless its credential has since gone, and the
 * experiments are a patch read
 * as tolerantly as they are answered: a key this deployment does not list
 * is passed over rather than refused, because it is an older or newer
 * build's experiment and refusing it would refuse the build's every other
 * choice too.
 *
 * The access is whether the caller is an admin, read off its own role, so a
 * client can offer the admin dashboard to the account that may open it. It
 * says nothing of any other account and authorizes nothing: the dashboard's
 * own gate (`admin/gate.ts`) decides every admin read on its own.
 *
 * The provider keys are `provider-keys-procedures.ts`'s.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import type {
  AccountAccessRow,
  AccountPreferencesRow,
  AccountPreferencesWrite,
  AccountPreferencesWritten,
  AccountSeamEffect,
} from "@repo/database/models/account-store";
import type { TaskStoreFailure } from "@repo/database/models/task-store";
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
import { Clock, Effect, Result, Schema } from "effect";
import { isAdminRole } from "../admin/admin-access.js";
import { unconnectedProviders } from "../agents/coder-host/agent-runtime-choice.js";
import { accountModelChoices } from "../agents/coder-host/start.js";
import { standingSupportAccess } from "../auth/auth-policy.js";
import {
  HOSTED_REFUSAL,
  type HostedRefusal,
  hostedStoreOrUnavailable,
  type UserIdResolver,
} from "../http/http-effect.js";
import { accountMiddleware, hosted } from "../orpc/base.js";
import {
  type AccountFastOffer,
  acceptedModelChoice,
  type ModelCatalog,
  providerModelOf,
} from "../providers/model-catalog.js";
import { memoriesProcedures } from "./memories-procedures.js";
import { onboardingSurveyAnswered } from "./onboarding-survey-response.js";
import { providerKeysProcedures } from "./provider-keys-procedures.js";

export interface AccountProcedureSeams {
  resolveUserId: UserIdResolver;
  readPreferences: (userId: string) => AccountSeamEffect<AccountPreferencesRow | undefined>;
  /** The role and the grant of support access on the account's own row, as Better Auth stores them. */
  readAccess: (userId: string) => AccountSeamEffect<AccountAccessRow>;
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
  seams: AccountProcedureSeams,
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

/** The account resource: every procedure but the provider keys' own, which are `provider-keys-procedures.ts`'s. */
export function accountProcedures(seams: AccountProcedureSeams) {
  const signedIn = hosted.account.use(accountMiddleware(seams.resolveUserId));
  return {
    /** The caller's own stored snapshot, or the defaults for a user with none stored, the coding agents' the one its credentials pay for. */
    preferences: signedIn.preferences.effect(function* ({ context }) {
      const row = yield* hostedStoreOrUnavailable(seams.readPreferences(context.userId));
      return snapshotAnswer(row, yield* snapshotAgent(context.userId, row));
    }),

    /**
     * Whether the caller's own account is an admin, any role but the admin
     * role not; and when its member's grant of support access runs out, null
     * where none stands or it has run out.
     */
    access: signedIn.access.effect(function* ({ context }) {
      const access = yield* hostedStoreOrUnavailable(seams.readAccess(context.userId));
      const now = yield* Clock.currentTimeMillis;
      return {
        admin: isAdminRole(access.role),
        supportAccessUntil: standingSupportAccess(access.supportAccessUntil, now),
      };
    }),

    /**
     * Writes each part the body carries — `preferences`, a validated
     * settings snapshot that replaces the stored one whole, `linkOpen`,
     * where the account's links open, `pullRequestOpen`, where its pull
     * requests open, `agentEnter`, what Enter does in an
     * agent's box while it works, `commitAuthor`, who authors an agent's
     * commits, `setupFinished`, whether the account
     * finished setup, `setupPlace`, where it stands in setup, `soundWhen` and
     * `completionSound`, when and which sound plays as an agent finishes,
     * `turnNotifications`, whether a notification is posted then, `agent`, a choice the catalog
     * `onboardingSurvey`, what it answered in setup's survey, `agent`, a choice the catalog
     * accepts, moved only to a model the account pays for, `chaptersModel`, one of the chapters' fixed set, and `experiments`, each experiment's on or off merged over
     * what stood — and answers the snapshot as it then stands. A body
     * carrying none of them asks for nothing and is refused.
     */
    writePreferences: signedIn.writePreferences.effect(function* ({ context, input }) {
      // SAFETY: Request JSON is untrusted boundary data; each part's reader validates it before use.
      const body = input as Readonly<Record<keyof typeof input, UnparsedWireValue>>;
      if (
        body.preferences === undefined &&
        body.linkOpen === undefined &&
        body.pullRequestOpen === undefined &&
        body.agentEnter === undefined &&
        body.commitAuthor === undefined &&
        body.setupFinished === undefined &&
        body.setupPlace === undefined &&
        body.soundWhen === undefined &&
        body.completionSound === undefined &&
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
      if (body.turnNotifications !== undefined) {
        const turnNotifications = ownPreferenceFromWire(
          "turnNotifications",
          body.turnNotifications,
        );
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
        write.agent = yield* acceptedAgentChoice(seams, context.userId, body.agent);
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
          : (yield* hostedStoreOrUnavailable(seams.readPreferences(context.userId)))?.preferences
              .onboardingSurvey;
      const row = yield* hostedStoreOrUnavailable(seams.writePreferences(context.userId, write));
      // The survey's answers, once kept and changed, are recorded as a response to our onboarding survey.
      const answered = onboardingSurveyFrom(write.onboardingSurvey);
      if (answered !== undefined && !sameSurvey(onboardingSurveyFrom(answeredBefore), answered)) {
        yield* onboardingSurveyAnswered(context.userId, answered);
      }
      return { ...snapshotAnswer(row, yield* snapshotAgent(context.userId, row)), txid: row.txid };
    }),

    ...providerKeysProcedures(seams),
    ...memoriesProcedures(seams),
  };
}
