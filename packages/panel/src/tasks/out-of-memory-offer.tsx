/**
 * out-of-memory-offer.tsx -- a command the kernel killed for want of memory, as its call offers the members who manage its workspace a larger sandbox, on the card a failed call's remedy stands on.
 *
 * The call's own answer already ends in the line saying it was killed and
 * how much memory the sandbox had, which every reader sees. Under it, an
 * owner or admin of the agent's workspace is offered the next size up, one
 * press away where the most the workspace may have allows it
 * (`useChooseSandboxSize`), and told a larger one is available on request
 * where it does not; once the workspace opens its sandboxes larger than the
 * command ran with, the line says the size it moved to. Anyone else sees the
 * answer's line alone. What the offer is comes from `outOfMemoryOffer`, over
 * the workspace's size as the service answers it (`sandboxSizeQuery`). It
 * is drawn as a refused machine call's card is (`machine-refusal-card.tsx`):
 * `Banner`'s card in the danger tone, what failed on its first line, what
 * stands on the next, and the remedy as its action.
 */

import type { OutOfMemory } from "@repo/features/out-of-memory-wire";
import {
  OUT_OF_MEMORY_OFFER,
  outOfMemoryOffer,
  sandboxMemoryGb,
} from "@repo/features/sandbox-size";
import { managesWorkspace } from "@repo/features/workspace-role";
import {
  BANNER_GLYPH,
  BANNER_LOOK,
  Banner,
  BUTTON_VARIANT,
  Button,
  STATUS_TONE,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { actFailureWords } from "../act.js";
import { sandboxSizeQuery, useChooseSandboxSize } from "../workspace-sandbox-size.js";
import { useMentionDoors } from "./task-mentions.js";
import { useWordsWorkspace } from "./use-link-standing.js";

/** What the card says, as it says it. */
const OUT_OF_MEMORY_WORDS = {
  KILLED: "The sandbox ran out of memory.",
  ON_REQUEST: "A larger sandbox is available on request.",
  USING: "Using…",
} as const;

/** What the card says under its first line: the size the workspace now opens with, the size it stands at, or that a larger one is on request. */
function captionOf(offer: ReturnType<typeof outOfMemoryOffer>, standingGb: number): string {
  switch (offer.kind) {
    case OUT_OF_MEMORY_OFFER.RAISED:
      return `This workspace now uses ${offer.memoryGb} GB.`;
    case OUT_OF_MEMORY_OFFER.ON_REQUEST:
      return OUT_OF_MEMORY_WORDS.ON_REQUEST;
    default:
      return `This workspace's sandboxes have ${standingGb} GB.`;
  }
}

/** The card under a call killed out of memory: the offer of the next size up to the members who manage the agent's workspace, and nothing to anyone else. */
export function OutOfMemoryOffer({ outOfMemory }: { outOfMemory: OutOfMemory }): ReactNode {
  const doors = useMentionDoors();

  const workspace = useWordsWorkspace({
    taskId: doors.holder?.taskId,
    workspace: doors.place.workspace,
  });

  const manages = workspace !== undefined && managesWorkspace(workspace);
  const workspaceId = workspace?.id ?? "";
  const { data: size } = useQuery({ ...sandboxSizeQuery(workspaceId), enabled: manages });
  const choose = useChooseSandboxSize(workspaceId);

  if (!manages || size === undefined) return null;
  const offer = outOfMemoryOffer(outOfMemory.memoryGb, size);

  if (offer.kind === OUT_OF_MEMORY_OFFER.NONE) return null;

  const action =
    offer.kind === OUT_OF_MEMORY_OFFER.RAISE ? (
      <Button
        variant={BUTTON_VARIANT.OUTLINE}
        {...(choose.isPending ? { busy: true, busyLabel: OUT_OF_MEMORY_WORDS.USING } : undefined)}
        disabled={choose.isPending}
        onClick={() => choose.mutate(offer.vcpus)}
      >
        {`Use ${offer.memoryGb} GB for this workspace`}
      </Button>
    ) : undefined;

  return (
    <div className="mt-list-gap mr-0 mb-item-gap ml-transcript-gutter" data-out-of-memory-offer="">
      <Banner
        look={BANNER_LOOK.CARD}
        tone={STATUS_TONE.DANGER}
        glyph={<GLYPH.FAILED />}
        glyphLook={BANNER_GLYPH.MARK}
        actions={action}
      >
        <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.LABEL}>
          {OUT_OF_MEMORY_WORDS.KILLED}
        </Text>
        <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {captionOf(offer, sandboxMemoryGb(size.vcpus))}
          {choose.isError ? ` ${actFailureWords(choose.error)}` : null}
        </Text>
      </Banner>
    </div>
  );
}
