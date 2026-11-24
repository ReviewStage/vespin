/**
 * cursor-models.ts -- the Cursor models a coding agent may run on: every model the account's own Cursor key lists, read live from Cursor, or a pinned few where Cursor cannot be read.
 *
 * Cursor bills its own models, so they are no AI Gateway entry and no
 * other provider's: each is offered as a catalog entry of its own under
 * `cursor/`, run on Cursor's harness on the account's Cursor API key. The
 * list is Cursor's own, read with the account's key (`GET
 * api.cursor.com/v1/models`, which `@cursor/sdk`'s `Cursor.models.list()`
 * answers too) and kept for a few minutes (`CursorModelCatalog`), so a model
 * Cursor adds is offered with no change here. Beside each entry stand
 * Cursor's own words for it: its model id, the parameter its effort is
 * spelled by (`effort`, `reasoning_effort`, or `reasoning`, as each model
 * names its own), whether it takes `fast`, the parameters every choice of
 * it sends as they are, its two context windows where it lists two, and
 * which of its variants run in Max Mode alone, so the runner is handed
 * Cursor's `ModelSelection` (`{ id, params, maxMode }`) whole.
 *
 * Each of Cursor's models is read by one rule (`cursorModelsOf`). Its
 * effort is the first of the three effort parameters it lists, and a model
 * listing none still lists one effort (`NO_EFFORT`), since a choice always
 * names one; it sends Cursor nothing. Its other parameters (a context
 * window, thinking) are pinned as its default variant sets them. It is
 * offered at fast speed beside its own, as AI Gateway's fast slugs are,
 * where a variant of it runs `fast`: its own id sends `fast: false`, and
 * the id with `-fast` (`MODEL_SPEED_SUFFIX`) sends `fast: true`. Where a
 * variant of it runs on a larger `context` than its default one, as
 * Grok 4.7's 500K does beside its 256K, it offers the two as its context
 * windows, chosen on the Context row as every model's are, the larger the
 * default; Cursor runs some of those only in Max Mode, which a choice is
 * sent with wherever every variant it matches runs in Max Mode alone, as
 * Cursor's own picker now does, so no Max Mode entry is offered of its own.
 * Cursor's `default` is offered as `cursor/auto`,
 * since Cursor answers to `auto` too and a tab reads the label off the id.
 *
 * Where Cursor's list cannot be read (no key yet, Cursor down, an answer
 * of another shape), the account's last list stands, and where it has none
 * the few models pinned here stand in, so a member still sees Cursor's mark
 * and a Connect where no key is saved. An agent's model is never refused
 * for the list's not naming it: a Cursor model it does not name runs on its
 * id alone (`cursorModelSelectionOf`).
 *
 * Who is offered them is `withCursorModels`'s to say: an account with Cursor agents on
 * (`EXPERIMENT.CURSOR`, each person's own choice), on a client that reads
 * Cursor as a provider (`CURSOR_CLIENT_API_VERSION`); a Mac that runs Cursor
 * lists it among its providers on the same terms (`macsWithCursor`).
 */

