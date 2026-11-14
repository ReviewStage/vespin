import { searchAnchorProps } from "@repo/settings/settings-anchors";
import {
  BUTTON_VARIANT,
  Button,
  ExternalIcon,
  SettingsRow,
  SettingsRowMark,
  SettingsRowValue,
} from "@repo/ui";
import type { ShownError } from "@repo/ui/reported-failure";
import { rejectionWords, useAsyncAction } from "@repo/ui/use-async-action";

/**
 * permission-row.tsx -- one thing macOS lets the app do, as This Mac's Permissions lists each: notifications, the microphone, Screen Recording, and Accessibility alike.
 *
 * Every permission reads the same way: its glyph, its name, and under it
 * what the app needs it for, whatever macOS answered. Where it stands is
 * said at the row's end, a word before the one press that changes it:
 * Allow… where macOS has not been asked, which raises its own prompt or its
 * pane, or Open System Settings where it has answered, the one place its
 * answer changes, allowed or not. One whose standing cannot be read says
 * so, and offers nothing.
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

/** The word each standing is said by at the row's end. */
const STANDING_WORDS = {
  [PERMISSION_STANDING.ALLOWED]: "Allowed",
  [PERMISSION_STANDING.ASK]: "Not allowed",
  [PERMISSION_STANDING.DENIED]: "Not allowed",
  [PERMISSION_STANDING.UNKNOWN]: "Unknown",
} as const satisfies Record<PermissionStanding, string>;

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

/** The one press that changes where a permission stands, where there is one. */
function PermissionPress({
  standing,
  onAllow,
  onOpenSettings,
}: {
  standing: PermissionStanding;
  onAllow: (() => Promise<void> | void) | undefined;
  onOpenSettings: (() => void) | undefined;
}): React.JSX.Element | null {
  if (standing === PERMISSION_STANDING.UNKNOWN) return null;

  if (standing === PERMISSION_STANDING.ASK && onAllow !== undefined) {
    return <AllowButton onAllow={onAllow} />;
  }

  return onOpenSettings === undefined ? null : (
    <Button variant={BUTTON_VARIANT.OUTLINE} icon={<ExternalIcon />} onClick={onOpenSettings}>
      Open System Settings
    </Button>
  );
}

export function PermissionRow({
  icon,
  label,
  standing,
  purpose,
  anchor,
  error,
  onAllow,
  onOpenSettings,
}: {
  /** The permission's glyph, which leads its row. */
  icon: React.JSX.Element;
  label: string;
  standing: PermissionStanding;
  /** What the app needs it for, said under its name whatever macOS answered. */
  purpose: string;
  /** The id a pressed search result lands on. */
  anchor?: string | undefined;
  /** Why the last ask did not reach macOS, where it did not. */
  error?: ShownError | undefined;
  /** Asks macOS for it, where it has not been asked. */
  onAllow?: (() => Promise<void> | void) | undefined;
  /** Opens its pane of System Settings. */
  onOpenSettings?: (() => void) | undefined;
}): React.JSX.Element {
  const row = (
    <SettingsRow
      leading={<SettingsRowMark>{icon}</SettingsRowMark>}
      label={label}
      description={purpose}
      error={error}
    >
      {() => (
        <>
          <SettingsRowValue>{STANDING_WORDS[standing]}</SettingsRowValue>
          <PermissionPress standing={standing} onAllow={onAllow} onOpenSettings={onOpenSettings} />
        </>
      )}
    </SettingsRow>
  );

  // Note that the row stands in a wrapper wearing its search anchor, because the shared row takes no attribute of a caller's.
  return anchor === undefined ? row : <div {...searchAnchorProps(anchor)}>{row}</div>;
}
