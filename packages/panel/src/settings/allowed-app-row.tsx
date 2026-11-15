import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { APP_ICON_SIZE, AppIcon, type SettingsRowIndent } from "@repo/ui";
import { rejectionWords, useAsyncAction } from "@repo/ui/use-async-action";
import { refusalShown } from "../failure-report.js";
import { macAppIconAddress } from "../tasks/mac-apps.js";
import { MenuRow } from "./menu-row.js";
import type { SettingRefusal } from "./row-write.js";

/**
 * allowed-app-row.tsx -- the apps agents use without asking, as Settings lists them wherever it does: on This Mac, and under each machine on Machines.
 *
 * The list reads as Settings › Agents' Always allowed commands does, the
 * other list of what agents do unasked: every app, one row each, its acts
 * in the row's ⋯ (`MenuRow`), here Remove. Each app stands by its own icon
 * where the Mac drew one and its name, which says which app it is better
 * than the bundle id it is allowed by; an app the Mac has no name for yet
 * stands by that id. A Remove the write refused says why under its row.
 */

/** What an app's ⋯ offers. */
const REMOVE = "Remove";

/** An app allowed without asking, by the bundle id it is allowed by, its name, and its icon as a PNG's base64 where the Mac drew one. */
export interface AllowedApp {
  readonly bundleId: string;
  readonly name: string;
  readonly iconPng?: string | undefined;
}

function AllowedAppRow({
  app,
  indent,
  onRemove,
}: {
  app: AllowedApp;
  indent: SettingsRowIndent | undefined;
  onRemove: (bundleId: string) => Promise<SettingRefusal | undefined>;
}): React.JSX.Element {
  // A Remove that did not answer, as the row says it.
  const remove = useAsyncAction(
    (rejected): SettingRefusal => ({ words: rejectionWords(rejected), cause: rejected }),
  );

  return (
    <MenuRow
      thing={app.name}
      actions={[
        {
          label: REMOVE,
          disabled: remove.running,
          onSelect: () => void remove.run(() => onRemove(app.bundleId)),
        },
      ]}
      row={{
        leading: <AppIcon src={macAppIconAddress(app.iconPng)} size={APP_ICON_SIZE.LEAD} />,
        label: app.name,
        error: refusalShown(remove.refusal, FAILURE_SURFACE.SETTING_WRITE),
        ...(indent === undefined ? undefined : { indent }),
      }}
    />
  );
}

/** The apps a machine lets agents use unasked, every one in its row. */
export function AllowedAppList({
  apps,
  indent,
  onRemove,
}: {
  apps: readonly AllowedApp[];
  /** Whether the rows stand inset under the row above, as under their machine. */
  indent?: SettingsRowIndent | undefined;
  onRemove: (bundleId: string) => Promise<SettingRefusal | undefined>;
}): React.JSX.Element {
  return (
    <>
      {apps.map((app) => (
        <AllowedAppRow key={app.bundleId} app={app} indent={indent} onRemove={onRemove} />
      ))}
    </>
  );
}