import type { CursorModelSelection } from "@repo/agent-runner/protocol";
import type { DatabaseServices } from "@repo/database/core/query";
import { PROVIDER_KEY_UNREADABLE } from "@repo/database/models/provider-key-seal";
import { CONTEXT_WINDOW, type ContextWindow } from "@repo/features/agent-wire";
import { modelIdAtSpeed } from "@repo/features/model-effort";
import { type MacOffer, MODEL_PROVIDER, MODEL_SPEED, NO_EFFORT } from "@repo/features/models-wire";
import { PROVIDER_KEY_PROVIDER } from "@repo/features/provider-key-wire";
import {
  Cache,
  Clock,
  Context,
  Duration,
  Effect,
  Exit,
  Layer,
  Option,
  Predicate,
  type Redacted,
  Schema,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { ownApiKeyOf } from "../accounts/own-api-key.js";
import { HostedEnvironment } from "../environment.js";
import { type OfferedModel, providerModelOf } from "./model-catalog.js";

/** The first hosted API version (`HOSTED_API_VERSION`) whose clients read `cursor` as a provider; a catalog answer to an older one never holds a Cursor entry, which would refuse its whole read. */
const CURSOR_CLIENT_API_VERSION = 4;

/** Where Cursor lists the models a key may run. */
const CURSOR_MODELS_URL = "https://api.cursor.com/v1/models";

/** How long one account's read of Cursor's list stands before it is read again. */
const CURSOR_MODELS_TTL = Duration.minutes(10);

/** How many accounts' last lists the instance keeps, the least recently used let go first. */
const CURSOR_MODELS_KEPT = 1_000;

/** How long a read of Cursor's list may take before the pinned models stand in. */
const CURSOR_MODELS_TIMEOUT = Duration.seconds(5);

/** The parameters of Cursor's model list this module names, by Cursor's own ids. */
const CURSOR_PARAMETER = {
  EFFORT: "effort",
  REASONING_EFFORT: "reasoning_effort",
  REASONING: "reasoning",
  FAST: "fast",
  CONTEXT: "context",
} as const;

/** The parameters a model may spell its effort by, in the order one is taken where a model lists several. */
const EFFORT_PARAMETERS: readonly string[] = [
  CURSOR_PARAMETER.EFFORT,
  CURSOR_PARAMETER.REASONING_EFFORT,
  CURSOR_PARAMETER.REASONING,
];

/** The value of `fast` that runs a model's fast version. */
const FAST_ON = "true";

/** Cursor's own id for its choice of model per request, and the name we offer it under. */
const CURSOR_AUTO = { CURSOR_ID: "default", SLUG: "auto" } as const;

/** How many tokens each suffix of a `context` value stands for: `256k`, `1m`. */
const TOKEN_SUFFIX = { k: 1_000, m: 1_000_000 } as const;

/** A `context` value as Cursor spells it: a count and its suffix. */
const CONTEXT_VALUE = /^(\d+(?:\.\d+)?)([km])$/u;

/** One parameter of Cursor's `ModelSelection`, as its model list spells it. */
interface CursorParameterValue {
  readonly id: string;
  readonly value: string;
}

/** One Cursor model as we offer it, and Cursor's own words for it. */
export interface CursorModel {
  /** Its catalog id at standard speed (`cursor/grok-4.7`). */
  readonly catalogId: string;
  /** Cursor's model id, which `ModelSelection.id` takes. */
  readonly cursorId: string;
  /** Cursor's name for it. */
  readonly name: string;
  /** The parameter its effort is spelled by and the values it lists, which are the catalog's efforts as they are; none for a model with no effort of its own. */
  readonly effort: { readonly parameter: string; readonly values: readonly string[] } | undefined;
  /** Whether it takes `fast`, and so is offered at fast speed beside its own. */
  readonly fast: boolean;
  /** What every choice of it sends as it is: its standard window, and any other parameter its variant sets. */
  readonly pinned: readonly CursorParameterValue[];
  /** Its two context windows, in tokens, and the `context` value its larger one is sent as, at its own speed and at fast speed; none at a speed it runs on one window alone. */
  readonly windows: { readonly standard?: CursorWindows; readonly fast?: CursorWindows };
  /** The parameters of each variant that runs in Max Mode alone, but its effort, by which a choice matching only those is sent in Max Mode. */
  readonly maxModeOnly: readonly (readonly CursorParameterValue[])[];
  /** The parameters of each variant that runs outside Max Mode, but its effort. */
  readonly outsideMaxMode: readonly (readonly CursorParameterValue[])[];
}

/** A model's two context windows as Cursor lists them. */
interface CursorWindows {
  readonly standardTokens: number;
  readonly longTokens: number;
  /** The `context` value the larger window is sent as. */
  readonly longContext: string;
}

/**
 * The models offered where Cursor's own list cannot be read, read from it
 * on Nov 16, 2026: Composer 2.5, Cursor's own, whose default variant is its
 * fast one; Auto, Cursor's choice of model per request; and Grok 4.7,
 * pinned to its 256K window, its 500K one running in Max Mode alone, which
 * a model offered with no variants read cannot tell.
 */
const PINNED_CURSOR_MODELS: readonly CursorModel[] = [
  {
    catalogId: "cursor/composer-2.5",
    cursorId: "composer-2.5",
    name: "Composer 2.5",
    effort: undefined,
    fast: true,
    pinned: [],
    windows: {},
    maxModeOnly: [],
    outsideMaxMode: [],
  },
  {
    catalogId: "cursor/auto",
    cursorId: CURSOR_AUTO.CURSOR_ID,
    name: "Auto",
    effort: undefined,
    fast: false,
    pinned: [],
    windows: {},
    maxModeOnly: [],
    outsideMaxMode: [],
  },
  {
    catalogId: "cursor/grok-4.7",
    cursorId: "grok-4.7",
    name: "Grok 4.7",
    effort: {
      parameter: CURSOR_PARAMETER.REASONING_EFFORT,
      values: ["low", "medium", "high", "xhigh"],
    },
    fast: true,
    pinned: [{ id: CURSOR_PARAMETER.CONTEXT, value: "256k" }],
    windows: {},
    maxModeOnly: [],
    outsideMaxMode: [],
  },
];

// ------------------------------------------------------------- the boundary

const ParameterValueSchema = Schema.Struct({ id: Schema.String, value: Schema.String });

/** One model of Cursor's list, the fields this module reads alone, so a field Cursor adds changes nothing here; its name is its id where Cursor gives none, as `@cursor/sdk` reads it. */
const CursorListItemSchema = Schema.Struct({
  id: Schema.String,
  displayName: Schema.optionalKey(Schema.String),
  parameters: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        values: Schema.Array(Schema.Struct({ value: Schema.String })),
      }),
    ),
  ),
  variants: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        params: Schema.Array(ParameterValueSchema),
        isDefault: Schema.optionalKey(Schema.Boolean),
        isMaxMode: Schema.optionalKey(Schema.Boolean),
      }),
    ),
  ),
});

