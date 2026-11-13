import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  APP_ICON_SIZE,
  AppIcon,
  IconButton,
  SettingsRow,
  type SettingsRowIndent,
  SettingsRowsFold,
  Tooltip,
  TrashIcon,
} from "@repo/ui";
import { rejectionWords, useAsyncAction } from "@repo/ui/use-async-action";
import { refusalShown } from "../failure-report.js";
import { macAppIconAddress } from "../tasks/mac-apps.js";
import type { SettingRefusal } from "./row-write.js";

/**
 * allowed-app-row.tsx -- one app agents use without asking, as Settings lists it wherever it does: on This Mac, and under each machine on Machines.
 *
 * The app stands by its own icon where the Mac drew one, its name, and the
 * bundle id it is allowed by, with a Remove at the row's end that rests
 * until its write answers and says under the row why where it was refused.
 * A long list shows its first few apps, and folds the rest under one row
 * that says how many more there are (`AllowedAppList`), so a machine that
 * allows many apps never buries the settings after them.
 */

/** How many apps a list shows before it folds the rest. */
const SHOWN_APPS = 4;

/** An app allowed without asking, by the bundle id it is allowed by, its name, and its icon as a PNG's base64 where the Mac drew one. */
export interface AllowedApp {
  readonly bundleId: string;
  readonly name: string;
  readonly iconPng?: string | undefined;
}

export function AllowedAppRow({
  app,
  indent,
  onRemove,
}: {
  app: AllowedApp;
  /** Whether the row stands inset under the row above, as under its machine. */
  indent?: SettingsRowIndent | undefined;
  /** Takes the app off the list, answering why where the write was refused. */
  onRemove: (bundleId: string) => Promise<SettingRefusal | undefined>;
}): React.JSX.Element {
  // A Remove that did not answer, as the row says it.
  const remove = useAsyncAction(
    (rejected): SettingRefusal => ({ words: rejectionWords(rejected), cause: rejected }),
  );

  const label = `Remove ${app.name}`;

  return (
    <SettingsRow
      indent={indent}
      leading={<AppIcon src={macAppIconAddress(app.iconPng)} size={APP_ICON_SIZE.LEAD} />}
      label={app.name}
      description={app.bundleId}
      error={refusalShown(remove.refusal, FAILURE_SURFACE.SETTING_WRITE)}
      end={() => (
        <Tooltip label={label}>
          <IconButton
            icon={<TrashIcon />}
            label={label}
            busy={remove.running}
            busyLabel={`Removing ${app.name}`}
            onClick={() => void remove.run(() => onRemove(app.bundleId))}
          />
        </Tooltip>
      )}
    />
  );
}

/** The apps a machine lets agents use unasked: the first few, and the rest folded under a row that says how many, which opens them. */
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
  const row = (app: AllowedApp) => (
    <AllowedAppRow key={app.bundleId} app={app} indent={indent} onRemove={onRemove} />
  );

  // Note that one app past the few is shown rather than folded, since a row saying "1 more app" takes as much room as the app.
  if (apps.length <= SHOWN_APPS + 1) return <>{apps.map(row)}</>;
  const rest = apps.slice(SHOWN_APPS);
  const more = `${rest.length} more apps`;

  return (
    <>
      {apps.slice(0, SHOWN_APPS).map(row)}
      <SettingsRowsFold
        label={`Show ${more}`}
        head={(chevron) => (
          <SettingsRow
            indent={indent}
            label={more}
            description={rest.map((app) => app.name).join(", ")}
            end={() => chevron}
          />
        )}
        rows={rest.map(row)}
      />
    </>
  );
}
