import {
  SANDBOX_SIZE,
  SANDBOX_VCPU_SIZES,
  type SandboxVcpus,
  sandboxSizeWords,
  sandboxVcpusOf,
} from "@repo/features/sandbox-size";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords } from "@repo/features/words";
import { managesWorkspace } from "@repo/features/workspace-role";
import type { Workspace } from "@repo/features/workspace-wire";
import {
  SETTINGS_SKELETON_CONTROL,
  type SettingsRowSkeletonLayout,
  SettingsRowsSkeleton,
  SettingsSection,
} from "@repo/ui";
import { useQuery } from "@tanstack/react-query";
import { sandboxSizeQuery, useChooseSandboxSize } from "../workspace-sandbox-size.js";
import { ReadFailed } from "./marks.js";
import { rowWrite } from "./row-write.js";
import { SelectRow } from "./select-row.js";
import { SECTION, settingsSectionHead } from "./settings-sections.js";

/**
 * sandbox-size-section.tsx -- Settings › Cloud environment's Sandbox: the one size every cloud agent's sandbox in the workspace opens with, chosen by its owners and admins.
 *
 * One row picks among the sizes a workspace may have, each its vCPUs and
 * the memory they bring, the size a workspace starts at marked as the
 * default; any of them may be chosen (Dean, 2026-11-15). A choice reaches
 * new agents at once and standing ones at their next start, as the
 * section's caption says. A member who is no owner or admin sees the size
 * locked, the reason its hover, as a locked switch says it.
 */

/** The words the section and its row say. */
const WORDS = {
  CAPTION:
    "Applies to every cloud agent in this workspace: new agents use it right away, and existing ones the next time they start.",
  SIZE: "Size",
  DEFAULT: "Default",
  LOCKED: "Only an owner or admin can change this",
} as const;

/** The size row while the size is read. */
const SIZE_ROW_SKELETON: SettingsRowSkeletonLayout = {
  described: false,
  controls: [SETTINGS_SKELETON_CONTROL.SELECT],
};

/** Every size a workspace may have, the one it starts at marked as the default. */
const SIZE_OPTIONS = SANDBOX_VCPU_SIZES.map((vcpus) => ({
  value: vcpus,
  label: sandboxSizeWords(vcpus),
  tag: vcpus === SANDBOX_SIZE.VCPUS ? WORDS.DEFAULT : undefined,
}));

/** The size's row once read: its picker, locked for a member who is no owner or admin. */
function SizeRow({
  workspace,
  vcpus,
}: {
  workspace: Workspace;
  vcpus: SandboxVcpus;
}): React.JSX.Element {
  const choosing = useChooseSandboxSize(workspace.id);

  return (
    <SelectRow
      label={WORDS.SIZE}
      labelReplayUnmasked
      value={vcpus}
      options={SIZE_OPTIONS}
      parse={sandboxVcpusOf}
      locked={managesWorkspace(workspace) ? undefined : WORDS.LOCKED}
      write={rowWrite(choosing, {
        ask: (chosen: SandboxVcpus) => chosen,
        refused: () => undefined,
        drawn: (asked) => asked,
      })}
    />
  );
}

/** Sandbox over one workspace: its size, read as the page opens. */
export function SandboxSizeSection({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const size = useQuery(sandboxSizeQuery(workspace.id));
  const answer = size.data;
  const vcpus = answer === undefined ? undefined : sandboxVcpusOf(String(answer.vcpus));

  return (
    <SettingsSection {...settingsSectionHead(SECTION.ENVIRONMENT_SANDBOX)} caption={WORDS.CAPTION}>
      {size.isError ? (
        <ReadFailed
          line="The sandbox size could not be read."
          surface={FAILURE_SURFACE.WORKSPACE_SANDBOX_SIZE_READ}
          onRetry={() => void size.refetch()}
        />
      ) : answer === undefined ? (
        <SettingsRowsSkeleton label={readingWords("the sandbox size")} rows={[SIZE_ROW_SKELETON]} />
      ) : (
        <SizeRow workspace={workspace} vcpus={vcpus ?? SANDBOX_SIZE.VCPUS} />
      )}
    </SettingsSection>
  );
}