type CursorListItem = typeof CursorListItemSchema.Type;

type CursorVariant = NonNullable<CursorListItem["variants"]>[number];

/**
 * Cursor's answer to a read of its list, each model read on its own, so one
 * this module cannot read is left out rather than costing the account the
 * whole list.
 */
const CursorListSchema = Schema.Struct({ items: Schema.Array(Schema.Unknown) });

const readListItem = Schema.decodeUnknownOption(CursorListItemSchema);

// ------------------------------------------------------------- the rule

/** A variant's parameters but its effort and speed, which a choice names itself. */
function otherParams(variant: CursorVariant | undefined): readonly CursorParameterValue[] {
  return (variant?.params ?? []).filter(
    (param) => !EFFORT_PARAMETERS.includes(param.id) && param.id !== CURSOR_PARAMETER.FAST,
  );
}

/**
 * What a model offered at one speed alone pins of its variant's speed: the
 * variant's own `fast`, where it sets one, so Cursor never picks the speed.
 */
function pinnedSpeed(variant: CursorVariant | undefined, offeredFast: boolean) {
  if (offeredFast) return [];

  return (variant?.params ?? []).filter((param) => param.id === CURSOR_PARAMETER.FAST);
}

/** Whether any of the variants runs `fast`. */
function runsFast(variants: readonly CursorVariant[]): boolean {
  return variants.some((variant) =>
    variant.params.some((param) => param.id === CURSOR_PARAMETER.FAST && param.value === FAST_ON),
  );
}

/** A variant's `context` value; none where it sets none. */
function contextOf(variant: CursorVariant | undefined): string | undefined {
  return variant?.params.find((param) => param.id === CURSOR_PARAMETER.CONTEXT)?.value;
}

