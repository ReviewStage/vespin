import { choiceOn, effortFor } from "@repo/features/model-effort";
import {
  AGENT_FALLBACK_CHOICE,
  type CatalogModel,
  type ModelChoice,
  type ModelProvider,
} from "@repo/features/models-wire";
import { offeredModels, providerOf, readModelChoice, unsearchedModels } from "./agent-model.js";

/**
 * refusal-offer.ts -- the model a turn the model refused offers to continue on: the other harness's, where the reader can run it, else another of the same harness's, and the harness to connect where the other one cannot run.
 *
 * A refusal is the model's own (a provider's safeguards), so a message to
 * the agent only meets it again; a continue on another model, which carries
 * the transcript across, is the way on. The offer leads with the other
 * harness, since its provider's safeguards are its own: the model a new
 * agent of that harness starts on (`AGENT_FALLBACK_CHOICE`) where the
 * catalog offers it, else the newest of its families, else any. Where no
 * plan or API key of the reader's pays for the other harness, since the
 * reader's own credentials pay for a continue, it offers the same harness's
 * other models in the same order, and names the other harness to connect.
 * The effort carries over as a change of model keeps it (`effortFor`).
 */

/** What a refused turn offers: the choice its press continues on, and the harness the reader could connect to continue there instead. */
export interface RefusalOffer {
  /** The choice the press continues on; none where nothing the reader runs is another model. */
  readonly choice: ModelChoice | undefined;
  /** The other harness, where no credential of the reader's pays for it, which the offer names to connect; none where it runs. */
  readonly connect: ModelProvider | undefined;
}

/** The model a pool leads with: the one a new agent of its harness starts on, else the newest of a family, else its first. */
function leadOf(
  pool: readonly CatalogModel[],
  newest: ReadonlySet<string>,
): CatalogModel | undefined {
  const fallbacks = new Set<string>(Object.values(AGENT_FALLBACK_CHOICE).map((each) => each.model));

  return (
    pool.find((model) => fallbacks.has(model.id)) ??
    pool.find((model) => newest.has(model.id)) ??
    pool[0]
  );
}

/** What a turn `source` ran on and the model refused offers to continue on, from the catalog as the reader is offered it. */
export function refusalOffer(
  models: readonly CatalogModel[],
  source: Pick<ModelChoice, "model" | "effort">,
): RefusalOffer {
  const provider = providerOf(source.model);
  const { base } = readModelChoice(models, source.model);
  const newest = unsearchedModels(models, undefined);

  const others = offeredModels(models)
    .map((each) => each.model)
    .filter((model) => model.id !== base);

  const otherHarness = others.filter((model) => model.provider !== provider);
  const runs = otherHarness.filter((model) => model.credentialMissing !== true);

  const sameHarness = others.filter(
    (model) => model.provider === provider && model.credentialMissing !== true,
  );

  const lead = leadOf(runs, newest) ?? leadOf(sameHarness, newest);
  const effort = lead === undefined ? undefined : effortFor(lead.efforts, source.effort);

  return {
    choice:
      lead === undefined || effort === undefined
        ? undefined
        : choiceOn(models, { model: lead.id, effort }, undefined),
    connect: runs.length > 0 ? undefined : otherHarness[0]?.provider,
  };
}
