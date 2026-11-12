import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords } from "@repo/features/words";
import { SettingsRowsSkeleton, SettingsSection } from "@repo/ui";
import { Fragment } from "react";
import { CloudSetupSections } from "./cloud-setup-sections.js";
import { ConductorImportSection } from "./conductor-import-section.js";
import {
  EnvironmentVariablesSection,
  VARIABLE_ROW_SKELETON,
} from "./environment-variables-section.js";
import { ReadFailed } from "./marks.js";
import { shownWorkspace } from "./settings-rows.js";
import type { WorkspaceSettingsControl } from "./workspace-page.js";

/**
 * cloud-environment-page.tsx -- Settings › Cloud environment: what the workspace's cloud agents start with, its variables and then its scripts, on one page since both exist only for those agents, and an import from Conductor beside them.
 *
 * Variables comes first, Add variable on its heading, then Install
 * software, Setup scripts, and Archive scripts, each section reading and
 * saving its own as it did on a page of its own, and last Import from
 * Conductor, since a team moving over brings its scripts with it.
 */

/** Settings › Cloud environment over the workspace the sidebar lists, or why there is none to show; signed in, as Settings draws it. */
export function CloudEnvironmentPage({
  control,
}: {
  /** The account's workspaces, drawn while it is signed in. */
  control: WorkspaceSettingsControl | undefined;
}): React.JSX.Element | null {
  if (control === undefined) return null;
  const workspace = shownWorkspace(control);

  if (workspace === undefined) {
    return control.listFailed ? (
      <SettingsSection>
        <ReadFailed
          line="Your workspaces could not be read."
          surface={FAILURE_SURFACE.WORKSPACES_READ}
          onRetry={control.onRetryList}
        />
      </SettingsSection>
    ) : (
      <SettingsRowsSkeleton
        label={readingWords("the cloud environment")}
        rows={[VARIABLE_ROW_SKELETON]}
      />
    );
  }

  // Keyed to the workspace, so another one listed reads its own variables and scripts and asks nothing left over.
  return (
    <Fragment key={workspace.id}>
      <EnvironmentVariablesSection workspace={workspace} />
      <CloudSetupSections workspace={workspace} />
      <ConductorImportSection workspace={workspace} />
    </Fragment>
  );
}
