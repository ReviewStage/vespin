import {
  APP_ICON_SIZE,
  AppAsk,
  AppIcon,
  BUTTON_VARIANT,
  Button,
  Inline,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * app-ask.tsx -- an app on the Mac by its icon at each seat it stands in, and
 * by a screen's glyph where there is none to draw; and the ask that lets an
 * agent use an app, opened from its button and put away by any of its
 * answers, Escape, or a press on the dimmed window, for an app with its icon
 * and bundle id and for one with neither.
 */

/** A synthetic app's icon, a rounded square with a phone in it, as a Mac's app sends one. */
const ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="a" x2="0" y2="1"><stop offset="0" stop-color="#5ac8fa"/><stop offset="1" stop-color="#1d6fe0"/></linearGradient></defs><rect x="4" y="4" width="56" height="56" rx="13" fill="url(#a)"/><rect x="22" y="12" width="20" height="40" rx="5" fill="#0b0d12"/><rect x="24" y="15" width="16" height="34" rx="3" fill="#e8f2ff"/></svg>',
)}`;

/** A button that puts the ask about `app` to the developer, whose answers put it away. */
function Asking({
  label,
  app,
}: {
  label: string;
  app: { name: string; bundleId?: string; iconSrc?: string };
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <>
      <Button variant={BUTTON_VARIANT.OUTLINE} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <AppAsk open={open} app={app} onAllowOnce={close} onAllowAlways={close} onDeny={close} />
    </>
  );
}

function AppAsks(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="app-icon-seats" title="An app's icon at each seat, and none to draw">
        <Inline>
          <AppIcon src={ICON} size={APP_ICON_SIZE.LINE} />
          <AppIcon src={ICON} size={APP_ICON_SIZE.LEAD} />
          <AppIcon src={ICON} size={APP_ICON_SIZE.CARD} />
          <AppIcon size={APP_ICON_SIZE.LEAD} />
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            Line, lead, card, and an app with no icon
          </Text>
        </Inline>
      </CatalogSection>
      <CatalogSection id="app-ask-states" title="An app asked about">
        <Inline>
          <Asking
            label="Simulator…"
            app={{ name: "Simulator", bundleId: "com.apple.iphonesimulator", iconSrc: ICON }}
          />
          <Asking label="An app with no icon…" app={{ name: "Untitled Tool" }} />
        </Inline>
      </CatalogSection>
    </>
  );
}

export const APP_ASK_EXAMPLE: Example = {
  id: "app-ask",
  title: "App ask",
  Render: AppAsks,
};
