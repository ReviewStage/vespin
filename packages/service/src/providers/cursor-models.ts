/**
 * cursor-models.ts -- the Cursor models a coding agent may run on: a curated, pinned list, since AI Gateway's catalog lists none.
 *
 * Cursor bills its own models, so they are no AI Gateway entry and no
 * other provider's: each is offered as a catalog entry of its own under
 * `cursor/`, run on Cursor's harness on the account's Cursor API key. The
 * list is pinned here, read from Cursor's model list (`GET
 * api.cursor.com/v1/models`, which `@cursor/sdk`'s `Cursor.models.list()`
 * answers too) on Nov 16, 2026, and moves only by an edit here. Beside
 * each entry stand Cursor's own words for it: its model id, the parameter
 * its effort is spelled by (`effort`, `reasoning_effort`, or `reasoning`,
 * as each model names its own), whether it takes `fast`, and the
 * parameters every choice of it sends as they are, so the runner can map a
 * choice to Cursor's `ModelSelection` (`{ id, params }`) without asking.
 *
 * A model Cursor runs with no effort of its own still lists one effort
 * (`NO_EFFORT`), since a choice always names one; it sends Cursor
 * nothing. A model that takes `fast` is offered as two entries, as AI
 * Gateway's fast slugs are: its own id, which sends `fast: false`, and the
 * id with `-fast` (`MODEL_SPEED_SUFFIX`), which sends `fast: true`. A
 * model's larger context window, which Cursor runs in Max Mode at a price
 * of its own, is never offered: its standard window is pinned among its
 * parameters, since Cursor's harness manages its context itself and takes
 * no choice of window (`NATIVE_MODEL_RULE`).
 *
 * Who is offered them is `withCursorModels`'s to say: an account with Cursor agents on
 * (`EXPERIMENT.CURSOR`), on a client that reads Cursor as a provider
 * (`CURSOR_CLIENT_API_VERSION`).
 */

import type { CursorModelSelection } from "@repo/agent-runner/protocol";
import { modelIdAtSpeed } from "@repo/features/model-effort";
import { MODEL_PROVIDER, MODEL_SPEED, NO_EFFORT } from "@repo/features/models-wire";
import { type OfferedModel, providerModelOf } from "./model-catalog.js";

/** The first hosted API version (`HOSTED_API_VERSION`) whose clients read `cursor` as a provider; a catalog answer to an older one never holds a Cursor entry, which would refuse its whole read. */
const CURSOR_CLIENT_API_VERSION = 4;

/** The parameters of Cursor's model list this module names, by Cursor's own ids. */
const CURSOR_PARAMETER = {
  EFFORT: "effort",
  REASONING_EFFORT: "reasoning_effort",
  REASONING: "reasoning",
  FAST: "fast",
  CONTEXT: "context",
} as const;

type CursorParameter = (typeof CURSOR_PARAMETER)[keyof typeof CURSOR_PARAMETER];

/** The parameters a model spells its effort by. */
type CursorEffortParameter = Extract<
  CursorParameter,
  | typeof CURSOR_PARAMETER.EFFORT
  | typeof CURSOR_PARAMETER.REASONING_EFFORT
  | typeof CURSOR_PARAMETER.REASONING
>;

/** One parameter of Cursor's `ModelSelection`, as its model list spells it. */
interface CursorParameterValue {
  readonly id: CursorParameter;
  readonly value: string;
}

/** One Cursor model as we offer it, and Cursor's own words for it. */
interface CursorModel {
  /** Cursor's model id, which `ModelSelection.id` takes. */
  readonly cursorId: string;
  /** Cursor's name for it. */
  readonly name: string;
  /** The parameter its effort is spelled by and the values it lists, which are the catalog's efforts as they are; none for a model with no effort of its own. */
  readonly effort:
    | { readonly parameter: CursorEffortParameter; readonly values: readonly string[] }
    | undefined;
  /** Whether it takes `fast`, and so is offered at fast speed beside its own. */
  readonly fast: boolean;
  /** What every choice of it sends as it is: its standard window, where it lists two. */
  readonly pinned: readonly CursorParameterValue[];
}