/** A `context` value as a count of tokens; none for one spelled otherwise. */
function tokensOf(value: string | undefined): number | undefined {
  const match = value === undefined ? null : CONTEXT_VALUE.exec(value.toLowerCase());

  if (match?.[1] === undefined) return undefined;
  // Note that the pattern takes `k` or `m` alone, so any suffix but `m` is `k`.
  const scale = match[2] === "m" ? TOKEN_SUFFIX.m : TOKEN_SUFFIX.k;

  return Math.round(Number(match[1]) * scale);
}

/**
 * The model's two windows: the default variant's `context` and the largest
 * any other variant runs on, where both read as tokens and the second is
 * the larger; none otherwise, as for a model that lists one window.
 */
function windowsOf(
  base: CursorVariant | undefined,
  variants: readonly CursorVariant[],
): CursorWindows | undefined {
  const standardTokens = tokensOf(contextOf(base));

  if (standardTokens === undefined) return undefined;
  let windows: CursorWindows | undefined;

  for (const variant of variants) {
    const longContext = contextOf(variant);
    const longTokens = tokensOf(longContext);

    if (longContext === undefined || longTokens === undefined || longTokens <= standardTokens) {
      continue;
    }

    if (windows === undefined || longTokens > windows.longTokens) {
      windows = { standardTokens, longTokens, longContext };
    }
  }

  return windows;
}

/** The variants that run at the speed given: those setting `fast` so, and those setting no `fast`. */
function variantsAt(variants: readonly CursorVariant[], fast: boolean): readonly CursorVariant[] {
  return variants.filter((variant) => {
    const speed = variant.params.find((param) => param.id === CURSOR_PARAMETER.FAST)?.value;

    return speed === undefined || (speed === FAST_ON) === fast;
  });
}

/** A model's windows at each speed it runs, each read as `windowsOf` reads them, none at a speed with one window alone. */
function windowsAtSpeeds(
  base: CursorVariant | undefined,
  variants: readonly CursorVariant[],
): CursorModel["windows"] {
  const standard = windowsOf(base, variantsAt(variants, false));
  const fast = windowsOf(base, variantsAt(variants, true));

  return {
    ...(standard === undefined ? undefined : { standard }),
    ...(fast === undefined ? undefined : { fast }),
  };
}

/** A variant's parameters but its effort, by which a choice is matched to it. */
function matchedParams(variant: CursorVariant): readonly CursorParameterValue[] {
  return variant.params.filter((param) => !EFFORT_PARAMETERS.includes(param.id));
}

/**
 * One of Cursor's models as we offer it: pinned as its default variant runs
 * outside Max Mode, at fast speed too where any variant runs fast, and on
 * two context windows where a variant runs on a larger one, each choice
 * sent in Max Mode where it matches only variants that run in it alone.
 */
function offeredOf(item: CursorListItem): readonly CursorModel[] {
  const slug = item.id === CURSOR_AUTO.CURSOR_ID ? CURSOR_AUTO.SLUG : item.id;
  const effortParameter = item.parameters?.find((param) => EFFORT_PARAMETERS.includes(param.id));

  const effort =
    effortParameter === undefined || effortParameter.values.length === 0
      ? undefined
      : {
          parameter: effortParameter.id,
          values: effortParameter.values.map((each) => each.value),
        };

  const variants = item.variants ?? [];
  const standard = variants.filter((variant) => variant.isMaxMode !== true);
  const maxOnly = variants.filter((variant) => variant.isMaxMode === true);
  const base = standard.find((variant) => variant.isDefault === true) ?? standard[0];

  // A model all of whose variants run in Max Mode alone has no window to stand on outside it.
  if (base === undefined && variants.length > 0) return [];

  // Note that a model listing no variants runs as its parameters say, `fast` among them.
  const fast =
    variants.length === 0
      ? (item.parameters?.some(
          (param) =>
            param.id === CURSOR_PARAMETER.FAST &&
            param.values.some((each) => each.value === FAST_ON),
        ) ?? false)
      : runsFast(variants);

  return [
    {
      catalogId: `${MODEL_PROVIDER.CURSOR}/${slug}`,
      cursorId: item.id,
      name: item.displayName ?? item.id,
      effort,
      fast,
      pinned: [...otherParams(base), ...pinnedSpeed(base, fast)],
      windows: windowsAtSpeeds(base, variants),
      maxModeOnly: maxOnly.map(matchedParams),
      outsideMaxMode: standard.map(matchedParams),
    },
  ];
}

