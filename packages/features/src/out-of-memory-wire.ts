/**
 * out-of-memory-wire.ts -- a command the kernel killed for want of memory, as its settled tool call keeps it: the sandbox's memory as it ran, under the provider key no provider reads.
 *
 * The runner marks such a call ahead of its answer (`@repo/agent-runner`'s
 * `RUNNER_EVENT.OUT_OF_MEMORY`), and the service settles the call with the
 * mark on the part's `resultProviderMetadata` (`turn-run/ui-messages.ts`'s
 * `settledToolPart`), where the AI SDK keeps what it does not read and a
 * client built before the mark reads the part as it always did. The
 * transcript draws the call's offer of a larger sandbox from it
 * (`sandbox-size.ts`'s `outOfMemoryOffer`).
 */

import type { WireBoundaryInput } from "@repo/wire";
import type { ProviderMetadata } from "ai";
import { Schema as EffectSchema, Option } from "effect";

/** The provider key the mark is kept under, which no provider reads, as a kept image's is (`conversation-picture-wire.ts`). */
const OUT_OF_MEMORY_PROVIDER_KEY = "app";

/** A call killed out of memory: the sandbox's memory as the command ran, in whole GB. */
export interface OutOfMemory {
  readonly memoryGb: number;
}

const outOfMemoryMetadataSchema = EffectSchema.Struct({
  [OUT_OF_MEMORY_PROVIDER_KEY]: EffectSchema.Struct({
    outOfMemory: EffectSchema.Struct({
      memoryGb: EffectSchema.Int.check(EffectSchema.isGreaterThan(0)),
    }),
  }),
});

const readOutOfMemoryMetadata = EffectSchema.decodeUnknownOption(outOfMemoryMetadataSchema);

/** The mark as a settled tool part keeps it, in its `resultProviderMetadata`. */
export function outOfMemoryMetadata(mark: OutOfMemory): ProviderMetadata {
  return { [OUT_OF_MEMORY_PROVIDER_KEY]: { outOfMemory: { memoryGb: mark.memoryGb } } };
}

/** The mark a settled tool part's `resultProviderMetadata` keeps; none for a call not killed out of memory. */
export function outOfMemoryOf(resultProviderMetadata: WireBoundaryInput): OutOfMemory | undefined {
  return Option.getOrUndefined(
    Option.map(
      readOutOfMemoryMetadata(resultProviderMetadata),
      (read) => read[OUT_OF_MEMORY_PROVIDER_KEY].outOfMemory,
    ),
  );
}
