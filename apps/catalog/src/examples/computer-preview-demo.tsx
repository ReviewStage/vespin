import {
  APP_ICON_SIZE,
  AppIcon,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CARD_CORNER,
  CARD_LOOK,
  CARD_PADDING,
  CARD_SHADOW,
  Card,
  CardPress,
  CHIP_LOOK,
  CHIP_SIZE,
  CHOICE_BAR_LOOK,
  CHOICE_BAR_SIZE,
  Chip,
  ChipName,
  ChoiceBar,
  COMPOSER_ELEMENT,
  COMPOSER_LOOK,
  ComposerFrame,
  GAP,
  IconButton,
  Inline,
  JUSTIFY,
  MENU_ITEM_MARK,
  Menu,
  PlusIcon,
  Stack,
  StopIcon,
  SUBMIT_STATE,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  useMenu,
  WorkingMark,
} from "@repo/ui";
import { ArrowUpRightIcon, Minimize2Icon } from "@repo/ui/icons";
import { type ReactNode, useEffect, useState } from "react";
import { APPS, type App, LAST_DONE, usingWords, Window, XCODE } from "./computer-preview-options";

/**
 * computer-preview-demo.tsx -- THROWAWAY: the stacked preview and A's +2 menu,
 * live, for Dean to click through. Never merged.
 */

const ignore = () => undefined;

const DESIGN = { STACKED: "stacked", MENU: "menu" } as const;
type Design = (typeof DESIGN)[keyof typeof DESIGN];

const THEME = { LIGHT: "light", DARK: "dark" } as const;
type Theme = (typeof THEME)[keyof typeof THEME];

const WIDTH = { WIDE: "wide", NARROW: "narrow" } as const;
type Width = (typeof WIDTH)[keyof typeof WIDTH];

const MAC = { THAT: "that", OTHER: "other" } as const;
type Mac = (typeof MAC)[keyof typeof MAC];

/** At most this many apps stand behind the front window; the rest are counted. */
const MOST_BEHIND = 2;

/** The theme the page was opened in, read off the frame's color scheme. */
function openingTheme(): Theme {
  const scheme = getComputedStyle(document.documentElement).colorScheme;

  if (scheme.includes("dark")) return THEME.DARK;
  if (scheme.includes("light")) return THEME.LIGHT;

  return matchMedia("(prefers-color-scheme: dark)").matches ? THEME.DARK : THEME.LIGHT;
}

/** What the preview is drawn from. */
interface Live {
  readonly used: readonly App[];
  readonly inUse: App;
  readonly shown: App;
  readonly working: boolean;
  readonly narrow: boolean;
  readonly onThatMac: boolean;
}

/** The front window's title bar: the app shown, "Using" and the mark only on the app in use, and its controls. */
function TitleBar({
  live,
  middle,
  onMinimize,
  onStop,
}: {
  live: Live;
  middle?: ReactNode;
  onMinimize: () => void;
  onStop: () => void;
}): React.JSX.Element {
  const { shown } = live;
  const using = live.working && shown === live.inUse;

  return (
    <div className="flex min-w-0 items-center gap-ui-6 border-b border-border py-ui-4 ps-ui-8 pe-ui-4">
      <AppIcon src={shown.icon} size={APP_ICON_SIZE.LINE} />
      <Text variant={TEXT_VARIANT.LABEL} truncate>
        {using || !live.working ? usingWords(shown, live.working) : shown.name}
      </Text>
      {using ? <WorkingMark /> : null}
      <span className="flex-1" />
      {middle}
      {live.onThatMac ? (
        <IconButton
          icon={<ArrowUpRightIcon />}
          label={`Show ${shown.name}`}
          size={BUTTON_SIZE.COMPACT}
          onClick={ignore}
        />
      ) : null}
      <IconButton
        icon={<Minimize2Icon />}
        label="Minimize"
        size={BUTTON_SIZE.COMPACT}
        onClick={onMinimize}
      />
      {live.working ? (
        <IconButton icon={<StopIcon />} label="Stop" size={BUTTON_SIZE.COMPACT} onClick={onStop} />
      ) : null}
    </div>
  );
}

/** The front window's card. */
function FrontCard({ live, children }: { live: Live; children: ReactNode }): React.JSX.Element {
  return (
    <Card
      look={CARD_LOOK.SURFACE}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.FLUSH}
      shadow={CARD_SHADOW.SOFT}
      className={live.narrow ? "w-full" : "w-cpo-wide"}
    >
      {children}
      <Window app={live.shown} narrow={live.narrow} />
    </Card>
  );
}