/**
 * Cursor's list as the models we offer, in Cursor's order, each model read on
 * its own and one it cannot read left out, the first of any two that would
 * take one id kept. Note that Cursor names two models alike at times (two
 * "Auto"s), so one whose name an earlier model took carries its id beside it.
 */
export function cursorModelsOf(items: readonly unknown[]): readonly CursorModel[] {
  const taken = new Set<string>();
  const named = new Set<string>();

  return items
    .flatMap((item) => Option.toArray(readListItem(item)))
    .flatMap(offeredOf)
    .flatMap((model) => {
      if (taken.has(model.catalogId)) return [];
      taken.add(model.catalogId);

      const name = named.has(model.name) ? `${model.name} (${model.cursorId})` : model.name;
      named.add(model.name);

      return [{ ...model, name }];
    });
}

// ------------------------------------------------------------- the read

/** What reads the models one account is offered of Cursor's, with its own key. */
export interface CursorModelReader {
  readonly forAccount: (
    userId: string,
  ) => Effect.Effect<readonly CursorModel[], never, DatabaseServices>;
}

/**
 * Cursor's list as the service reads it: live where the runtime wires
 * `cursorModelCatalogLayer`, and the pinned models elsewhere, as in a test
 * or a tool that reads no network.
 */
export const CursorModelCatalog = Context.Reference<CursorModelReader>("CursorModelCatalog", {
  defaultValue: () => ({ forAccount: () => Effect.succeed(PINNED_CURSOR_MODELS) }),
});

/** What a failed read of Cursor's list is, by its kind and, where Cursor answered, its status; never its words or its request. */
function failureKind(failure: { readonly _tag: string }): string {
  const response = Predicate.hasProperty(failure, "response") ? failure.response : undefined;
  const status = Predicate.hasProperty(response, "status") ? ` ${String(response.status)}` : "";

  return `${failure._tag}${status}`;
}

/** One read of Cursor's list on the key given, answered as the models we offer; none where Cursor did not answer it so. */
const readCursorList = Effect.fnUntraced(function* (
  client: HttpClient.HttpClient,
  key: Redacted.Redacted,
) {
  const request = HttpClientRequest.get(CURSOR_MODELS_URL).pipe(
    HttpClientRequest.acceptJson,
    HttpClientRequest.bearerToken(key),
  );

  const models = yield* client.execute(request).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap(HttpClientResponse.schemaBodyJson(CursorListSchema)),
    Effect.scoped,
    Effect.timeout(CURSOR_MODELS_TIMEOUT),
    Effect.map((answer) => cursorModelsOf(answer.items)),
    // Note that only the failure's kind and status are logged, because the request it describes carries the key.
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(`Cursor's model list could not be read: ${failureKind(failure)}`),
        [],
      ),
    ),
  );

  if (models.length === 0) return Option.none();

  return Option.some(models);
});

/** One account's last read of Cursor's list, and until when it stands before it is read again. */
interface KeptList {
  readonly until: number;
  readonly models: readonly CursorModel[];
}

/**
 * Cursor's list as each account's key reads it, read again once
 * `CURSOR_MODELS_TTL` passed; the pinned models where the account saved no
 * Cursor key. Where Cursor's list could not be read, as when it timed out,
 * the account's last list stands until a read lands, the pinned models
 * where none was read yet, so an agent on a model Cursor listed keeps its
 * effort and window through Cursor's outage. The instance keeps the last
 * lists of `CURSOR_MODELS_KEPT` accounts.
 */
