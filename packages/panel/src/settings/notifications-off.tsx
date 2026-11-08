import {
  BUTTON_VARIANT,
  Button,
  ExternalIcon,
  SETTINGS_ROW_STATE,
  SettingsRow,
  SettingsRowStateLine,
} from "@repo/ui";

/**
 * notifications-off.tsx -- the line under a choice that posts notifications, where the system will not show them, and the way to turn them back on where there is one.
 *
 * It has no name of its own, because the choice above it is what it is
 * about. macOS has a place its grant is changed, System Settings, which the
 * line opens; a browser has none a page can open, so there the words alone
 * say where, but a browser not yet asked is asked by the line's Allow, a
 * press of the developer's own, as a browser takes an ask.
 */
export function NotificationsOff({
  words,
  onOpenSettings,
  onAllow,
}: {
  /** Why nothing shows, and what it costs, in the line's own words. */
  words: string;
  /** Opens where the system's grant is changed; none where no page can open it. */
  onOpenSettings?: (() => void) | undefined;
  /** Asks the system for leave to show them, where it has not been asked; none where it has answered. */
  onAllow?: (() => void) | undefined;
}): React.JSX.Element {
  return (
    <SettingsRow
      label={null}
      description={
        <SettingsRowStateLine state={SETTINGS_ROW_STATE.ATTENTION}>{words}</SettingsRowStateLine>
      }
    >
      {() =>
        onAllow !== undefined ? (
          <Button variant={BUTTON_VARIANT.OUTLINE} onClick={onAllow}>
            Allow notifications
          </Button>
        ) : onOpenSettings !== undefined ? (
          <Button variant={BUTTON_VARIANT.OUTLINE} icon={<ExternalIcon />} onClick={onOpenSettings}>
            Open System Settings
          </Button>
        ) : null
      }
    </SettingsRow>
  );
}
