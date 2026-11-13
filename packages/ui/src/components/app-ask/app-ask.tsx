import { useRef, useState } from "react";
import { APP_ICON_SIZE, AppIcon } from "../app-icon/app-icon.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { CHOICE_LOOK, ChoiceList } from "../choice-list/choice-list.js";
import { DIALOG_ROLE, DIALOG_SIZE, Dialog } from "../dialog/dialog.js";
import { GAP, Inline, Stack } from "../layout/layout.js";
import { TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * app-ask.tsx -- an app an agent asks to use on this Mac, put to the developer as a modal over the window: the app by its icon, name, and bundle id, how often to allow it, then Deny and Allow.
 *
 * The window asks as it asks for a shell command (`command-ask.tsx`): it
 * dims, and a card asks over the app itself, its icon, its name, and the
 * bundle id that says which app of that name it is. Under it, what the agent
 * may do with it, and a choice of how often: Always allow, picked and marked
 * Recommended, which adds the app to the apps agents use without asking,
 * or Allow once, which lets the agent that asked use it for now. Allow
 * answers with the choice, and Deny sits before it. Focus lands on Deny, so
 * a key already pressed lets nothing in; Escape and a press on the dimmed
 * window deny too, since a prompt waved away must not let an agent in.
 * Whoever owns the card holds it mounted while the ask stands and passes
 * `open` as the ask goes, answered or timed out, so the card fades out
 * (`Dialog`'s `open`), taking it down once it says it is gone.
 */

/** What the card says is asking. */
const SUBTITLE = "An agent wants to see and control an app.";

/** What letting it in lets the agent do. */
const WHAT_IT_DOES =
  "It reads the app's windows and clicks and types in them in the background, with its own cursor, while you keep working.";

/** How often Allow lets an agent into the app: always, or for the agent that asked. */
const ALLOW_SCOPE = {
  ALWAYS: "always",
  ONCE: "once",
} as const;

type AllowScope = (typeof ALLOW_SCOPE)[keyof typeof ALLOW_SCOPE];

/** The choice of how often, Always allow first and recommended. */
const SCOPE_OPTIONS = [
  {
    value: ALLOW_SCOPE.ALWAYS,
    label: "Always allow",
    detail: "Agents use this app without asking",
    badge: "Recommended",
  },
  { value: ALLOW_SCOPE.ONCE, label: "Allow once", detail: "For the agent that asked" },
] as const;

/** The app asked about: its name, its bundle id where it has one, and its icon's address where there is one to draw. */
export interface AskedApp {
  readonly name: string;
  readonly bundleId?: string | undefined;
  readonly iconSrc?: string | undefined;
}

export function AppAsk({
  open,
  app,
  onAllowOnce,
  onAllowAlways,
  onDeny,
  onExited,
}: {
  /** Whether the ask stands; falling, the card fades out before it goes. */
  open: boolean;
  app: AskedApp;
  /** Let the agent that asked use the app: Allow, with Allow once picked. */
  onAllowOnce: () => void;
  /** Let every agent use the app without asking: Allow, with Always allow picked. */
  onAllowAlways: () => void;
  /** Let no agent in, which Escape and the dimmed window also answer. */
  onDeny: () => void;
  /** Its fade has run and the card is gone, which its owner takes the ask down on. */
  onExited?: (() => void) | undefined;
}): React.JSX.Element {
  const deny = useRef<HTMLButtonElement | null>(null);
  const [scope, setScope] = useState<readonly AllowScope[]>([ALLOW_SCOPE.ALWAYS]);
  // Note that a pick taken back leaves no scope, which allows once rather than widening.
  const allow = scope[0] === ALLOW_SCOPE.ALWAYS ? onAllowAlways : onAllowOnce;

  return (
    <Dialog
      open={open}
      role={DIALOG_ROLE.ALERT_DIALOG}
      size={DIALOG_SIZE.WIDE}
      title={`Let agents use ${app.name}?`}
      subtitle={SUBTITLE}
      initialFocus={deny}
      onDismiss={onDeny}
      onExited={onExited}
      actions={
        <>
          <Button ref={deny} variant={BUTTON_VARIANT.QUIET} onClick={onDeny}>
            Deny
          </Button>
          <Button variant={BUTTON_VARIANT.PRIMARY} onClick={allow}>
            Allow
          </Button>
        </>
      }
    >
      <Inline gap={GAP.FIELD} wrap={false}>
        <AppIcon src={app.iconSrc} size={APP_ICON_SIZE.CARD} />
        <Stack gap={GAP.TIGHT}>
          <Text>{app.name}</Text>
          {app.bundleId === undefined ? null : (
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {app.bundleId}
            </Text>
          )}
        </Stack>
      </Inline>
      <Text tone={TEXT_TONE.MUTED}>{WHAT_IT_DOES}</Text>
      <ChoiceList
        legend="How often to allow"
        look={CHOICE_LOOK.MARKED}
        options={SCOPE_OPTIONS}
        value={scope}
        onChange={setScope}
      />
    </Dialog>
  );
}