export const cursorModelCatalogLayer = Layer.effect(
  CursorModelCatalog,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const environment = yield* HostedEnvironment;

    // Note that entries are written by hand alone, so the lookup never runs and nothing lapses but by capacity.
    const kept = yield* Cache.makeWith(
      (_userId: string): Effect.Effect<Option.Option<KeptList>> => Effect.succeedNone,
      {
        capacity: CURSOR_MODELS_KEPT,
        timeToLive: (exit) =>
          Exit.isSuccess(exit) && Option.isSome(exit.value) ? Duration.infinity : Duration.zero,
      },
    );

    const forAccount = Effect.fnUntraced(function* (userId: string) {
      const now = yield* Clock.currentTimeMillis;
      const standing = Option.flatten(yield* Cache.getOption(kept, userId));

      if (Option.isSome(standing) && standing.value.until > now) return standing.value.models;

      const key = yield* ownApiKeyOf(userId, PROVIDER_KEY_PROVIDER.CURSOR, environment).pipe(
        Effect.catch(() => Effect.succeed(undefined)),
      );

      if (key === undefined || key === PROVIDER_KEY_UNREADABLE) return PINNED_CURSOR_MODELS;
      const read = yield* readCursorList(client, key);

      if (Option.isNone(read)) {
        return Option.match(standing, {
          onNone: () => PINNED_CURSOR_MODELS,
          onSome: (last) => last.models,
        });
      }

      yield* Cache.set(
        kept,
        userId,
        Option.some({ until: now + Duration.toMillis(CURSOR_MODELS_TTL), models: read.value }),
      );

      return read.value;
    });

    return { forAccount } satisfies CursorModelReader;
  }),
);

// ------------------------------------------------------------- the offer

/** A model's windows as a catalog entry offers them; nothing for a speed with one window. */
function offeredWindows(windows: CursorWindows | undefined) {
  return windows === undefined
    ? undefined
    : {
        contextWindows: { standardTokens: windows.standardTokens, longTokens: windows.longTokens },
        contextWindow: windows.longTokens,
      };
}

/** The catalog entries one Cursor model is offered as: its own, and its fast version right after it where it takes `fast`, each with the windows it runs on at its speed. */
function catalogEntriesOf(model: CursorModel): readonly OfferedModel[] {
  const own: OfferedModel = {
    id: model.catalogId,
    name: model.name,
    provider: MODEL_PROVIDER.CURSOR,
    efforts: model.effort?.values ?? [NO_EFFORT],
  };

  const standard = { ...own, ...offeredWindows(model.windows.standard) };

  if (!model.fast) return [standard];

  return [
    standard,
    {
      ...own,
      id: modelIdAtSpeed(model.catalogId, MODEL_SPEED.FAST),
      name: `${model.name} (Fast)`,
      ...offeredWindows(model.windows.fast),
    },
  ];
}

/** What decides whether a catalog answer holds Cursor's models: the account's choice of Cursor agents, and the hosted API version the client asking was built against, none where it named none. */
export interface CursorOffer {
  readonly experimentOn: boolean;
  readonly apiVersion: number | undefined;
}

/** Whether Cursor's models are offered: to an account with Cursor agents on, on a client that reads Cursor as a provider. */
export function offersCursor(offer: CursorOffer): boolean {
  return (
    offer.experimentOn &&
    offer.apiVersion !== undefined &&
    offer.apiVersion >= CURSOR_CLIENT_API_VERSION
  );
}

/**
 * The models given with Cursor's after them where the offer holds
 * (`offersCursor`), the models as they are where it does not. Note that a
 * reader inside the service, which decodes no wire, passes this build's own
 * `HOSTED_API_VERSION`, so only the account's choice decides there.
 */
export function withCursorModels(
  models: readonly OfferedModel[],
  offer: CursorOffer,
  cursorModels: readonly CursorModel[],
): readonly OfferedModel[] {
  return offersCursor(offer) ? [...models, ...cursorModels.flatMap(catalogEntriesOf)] : models;
}

/**
 * The account's devices as the client asking is offered them: Cursor among
 * a device's providers only where the offer holds (`offersCursor`), since a
 * client that reads no Cursor refuses a whole answer naming it, and one
 * offered no Cursor model has no Start for a device to take.
 */
