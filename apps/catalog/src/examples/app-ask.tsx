import {
  AGENT_POINTER_KIND,
  AgentPointer,
  APP_ICON_SIZE,
  AppAsk,
  AppIcon,
  AppStackPill,
  AppWindowStack,
  BUTTON_VARIANT,
  Button,
  Inline,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { PICTURE_STATE } from "@repo/ui/picture-read";
import { useState } from "react";
import { CATALOG_FAILURE } from "../catalog-failure";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * app-ask.tsx -- an app on the Mac by its icon at each seat it stands in, and
 * by a screen's glyph where there is none to draw; and the ask that lets an
 * agent use an app, opened from its button and put away by any of its
 * answers, Escape, or a press on the dimmed window, for an app with its icon
 * and bundle id and for one with neither; the agent's pointer over a
 * picture, moved there, pressing, and typing; and the windows of the apps an
 * agent is using, as the stack that floats over its box, for one app whose
 * window is a phone's, the agent's pointer where it pressed, three apps, the
 * pointer mirrored at the front window's corner, more apps than the stack draws behind
 * its front, which pile, an app whose window is still being read, and one
 * whose window's read did not land, with Retry; and the stack minimized to
 * its pill, while the agent works in an app and once it is done.
 */

/** A synthetic app's icon, a rounded square with a phone in it, as a Mac's app sends one. */
const ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="a" x2="0" y2="1"><stop offset="0" stop-color="#5ac8fa"/><stop offset="1" stop-color="#1d6fe0"/></linearGradient></defs><rect x="4" y="4" width="56" height="56" rx="13" fill="url(#a)"/><rect x="22" y="12" width="20" height="40" rx="5" fill="#0b0d12"/><rect x="24" y="15" width="16" height="34" rx="3" fill="#e8f2ff"/></svg>',
)}`;

/** A synthetic phone's window, as the Simulator's would be read. */
const PHONE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="236" height="512" viewBox="0 0 118 256"><rect width="118" height="256" rx="16" fill="#111"/><rect x="5" y="5" width="108" height="246" rx="12" fill="#f4f6fa"/><rect x="16" y="60" width="86" height="14" rx="3" fill="#fff" stroke="#cfd5df"/><rect x="16" y="82" width="86" height="14" rx="3" fill="#fff" stroke="#cfd5df"/><rect x="30" y="112" width="58" height="18" rx="6" fill="#1d6fe0"/></svg>',
)}`;