/** An app behind the front window, its title peeking out above it, the whole strip a press that brings it forward. */
function BehindTitle({
  app,
  live,
  depth,
  onPick,
}: {
  app: App;
  live: Live;
  depth: number;
  onPick: (app: App) => void;
}): React.JSX.Element {
  const using = live.working && app === live.inUse;

  return (
    <Card
      look={CARD_LOOK.SURFACE}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.NONE}
      shadow={CARD_SHADOW.SOFT}
      className={`relative -mb-ui-8 ${depth === 1 ? "mx-ui-8" : "mx-ui-16"}`}
    >
      <CardPress label={`Show ${app.name}`} onPress={() => onPick(app)}>
        <span className="flex min-w-0 items-center gap-ui-6 pt-ui-4 pb-ui-12 ps-ui-8 pe-ui-8">
          <AppIcon src={app.icon} size={APP_ICON_SIZE.LINE} />
          <Text variant={TEXT_VARIANT.LABEL} tone={using ? undefined : TEXT_TONE.MUTED} truncate>
            {using ? usingWords(app, true) : app.name}
          </Text>
          {using ? <WorkingMark /> : null}
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} truncate>
            {LAST_DONE.get(app) ?? ""}
          </Text>
        </span>
      </CardPress>
    </Card>
  );
}

/** The stacked preview: every other app behind, deepest first, then the front window. */
function Stacked({
  live,
  onPick,
  onMinimize,
  onStop,
}: {
  live: Live;
  onPick: (app: App) => void;
  onMinimize: () => void;
  onStop: () => void;
}): React.JSX.Element {
  const others = live.used.filter((app) => app !== live.shown);
  const behind = others.slice(0, MOST_BEHIND);
  const counted = others.length - behind.length;

  return (
    <div className={`flex flex-col ${live.narrow ? "w-full" : "w-cpo-wide"}`}>
      {behind.toReversed().map((app, at) => (
        <BehindTitle
          key={app.name}
          app={app}
          live={live}
          depth={behind.length - at}
          onPick={onPick}
        />
      ))}
      <div className="relative">
        <FrontCard live={live}>
          <TitleBar
            live={live}
            middle={
              counted > 0 ? (
                <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                  {`+${String(counted)}`}
                </Text>
              ) : null
            }
            onMinimize={onMinimize}
            onStop={onStop}
          />
        </FrontCard>
      </div>
    </div>
  );
}

