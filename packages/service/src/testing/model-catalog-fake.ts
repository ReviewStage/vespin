/**
 * model-catalog-fake.ts -- the model catalog over an AI Gateway that answers a small fixed catalog, for a local server an end-to-end suite starts.
 *
 * Agent Start reads AI Gateway's public catalog and refuses as unavailable
 * without it, so a suite that may not reach the network hands this layer to
 * the local server (`overrideLocalRuntime({ modelCatalog })`). It is the real
 * `modelCatalogLayer` over an HTTP client that answers `FAKE_GATEWAY_CATALOG`
 * to every request, so the entries are read through the same schema, filter,
 * and pricing as the deployment's, and an entry the reader would refuse is
 * refused here too.
 *
 * The entries are AI Gateway's own, as its `/v1/models` answered them on Nov
 * 22, 2026, with each `pricing.regional` table left out, since nothing reads
 * it: the default choice's model and one other Anthropic model, so a suite
 * can start a Claude Code agent and change its model. A nightly job holds
 * them against the live catalog, which is why they stand exported in one
 * place.
 */

import { fakeHttpClientLayer, jsonResponse } from "@repo/wire/testing";
import { Layer } from "effect";
import { type ModelCatalog, modelCatalogLayer } from "../providers/model-catalog.js";

/** The tags an Anthropic entry carries but for `fast`, which only a model with a fast mode lists. */
const ANTHROPIC_TAGS = [
  "explicit-caching",
  "file-input",
  "reasoning",
  "tool-use",
  "vision",
  "web-search",
  "structured-output",
];

/** The fields both Anthropic entries list alike. */
const ANTHROPIC_ENTRY_FIELDS = {
  object: "model",
  created: 1755815280,
  owned_by: "anthropic",
  context_window: 1000000,
  max_tokens: 128000,
  type: "language",
  zdr: "all",
  no_training: "all",
  supported_specifications: ["v2", "v3", "v4"],
  modalities: { input: ["text", "image", "pdf"], output: ["text"] },
  supported_parameters: [
    "max_tokens",
    "stop",
    "tools",
    "tool_choice",
    "reasoning",
    "include_reasoning",
    "response_format",
    "structured_outputs",
  ],
  temperature: false,
  reasoning_options: [{ type: "effort", values: ["low", "medium", "high", "xhigh", "max"] }],
  knowledge: "2026-06",
};

/**
 * The catalog the fake gateway answers, in AI Gateway's `/v1/models` shape.
 * @public
 */
export const FAKE_GATEWAY_CATALOG = {
  object: "list",
  data: [
    {
      ...ANTHROPIC_ENTRY_FIELDS,
      id: "anthropic/claude-opus-5.5",
      released: 1790035200,
      name: "Claude Opus 5.5",
      description:
        "Claude Opus 5.5 is a step-change improvement over Opus 5 for agentic coding, long-running agentic tasks, knowledge work, communication, and vision. It is more token-efficient per completed task and reports progress, findings, and next steps in clear language.",
      tags: [
        "explicit-caching",
        "fast",
        "file-input",
        "reasoning",
        "tool-use",
        "vision",
        "web-search",
        "structured-output",
      ],
      regions: ["au", "eu", "jp", "us"],
      pricing: {
        input: "0.000004",
        output: "0.00002",
        input_cache_read: "0.0000002",
        input_cache_write: "0.000005",
        web_search: "10",
        fast: {
          input: "0.000008",
          output: "0.00004",
          input_cache_read: "0.0000004",
          input_cache_write: "0.00001",
        },
      },
    },
    {
      ...ANTHROPIC_ENTRY_FIELDS,
      id: "anthropic/claude-sonnet-5.5",
      released: 1790553600,
      name: "Claude Sonnet 5.5",
      description:
        "Claude Sonnet 5.5 is a step-change improvement over Sonnet 5 for well-scoped everyday work like building features, fixing bugs, and creating polished documents, slides, and spreadsheets. It also writes more clearly than Sonnet 5.",
      tags: ANTHROPIC_TAGS,
      regions: ["au", "eu", "us"],
      pricing: {
        input: "0.000002",
        output: "0.00001",
        input_cache_read: "0.0000001",
        input_cache_write: "0.0000025",
        web_search: "10",
      },
    },
  ],
} as const;

/**
 * The model catalog as the deployment builds it, over a gateway that answers `FAKE_GATEWAY_CATALOG`.
 * @public
 */
export const fakeModelCatalogLayer: Layer.Layer<ModelCatalog> = modelCatalogLayer.pipe(
  Layer.provide(fakeHttpClientLayer(() => jsonResponse(FAKE_GATEWAY_CATALOG))),
);
