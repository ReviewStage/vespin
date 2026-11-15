/**
 * out-of-memory-offer.tsx -- a command the kernel killed for want of memory, as its call offers the members who manage its workspace a larger sandbox.
 *
 * The call's own answer already ends in the line saying it was killed and
 * how much memory the sandbox had, which every reader sees. Under it, an
 * owner or admin of the agent's workspace is offered the next size up, one
 * press away where the most the workspace may have allows it
 * (`useChooseSandboxSize`), and told a larger one is available on request
 * where it does not; once the workspace opens its sandboxes larger than the
 * command ran with, the line says the size it moved to. Anyone else sees the
 * answer's line alone. What the offer is comes from `outOfMemoryOffer`, over
 * the workspace's size as the service answers it (`sandboxSizeQuery`).
 */

import type { OutOfMemory } from "@repo/features/out-of-memory-wire";
import { OUT_OF_MEMORY_OFFER, outOfMemoryOffer } from "@repo/features/sandbox-size";
import { managesWorkspace } from "@repo/features/workspace-role";
import { NOTE_LINE_LOOK, NoteLine, TEXT_BUTTON_TONE, TextButton } from "@repo/ui";
import { GLYPH } from "@repo/ui/icons";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { actFailureWords } from "../act.js";
import { sandboxSizeQuery, useChooseSandboxSize } from "../workspace-sandbox-size.js";
import { useMentionDoors } from "./task-mentions.js";
import { useWordsWorkspace } from "./use-link-standing.js";

/** What the offer says on request, where the next size stands above the most the workspace may have. */
const ON_REQUEST = "A larger sandbox is available on request.";

/** The line under a call killed out of memory: the offer of the next size up to the members who manage the agent's workspace, and nothing to anyone else. */
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

  return (
    <div className="ml-transcript-gutter" data-out-of-memory-offer="">
      <NoteLine look={NOTE_LINE_LOOK.TRAIL} glyph={<GLYPH.RAM />}>
        {offer.kind === OUT_OF_MEMORY_OFFER.RAISED ? (
          `This workspace now uses ${offer.memoryGb} GB.`
        ) : offer.kind === OUT_OF_MEMORY_OFFER.ON_REQUEST ? (
          ON_REQUEST
        ) : (
          <TextButton
            tone={TEXT_BUTTON_TONE.ACCENT}
            onClick={() => {
              if (!choose.isPending) choose.mutate(offer.vcpus);
            }}
          >
            {`Use ${offer.memoryGb} GB for this workspace`}
          </TextButton>
        )}
        {choose.isError ? ` ${actFailureWords(choose.error)}` : null}
      </NoteLine>
    </div>
  );
}
