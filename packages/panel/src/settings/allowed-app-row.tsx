import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  APP_ICON_SIZE,
  AppIcon,
  IconButton,
  SettingsRow,
  type SettingsRowIndent,
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
 */

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