/** A synthetic Mac window, wide, as an editor's would be read. */
const EDITOR = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 320 200"><rect width="320" height="200" fill="#1f2125"/><rect width="320" height="20" fill="#2b2e33"/><circle cx="12" cy="10" r="4" fill="#ff5f57"/><circle cx="24" cy="10" r="4" fill="#febc2e"/><circle cx="36" cy="10" r="4" fill="#28c840"/><rect y="20" width="70" height="180" fill="#26292e"/><rect x="80" y="34" width="150" height="6" rx="3" fill="#7aa2f7"/><rect x="80" y="48" width="200" height="6" rx="3" fill="#9ece6a"/><rect x="80" y="62" width="120" height="6" rx="3" fill="#bb9af7"/></svg>',
)}`;

/** The apps an agent is using as the stack floating over its box draws them, every press doing nothing here. */
function Stack({
  apps,
  using,
}: {
  apps: Parameters<typeof AppWindowStack>[0]["apps"];
  using?: string;
}): React.JSX.Element {
  return (
    <AppWindowStack
      label="Apps in use"
      apps={apps}
      using={using}
      onPick={() => undefined}
      onOpen={() => undefined}
      onMinimize={() => undefined}
    />
  );
}

/** The newest window an app's read kept, ready, at its own shape. */
function ready(url: string, width: number, height: number) {
  return { state: { kind: PICTURE_STATE.READY, url }, width, height } as const;
}

/** The agent's pointer over a window, where its last press landed, as a share of the window. */
function pointerAt(x: number, y: number) {
  return { x, y, kind: AGENT_POINTER_KIND.CLICK, move: "press", shown: true } as const;
}

/** Apps past the two the stack draws behind its front, to pile. */
const MORE_APPS = ["Notes", "Calculator", "Maps", "Music", "Preview"].map((name) => ({
  id: name,
  name,
  iconSrc: ICON,
}));

/** How long an ask the catalog opens has left: about four minutes, as one shown a minute ago. */
const ASK_LEFT_MS = 252_000;

/** The most characters of a Deny's words, as the Mac takes them. */
const NOTE_MAX_LENGTH = 2000;

/** A button that puts the ask about `app` to the developer, whose answers put it away. */
function Asking({
  label,
  app,
}: {
  label: string;
  app: { name: string; bundleId?: string; iconSrc?: string };
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [expiresAt, setExpiresAt] = useState(0);
  const close = () => setOpen(false);

  const ask = () => {
    setExpiresAt(Date.now() + ASK_LEFT_MS);
    setOpen(true);
  };

  return (
    <>
      <Button variant={BUTTON_VARIANT.OUTLINE} aria-haspopup="dialog" onClick={ask}>
        {label}
      </Button>
      <AppAsk
        open={open}
        app={app}
        onAllowOnce={close}
        onAllowAlways={close}
        onDeny={close}
        expiresAt={expiresAt}
        noteMaxLength={NOTE_MAX_LENGTH}
      />
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
      <CatalogSection id="agent-pointer" title="The agent's pointer: moved, pressed, typing">
        <Inline>
          {Object.values(AGENT_POINTER_KIND).map((kind) => (
            <div key={kind} className="catalog-pointer-ground">
              <AgentPointer x={0.4} y={0.4} kind={kind} move={kind} shown />
            </div>
          ))}
        </Inline>
      </CatalogSection>
      <CatalogSection id="app-window-stack" title="The apps an agent is using">
        <Inline>
          <Stack
            apps={[
              {
                id: "Simulator",
                name: "Simulator",
                iconSrc: ICON,
                window: { ...ready(PHONE, 236, 512), pointer: pointerAt(0.5, 0.47) },
              },
            ]}
            using="Simulator"
          />
          <Stack
            apps={[
              {
                id: "Xcode",
                name: "Xcode",
                window: { ...ready(EDITOR, 640, 400), pointer: pointerAt(0.97, 0.95) },
              },
              { id: "Simulator", name: "Simulator", iconSrc: ICON },
              { id: "Safari", name: "Safari" },
            ]}
            using="Simulator"
          />
          <Stack
            apps={[
              { id: "Xcode", name: "Xcode", window: ready(EDITOR, 640, 400) },
              { id: "Simulator", name: "Simulator", iconSrc: ICON },
              ...MORE_APPS,
            ]}
            using="Xcode"
          />
          <Stack
            apps={[
              {
                id: "Simulator",
                name: "Simulator",
                iconSrc: ICON,
                window: { state: { kind: PICTURE_STATE.READING }, width: 236, height: 512 },
              },
            ]}
          />
          <Stack
            apps={[
              {
                id: "Simulator",
                name: "Simulator",
                iconSrc: ICON,
                window: {
                  state: {
                    kind: PICTURE_STATE.FAILED,
                    retry: () => undefined,
                    failure: CATALOG_FAILURE,
                  },
                  width: 236,
                  height: 512,
                },
              },
            ]}
          />
        </Inline>
      </CatalogSection>
      <CatalogSection id="app-stack-pill" title="The apps minimized, at work and done">
        <Inline>
          <AppStackPill
            apps={[
              { id: "Simulator", name: "Simulator", iconSrc: ICON },
              { id: "Xcode", name: "Xcode" },
              { id: "Safari", name: "Safari" },
            ]}
            using="Simulator"
            onRestore={() => undefined}
          />
          <AppStackPill
            apps={[
              { id: "Simulator", name: "Simulator", iconSrc: ICON },
              { id: "Xcode", name: "Xcode" },
              { id: "Safari", name: "Safari" },
            ]}
            onRestore={() => undefined}
          />
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
