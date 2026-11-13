import { searchAnchorProps } from "@repo/settings/settings-anchors";
import {
  BUTTON_VARIANT,
  Button,
  ExternalIcon,
  SETTINGS_ROW_STATE,
  SettingsRow,
  SettingsRowStateLine,
} from "@repo/ui";
import type { ShownError } from "@repo/ui/reported-failure";
import { rejectionWords, useAsyncAction } from "@repo/ui/use-async-action";

/**
 * permission-row.tsx -- one thing macOS lets the app do, as This Mac's Permissions lists each: notifications, the microphone, Screen Recording, and Accessibility alike.
 *
 * Every permission reads the same way. Allowed wears the finished session's
 * dot, as a connected service does, then what it is for. Not allowed says
 * what that costs, tinted, and offers the one press that changes it: Allow…
 * where macOS has not been asked, which raises its own prompt or its pane,
 * or Open System Settings where it has answered, the one place its answer
 * changes. One whose standing cannot be read says so, and offers nothing.
 */

/** Where a permission stands, as its row reads it. */
export const PERMISSION_STANDING = {
  /** macOS lets the app do it. */
  ALLOWED: "allowed",
  /** macOS does not yet, and Allow… asks it. */
  ASK: "ask",
  /** macOS answered no, and only System Settings changes that. */
  DENIED: "denied",
  /** macOS's answer cannot be read, or cannot be changed here. */
  UNKNOWN: "unknown",
} as const;

export type PermissionStanding = (typeof PERMISSION_STANDING)[keyof typeof PERMISSION_STANDING];

/** Allow…, resting until macOS's prompt or pane answers the ask. */
function AllowButton({ onAllow }: { onAllow: () => Promise<void> | void }): React.JSX.Element {
  const asking = useAsyncAction(rejectionWords);

  return (
    <Button
      variant={BUTTON_VARIANT.OUTLINE}
      busy={asking.running}
      busyLabel="Asking macOS"
      onClick={() => void asking.run(async () => await onAllow())}
    >
      Allow…
    </Button>
  );
}

export function PermissionRow({
  label,
  standing,
  allowed,
  missing,
  anchor,
  error,
  onAllow,
  onOpenSettings,
}: {
  label: string;
  standing: PermissionStanding;
  /** What it lets the app do, said after Allowed. */
  allowed: string;
  /** What its absence costs, or why it cannot be read, said in its place. */
  missing: string;
  /** The id a pressed search result lands on. */
  anchor?: string | undefined;
  /** Why the last ask did not reach macOS, where it did not. */
  error?: ShownError | undefined;
  /** Asks macOS for it, where it has not been asked. */
  onAllow?: (() => Promise<void> | void) | undefined;
  /** Opens its pane of System Settings. */
  onOpenSettings?: (() => void) | undefined;
}): React.JSX.Element {
  const description =
    standing === PERMISSION_STANDING.ALLOWED ? (
      <>
        <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>Allowed</SettingsRowStateLine>
        {` · ${allowed}`}
      </>
    ) : standing === PERMISSION_STANDING.UNKNOWN ? (
      missing
    ) : (
      <SettingsRowStateLine state={SETTINGS_ROW_STATE.ATTENTION}>{missing}</SettingsRowStateLine>
    );

  const row = (
    <SettingsRow label={label} description={description} error={error}>
      {() =>
        standing === PERMISSION_STANDING.ASK && onAllow !== undefined ? (
          <AllowButton onAllow={onAllow} />
        ) : (standing === PERMISSION_STANDING.ASK || standing === PERMISSION_STANDING.DENIED) &&
          onOpenSettings !== undefined ? (
          <Button variant={BUTTON_VARIANT.OUTLINE} icon={<ExternalIcon />} onClick={onOpenSettings}>
            Open System Settings
          </Button>
        ) : null
      }
    </SettingsRow>
  );

  // Note that the row stands in a wrapper wearing its search anchor, because the shared row takes no attribute of a caller's.
  return anchor === undefined ? row : <div {...searchAnchorProps(anchor)}>{row}</div>;
}
