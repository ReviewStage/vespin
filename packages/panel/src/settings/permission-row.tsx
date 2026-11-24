import { searchAnchorProps } from "@repo/settings/settings-anchors";
import {
  BUTTON_VARIANT,
  Button,
  ExternalIcon,
  MoreButton,
  moreLabel,
  SETTINGS_ROW_STATE,
  SettingsRow,
  SettingsRowMark,
  type SettingsRowState,
  SettingsRowStateLine,
  SettingsSavedMark,
  useMenu,
  VisuallyHidden,
} from "@repo/ui";
import type { ShownError } from "@repo/ui/reported-failure";
import { rejectionWords, useAsyncAction } from "@repo/ui/use-async-action";
import { ActionMenu } from "../desktop/action-menu.js";

/**
 * permission-row.tsx -- one thing macOS lets the app do, as This Mac's Permissions lists each: notifications, the microphone, Screen Recording, and Accessibility alike.
 *
 * Every permission reads the same way: its glyph, its name, and under it
 * what the app needs it for. One that is allowed says nothing more and ends
 * in a green ✓ and a ⋯ holding Open System Settings, the one place its answer changes.
 * One that is not says so first, "Not allowed." in the attention tint before
 * its purpose, and ends in the one press that fixes it: Allow… where macOS
 * has not been asked, which raises its own prompt or its pane, or Open
 * System Settings where it has answered no. One whose standing cannot be
 * read says so, and offers nothing. No standing stands in a column of its
 * own at the row's end.
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

/** What a standing that is not allowed says before the purpose, and the tint it says it in; an allowed one says nothing. */
const STANDING_LINE = {
  [PERMISSION_STANDING.ALLOWED]: undefined,
  [PERMISSION_STANDING.ASK]: { words: "Not allowed.", state: SETTINGS_ROW_STATE.ATTENTION },
  [PERMISSION_STANDING.DENIED]: { words: "Not allowed.", state: SETTINGS_ROW_STATE.ATTENTION },
  [PERMISSION_STANDING.UNKNOWN]: { words: "Unknown.", state: SETTINGS_ROW_STATE.PLAIN },
} as const satisfies Record<
  PermissionStanding,
  { words: string; state: SettingsRowState } | undefined
>;

/** An allowed permission's ⋯, holding Open System Settings. */
function PermissionMenu({
  thing,
  onOpenSettings,
}: {
  thing: string;
  onOpenSettings: () => void;
}): React.JSX.Element {
  const menu = useMenu(true);

  return (
    <>
      <MoreButton thing={thing} {...menu.trigger()} />
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={moreLabel(thing)}
          menu={menu.drawn}
          groups={[
            [{ label: "Open System Settings", icon: <ExternalIcon />, onSelect: onOpenSettings }],
          ]}
          replayUnmasked
          onClose={menu.close}
        />
      )}
    </>
  );
}

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
  if (standing === PERMISSION_STANDING.UNKNOWN) {
    return null;
  }

  // Note that the ✓ names itself "Allowed", because an allowed row's description says nothing of its standing.
  if (standing === PERMISSION_STANDING.ALLOWED) {
    return (
      <>
        <SettingsSavedMark />
        <VisuallyHidden>Allowed</VisuallyHidden>
      </>
    );
  }

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
  const line = STANDING_LINE[standing];
  const menued = standing === PERMISSION_STANDING.ALLOWED && onOpenSettings !== undefined;

  const row = (
    <SettingsRow
      leading={<SettingsRowMark>{icon}</SettingsRowMark>}
      label={label}
      description={
        line === undefined ? (
          purpose
        ) : (
          <>
            <SettingsRowStateLine state={line.state}>{line.words}</SettingsRowStateLine> {purpose}
          </>
        )
      }
      error={error}
      end={() => (menued ? <PermissionMenu thing={label} onOpenSettings={onOpenSettings} /> : null)}
    >
      {() => (
        <PermissionPress standing={standing} onAllow={onAllow} onOpenSettings={onOpenSettings} />
      )}
    </SettingsRow>
  );

  // Note that the row stands in a wrapper wearing its search anchor, because the shared row takes no attribute of a caller's.
  return anchor === undefined ? row : <div {...searchAnchorProps(anchor)}>{row}</div>;
}