export function macsWithCursor(macs: readonly MacOffer[], offer: CursorOffer): readonly MacOffer[] {
  if (offersCursor(offer)) return macs;

  return macs.map((mac) => ({
    ...mac,
    providers: mac.providers.filter((provider) => provider !== MODEL_PROVIDER.CURSOR),
  }));
}

/** The Cursor model a catalog id names, at the speed it names; none for an id that names none of them. */
function cursorModelAt(
  cursorModels: readonly CursorModel[],
  catalogId: string,
): { readonly model: CursorModel; readonly fast: boolean } | undefined {
  for (const model of cursorModels) {
    if (model.catalogId === catalogId) return { model, fast: false };

    if (model.fast && modelIdAtSpeed(model.catalogId, MODEL_SPEED.FAST) === catalogId) {
      return { model, fast: true };
    }
  }

  return undefined;
}

/** Whether a choice's parameters say what a variant's do, each the variant sets. */
function matches(
  variant: readonly CursorParameterValue[],
  chosen: readonly CursorParameterValue[],
): boolean {
  return variant.every((param) =>
    chosen.some((each) => each.id === param.id && each.value === param.value),
  );
}

/**
 * A Cursor model the models given do not name, as where Cursor's list could
 * not be read and the account has no list of its own yet: Cursor's id, and
 * `fast` on its fast version, so it runs as Cursor's default variant of it
 * otherwise, since only Cursor's list says how its effort and window are
 * spelled. Cursor answers an id it does not run itself, as OpenAI and
 * Anthropic answer theirs on Codex and Claude Code, whose ids are never
 * checked against a list either. None for an id that is not Cursor's.
 */
function unlistedSelectionOf(catalogId: string): CursorModelSelection | undefined {
  const model = providerModelOf(catalogId);

  if (model?.provider !== MODEL_PROVIDER.CURSOR) return undefined;
  const id = model.modelId === CURSOR_AUTO.SLUG ? CURSOR_AUTO.CURSOR_ID : model.modelId;

  if (model.speed !== MODEL_SPEED.FAST) return { id };

  return { id, params: [{ id: CURSOR_PARAMETER.FAST, value: FAST_ON }] };
}

/**
 * The model a Cursor agent on the catalog id, effort, and window given
 * runs, as Cursor's SDK takes it (`ModelSelection`): Cursor's id, every
 * parameter the model pins, its larger `context` on the long window of a
 * model with two, the default, its effort under the parameter it spells it
 * by where it lists the effort, `fast` where it takes it, true for the fast
 * version, and Max Mode where the choice matches only variants that run in
 * it alone; a Cursor model the models given do not name runs on its id
 * alone (`unlistedSelectionOf`). None for an id that is not Cursor's.
 */
export function cursorModelSelectionOf(
  cursorModels: readonly CursorModel[],
  catalogId: string,
  effort: string,
  contextWindow?: ContextWindow,
): CursorModelSelection | undefined {
  const found = cursorModelAt(cursorModels, catalogId);

  if (found === undefined) return unlistedSelectionOf(catalogId);
  const { model } = found;
  const windows = found.fast ? model.windows.fast : model.windows.standard;
  const longContext = contextWindow === CONTEXT_WINDOW.STANDARD ? undefined : windows?.longContext;

  const pinned = model.pinned.map((param) =>
    longContext !== undefined && param.id === CURSOR_PARAMETER.CONTEXT
      ? { ...param, value: longContext }
      : param,
  );

  const effortParam =
    model.effort?.values.includes(effort) === true
      ? [{ id: model.effort.parameter, value: effort }]
      : [];

  const fastParam = model.fast ? [{ id: CURSOR_PARAMETER.FAST, value: String(found.fast) }] : [];
  const params = [...pinned, ...effortParam, ...fastParam];

  const maxMode =
    model.maxModeOnly.some((variant) => matches(variant, params)) &&
    !model.outsideMaxMode.some((variant) => matches(variant, params));

  return {
    id: model.cursorId,
    ...(params.length === 0 ? undefined : { params }),
    ...(maxMode ? { maxMode: true } : undefined),
  };
}