/** A's "+N", a menu of every app this turn, the one shown checked, a choice showing it. */
function AppsMenu({ live, onPick }: { live: Live; onPick: (app: App) => void }): ReactNode {
  const menu = useMenu(true);

  if (live.used.length < 2) return null;

  return (
    <>
      <Chip look={CHIP_LOOK.TOOLBAR} size={CHIP_SIZE.COMPACT} chevron {...menu.trigger()}>
        <ChipName>{`+${String(live.used.length - 1)}`}</ChipName>
      </Chip>
      {menu.drawn && (
        <Menu
          label="Apps this turn"
          menu={menu.drawn}
          groups={[
            live.used.map((app) => ({
              label: app.name,
              icon: <AppIcon src={app.icon} size={APP_ICON_SIZE.LINE} />,
              detail: live.working && app === live.inUse ? "Using now" : (LAST_DONE.get(app) ?? ""),
              checked: app === live.shown,
              mark: MENU_ITEM_MARK.CHECK,
              onSelect: () => onPick(app),
            })),
          ]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The minimized preview: the app in use and what it is doing, or how many apps the turn used. */
function Pill({ live, onRestore }: { live: Live; onRestore: () => void }): React.JSX.Element {
  const others = live.used.length - 1;

  return (
    <Chip look={CHIP_LOOK.PILL} aria-label="Show the preview" onClick={onRestore}>
      <AppIcon src={live.inUse.icon} size={APP_ICON_SIZE.LINE} />
      <ChipName>
        {live.working
          ? usingWords(live.inUse, true)
          : live.used.length === 1
            ? usingWords(live.inUse, false)
            : `Used ${String(live.used.length)} apps`}
      </ChipName>
      {live.working ? <WorkingMark /> : null}
      {live.working && others > 0 ? <ChipName>{`+${String(others)}`}</ChipName> : null}
    </Chip>
  );
}

/** One bar of the demo's own controls. */
function Control<Value extends string>({
  label,
  value,
  items,
  onChange,
}: {
  label: string;
  value: Value;
  items: { value: Value; label: string }[];
  onChange: (value: Value) => void;
}): React.JSX.Element {
  return (
    <ChoiceBar<Value>
      label={label}
      items={items}
      value={value}
      onChange={onChange}
      look={CHOICE_BAR_LOOK.SEGMENTED}
      size={CHOICE_BAR_SIZE.COMPACT}
    />
  );
}

export function ComputerPreviewDemo(): React.JSX.Element {
  const [design, setDesign] = useState<Design>(DESIGN.STACKED);
  const [theme, setTheme] = useState<Theme>(openingTheme);
  const [width, setWidth] = useState<Width>(WIDTH.WIDE);
  const [mac, setMac] = useState<Mac>(MAC.THAT);
  const [used, setUsed] = useState<readonly App[]>([XCODE]);
  const [inUse, setInUse] = useState<App>(XCODE);
  const [shown, setShown] = useState<App>(XCODE);
  const [working, setWorking] = useState(true);
  const [minimized, setMinimized] = useState(false);
  const [lines, setLines] = useState<readonly string[]>(["Clicked Build in Xcode"]);

  useEffect(() => {
    document.documentElement.dataset.uiProfile = "desktop";
    document.documentElement.dataset.uiTheme = theme;
  }, [theme]);

  const live: Live = {
    used,
    inUse,
    shown,
    working,
    narrow: width === WIDTH.NARROW,
    onThatMac: mac === MAC.THAT,
  };

  // Note that the agent moving on brings its new app to the front, newest first in the stack.
  const useNext = () => {
    const next = APPS[(APPS.indexOf(inUse) + 1) % APPS.length] ?? XCODE;
    const startsTurn = !working;
    setUsed(startsTurn ? [next] : [next, ...used.filter((app) => app !== next)]);
    setInUse(next);
    setShown(next);
    setWorking(true);

    if (startsTurn) setMinimized(false);
    setLines([...lines, `${LAST_DONE.get(next) ?? "Used"} in ${next.name}`]);
  };

  const stop = () => {
    setWorking(false);
    setMinimized(true);
    setLines([...lines, "Done."]);
  };

  const send = () => {
    setUsed([]);
    setWorking(true);
    setMinimized(false);
    setLines([...lines, "You: try it on the iPad too"]);
  };

  const preview =
    used.length === 0 ? null : minimized ? (
      <Pill live={live} onRestore={() => setMinimized(false)} />
    ) : design === DESIGN.STACKED ? (
      <Stacked live={live} onPick={setShown} onMinimize={() => setMinimized(true)} onStop={stop} />
    ) : (
      <FrontCard live={live}>
        <TitleBar
          live={live}
          middle={<AppsMenu live={live} onPick={setShown} />}
          onMinimize={() => setMinimized(true)}
          onStop={stop}
        />
      </FrontCard>
    );

  return (
    <div className="demo-stage">
      <Stack gap={GAP.FIELD}>
        <Inline gap={GAP.CONTROL} wrap>
          <Control
            label="Design"
            value={design}
            onChange={setDesign}
            items={[
              { value: DESIGN.STACKED, label: "Stacked" },
              { value: DESIGN.MENU, label: "A: +N menu" },
            ]}
          />
          <Control
            label="Width"
            value={width}
            onChange={setWidth}
            items={[
              { value: WIDTH.WIDE, label: "Wide" },
              { value: WIDTH.NARROW, label: "Narrow" },
            ]}
          />
          <Control
            label="Seen on"
            value={mac}
            onChange={setMac}
            items={[
              { value: MAC.THAT, label: "The agent's Mac" },
              { value: MAC.OTHER, label: "Another device" },
            ]}
          />
          <Control
            label="Theme"
            value={theme}
            onChange={setTheme}
            items={[
              { value: THEME.LIGHT, label: "Light" },
              { value: THEME.DARK, label: "Dark" },
            ]}
          />
        </Inline>
        <Inline gap={GAP.CONTROL} wrap>
          <Button variant={BUTTON_VARIANT.OUTLINE} onClick={useNext}>
            Agent uses the next app
          </Button>
          {working ? (
            <Button variant={BUTTON_VARIANT.OUTLINE} onClick={stop}>
              Agent finishes
            </Button>
          ) : null}
        </Inline>
        <div className={`demo-room ${live.narrow ? "demo-narrow" : ""}`}>
          {lines.slice(-4).map((line, at) => (
            <Text key={`${String(at)}-${line}`} tone={TEXT_TONE.MUTED}>
              {line}
            </Text>
          ))}
          <div className={`demo-over ${live.narrow ? "" : "demo-over-end"}`}>{preview}</div>
          <ComposerFrame
            as={COMPOSER_ELEMENT.FORM}
            look={COMPOSER_LOOK.CARD}
            onSubmit={(event) => event.preventDefault()}
          >
            <div className="catalog-composer">
              <Stack gap={GAP.CONTROL}>
                <Text tone={TEXT_TONE.MUTED}>Message the agent</Text>
                <Inline justify={JUSTIFY.BETWEEN}>
                  <IconButton label="Attach files" icon={<PlusIcon />} onClick={ignore} />
                  <IconButton
                    label={working ? "Stop" : "Send"}
                    variant={BUTTON_VARIANT.INK}
                    submit={working ? SUBMIT_STATE.STREAMING : SUBMIT_STATE.READY}
                    onClick={working ? stop : send}
                  />
                </Inline>
              </Stack>
            </div>
          </ComposerFrame>
        </div>
      </Stack>
    </div>
  );
}
