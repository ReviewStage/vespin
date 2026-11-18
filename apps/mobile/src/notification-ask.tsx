/**
 * notification-ask.tsx -- the row heading the Inbox while iOS does not yet let the app notify: why it asks, then the system's own prompt or, after a refusal, iOS's Settings, and Not Now, which the phone remembers.
 *
 * The phone asks here, in the list its notifications are about, rather than
 * the moment an account signs in, as Apple's guidance asks: iOS raises its
 * prompt once an install, and a person who refuses it cold has only iOS's
 * Settings left. Not Now lets the row go for the standing it was shown in,
 * so a person who put off the prompt is not asked again, while one who later
 * refuses it in iOS's own prompt is shown the way to Settings once.
 * Settings › Notifications still offers the step either way. A fixture run
 * stands for a phone that allowed it, as `push-device.ts` holds, so it shows
 * nothing.
 */

import { changeSignal, GLYPH, PermissionAsk } from "@repo/ui-native";
import { Predicate } from "effect";
import { useSyncExternalStore } from "react";
import { Settings } from "react-native";
import { NOTIFICATION_STANDING, useNotificationPermission } from "./notification-permission.js";
import { useFixtureRun } from "./push-device.js";

/** The defaults key the standing the row was let go in is kept under. */
const DISMISSED_KEY = "notificationAskDismissed";

/** What the row says in each standing it is shown in. */
const ASK_WORDS = {
  [NOTIFICATION_STANDING.UNASKED]: {
    title: "Know when an agent needs you",
    line: "Get a notification when an agent asks you something or a run fails.",
    act: "Turn On Notifications",
  },
  [NOTIFICATION_STANDING.REFUSED]: {
    title: "Notifications are off",
    line: "Turn them on in Settings to hear when an agent needs you.",
    act: "Open Settings",
  },
} as const;

const NOT_NOW = "Not Now";

/** The standing the row was last let go in; none where it never was. */
function keptDismissal(): string | undefined {
  const kept: unknown = Settings.get(DISMISSED_KEY);

  return Predicate.isString(kept) ? kept : undefined;
}

/** The screens reading the dismissal, each told when it is made here, since React Native hears no change of the defaults it wrote itself. */
const dismissals = changeSignal();

function watchDismissal(listener: () => void): () => void {
  const stop = dismissals.subscribe(listener);
  const watching = Settings.watchKeys([DISMISSED_KEY], listener);

  return () => {
    stop();
    Settings.clearWatch(watching);
  };
}

/** Lets the row go in `standing`, and tells every screen reading it. */
function dismiss(standing: string): void {
  Settings.set({ [DISMISSED_KEY]: standing });
  dismissals.tell();
}

/** The Inbox's notification ask while iOS does not let the app notify and the reader hasn't let it go; nothing otherwise. */
export function NotificationAsk() {
  const fixture = useFixtureRun();
  const { standing, allow } = useNotificationPermission();
  const dismissed = useSyncExternalStore(watchDismissal, keptDismissal);

  if (fixture || standing === undefined || standing === NOTIFICATION_STANDING.ALLOWED) return null;

  if (dismissed === standing) return null;

  const words = ASK_WORDS[standing];

  return (
    <PermissionAsk
      glyph={GLYPH.NOTIFICATIONS}
      title={words.title}
      line={words.line}
      act={words.act}
      onAct={allow}
      dismiss={NOT_NOW}
      onDismiss={() => dismiss(standing)}
    />
  );
}
