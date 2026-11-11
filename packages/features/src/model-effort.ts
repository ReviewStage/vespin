// model-effort.ts -- a model's efforts and speeds as a picker offers them: the efforts it lists, the one a choice keeps across a change of model, each effort's label, the speeds it runs at, and their words.

import {
  type CatalogModel,
  MODEL_SPEED,
  MODEL_SPEED_SUFFIX,
  type ModelSpeed,
} from "./models-wire.js";

/** The efforts a model lists, or nothing for a model the catalog does not offer now. */
export function effortsOf(models: readonly CatalogModel[], modelId: string): readonly string[] {
  return models.find((model) => model.id === modelId)?.efforts ?? [];
}

/** The standard effort scale, lowest first, which a fallback across models walks. */
const EFFORT_SCALE: readonly string[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** Where an effort stands on the scale; nothing for a name the scale does not know. */
function effortRank(effort: string): number | undefined {
  const rank = EFFORT_SCALE.indexOf(effort);
  return rank === -1 ? undefined : rank;
}

/**
 * The effort a model keeps across a change of model or of its fast version:
 * the one chosen where the model lists it; else the nearest the model lists
 * at or below it on the scale, so Extra high lands on High rather than on
 * Low; else, with nothing below, the lowest it lists above; else the model's
 * first, for a name the scale does not know.
 */
export function effortFor(
  efforts: readonly string[],
  chosen: string | undefined,
): string | undefined {
  if (chosen !== undefined && efforts.includes(chosen)) return chosen;
  const wanted = chosen === undefined ? undefined : effortRank(chosen);
  if (wanted === undefined) return efforts[0];
  const ranked = efforts
    .map((effort) => ({ effort, rank: effortRank(effort) }))
    .filter((each): each is { effort: string; rank: number } => each.rank !== undefined)
    .sort((a, b) => a.rank - b.rank);
  const below = ranked.filter((each) => each.rank < wanted).at(-1);
  return below?.effort ?? ranked[0]?.effort ?? efforts[0];
}

/** The catalog's effort names a sentence-case label does not spell by capitalizing. */
const EFFORT_LABEL: ReadonlyMap<string, string> = new Map([["xhigh", "Extra high"]]);

/** The catalog's effort names are lowercase words; a menu and a segment read them in sentence case. */
export function effortLabel(effort: string): string {
  return EFFORT_LABEL.get(effort) ?? `${effort.charAt(0).toUpperCase()}${effort.slice(1)}`;
}

/** The word a choice label, the Fast row, and the Speed choice say for each speed. */
export const SPEED_WORD = {
  [MODEL_SPEED.STANDARD]: "Standard",
  [MODEL_SPEED.FAST]: "Fast",
  [MODEL_SPEED.ULTRAFAST]: "Ultrafast",
} as const satisfies Record<ModelSpeed, string>;

/** The word a choice label and the Fast row say for the fast version. */
export const FAST_WORD = SPEED_WORD[MODEL_SPEED.FAST];

/** The word the Speed choice is named by, which stands in the Fast row's place for a model with an Ultrafast version. */
export const SPEED_LABEL = "Speed";

/** The catalog id of a standard model's version at a speed: its own id at the standard speed. */
export function modelIdAtSpeed(standardId: string, speed: ModelSpeed): string {
  return speed === MODEL_SPEED.STANDARD ? standardId : `${standardId}${MODEL_SPEED_SUFFIX[speed]}`;
}

/** The speeds the catalog offers a standard model at, standard first; none for a model it does not offer. */
export function speedsOffered(
  models: readonly CatalogModel[],
  standardId: string,
): readonly ModelSpeed[] {
  return Object.values(MODEL_SPEED).filter((speed) =>
    models.some(({ id }) => id === modelIdAtSpeed(standardId, speed)),
  );
}