/**
 * The Cursor models offered, by catalog id, in the order the catalog lists
 * them: Composer 2.5, Cursor's own, whose default variant is its fast one;
 * Auto, Cursor's choice of model per request (`default`, which Cursor also
 * answers to as `auto`, so a label read off the id says Auto); and Grok
 * 4.7, pinned to its 256K window, its 500K one being Max Mode's.
 */
const CURSOR_MODELS = {
  "cursor/composer-2.5": {
    cursorId: "composer-2.5",
    name: "Composer 2.5",
    effort: undefined,
    fast: true,
    pinned: [],
  },
  "cursor/auto": {
    cursorId: "default",
    name: "Auto",
    effort: undefined,
    fast: false,
    pinned: [],
  },
  "cursor/grok-4.7": {
    cursorId: "grok-4.7",
    name: "Grok 4.7",
    effort: {
      parameter: CURSOR_PARAMETER.REASONING_EFFORT,
      values: ["low", "medium", "high", "xhigh"],
    },
    fast: true,
    pinned: [{ id: CURSOR_PARAMETER.CONTEXT, value: "256k" }],
  },
} as const satisfies Record<string, CursorModel>;

/** The catalog entries one Cursor model is offered as: its own, and its fast version right after it where it takes `fast`. */
function catalogEntriesOf(catalogId: string, model: CursorModel): readonly OfferedModel[] {
  const own: OfferedModel = {
    id: catalogId,
    name: model.name,
    provider: MODEL_PROVIDER.CURSOR,
    efforts: model.effort?.values ?? [NO_EFFORT],
  };

  if (!model.fast) return [own];

  return [
    own,
    { ...own, id: modelIdAtSpeed(catalogId, MODEL_SPEED.FAST), name: `${model.name} (Fast)` },
  ];
}

/** Every Cursor model as the catalog offers it, each fast version right after its model. */
const CURSOR_CATALOG: readonly OfferedModel[] = Object.entries(CURSOR_MODELS).flatMap(
  ([catalogId, model]) => catalogEntriesOf(catalogId, model),
);

/** What decides whether a catalog answer holds Cursor's models: the account's choice of Cursor agents, and the hosted API version the client asking was built against, none where it named none. */
export interface CursorOffer {
  readonly experimentOn: boolean;
  readonly apiVersion: number | undefined;
}

/** Whether Cursor's models are offered: to an account with Cursor agents on, on a client that reads Cursor as a provider. */
function offersCursor(offer: CursorOffer): boolean {
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
): readonly OfferedModel[] {
  return offersCursor(offer) ? [...models, ...CURSOR_CATALOG] : models;
}

/** Whether a catalog id is one of Cursor's models as offered (`CURSOR_MODELS`). */
function isCursorModel(catalogId: string): catalogId is keyof typeof CURSOR_MODELS {
  return Object.hasOwn(CURSOR_MODELS, catalogId);
}

/**
 * The model a Cursor agent on the catalog id and effort given runs, as
 * Cursor's SDK takes it (`ModelSelection`): Cursor's id, every parameter
 * the entry pins, its effort under the parameter it spells it by where it
 * lists the effort, and `fast` where it takes it, true for the fast
 * version. No entry needs Max Mode, so none is asked. None for an id that
 * is not one of Cursor's models.
 */
export function cursorModelSelectionOf(
  catalogId: string,
  effort: string,
): CursorModelSelection | undefined {
  const model = providerModelOf(catalogId);
  const standardId = model === undefined ? catalogId : `${MODEL_PROVIDER.CURSOR}/${model.modelId}`;

  if (model?.provider !== MODEL_PROVIDER.CURSOR || !isCursorModel(standardId)) return undefined;
  const entry: CursorModel = CURSOR_MODELS[standardId];

  const effortParam =
    entry.effort?.values.includes(effort) === true
      ? [{ id: entry.effort.parameter, value: effort }]
      : [];

  const fastParam = entry.fast
    ? [{ id: CURSOR_PARAMETER.FAST, value: String(model.speed === MODEL_SPEED.FAST) }]
    : [];

  const params = [...entry.pinned, ...effortParam, ...fastParam];

  return params.length === 0 ? { id: entry.cursorId } : { id: entry.cursorId, params };
}
