import {
  APP_ICON_SIZE,
  AppIcon,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  CARD_CORNER,
  CARD_LOOK,
  CARD_PADDING,
  CARD_SHADOW,
  Card,
  CHIP_LOOK,
  CHIP_SIZE,
  ChevronDownIcon,
  Chip,
  ChipName,
  CloseIcon,
  COMPOSER_ELEMENT,
  COMPOSER_LOOK,
  ComposerFrame,
  GAP,
  IconButton,
  Inline,
  JUSTIFY,
  PictureTile,
  PlusIcon,
  Stack,
  StopIcon,
  SUBMIT_STATE,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  WorkingMark,
} from "@repo/ui";
import { ArrowUpRightIcon, ChevronUpIcon, Minimize2Icon } from "@repo/ui/icons";
import type { ReactNode } from "react";
import type { Example } from "../example";

/**
 * computer-preview-options.tsx -- THROWAWAY design options for computer use's
 * live view, with the dock row folded into the preview. Never merged.
 */

const ignore = () => undefined;

const XCODE_ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="a" x2="0" y2="1"><stop offset="0" stop-color="#3fa9f5"/><stop offset="1" stop-color="#0b5fd1"/></linearGradient></defs><rect x="4" y="4" width="56" height="56" rx="13" fill="url(#a)"/><path d="M20 44 L44 20 M24 20 L44 44" stroke="#fff" stroke-width="5" stroke-linecap="round"/></svg>',
)}`;

const SIMULATOR_ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="a" x2="0" y2="1"><stop offset="0" stop-color="#5ac8fa"/><stop offset="1" stop-color="#1d6fe0"/></linearGradient></defs><rect x="4" y="4" width="56" height="56" rx="13" fill="url(#a)"/><rect x="22" y="12" width="20" height="40" rx="5" fill="#0b0d12"/><rect x="24" y="15" width="16" height="34" rx="3" fill="#e8f2ff"/></svg>',
)}`;

const SAFARI_ICON = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="4" y="4" width="56" height="56" rx="13" fill="#f2f4f7"/><circle cx="32" cy="32" r="20" fill="#1e88e5"/><path d="M32 16 L36 32 L32 48 L28 32 Z" fill="#fff"/><path d="M32 16 L36 32 L28 32 Z" fill="#ff3b30"/></svg>',
)}`;

const EDITOR = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 320 200"><rect width="320" height="200" fill="#1f2125"/><rect width="320" height="20" fill="#2b2e33"/><circle cx="12" cy="10" r="4" fill="#ff5f57"/><circle cx="24" cy="10" r="4" fill="#febc2e"/><circle cx="36" cy="10" r="4" fill="#28c840"/><rect y="20" width="70" height="180" fill="#26292e"/><rect x="10" y="32" width="48" height="5" rx="2" fill="#4a4f57"/><rect x="10" y="44" width="40" height="5" rx="2" fill="#4a4f57"/><rect x="10" y="56" width="44" height="5" rx="2" fill="#3b6fd8"/><rect x="80" y="34" width="150" height="6" rx="3" fill="#7aa2f7"/><rect x="92" y="48" width="200" height="6" rx="3" fill="#9ece6a"/><rect x="92" y="62" width="120" height="6" rx="3" fill="#bb9af7"/><rect x="80" y="76" width="90" height="6" rx="3" fill="#7aa2f7"/><rect x="92" y="90" width="170" height="6" rx="3" fill="#e0af68"/><rect x="92" y="104" width="140" height="6" rx="3" fill="#9ece6a"/></svg>',
)}`;

const PHONE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="236" height="512" viewBox="0 0 118 256"><rect width="118" height="256" rx="16" fill="#111"/><rect x="5" y="5" width="108" height="246" rx="12" fill="#f4f6fa"/><rect x="16" y="60" width="86" height="14" rx="3" fill="#fff" stroke="#cfd5df"/><rect x="16" y="82" width="86" height="14" rx="3" fill="#fff" stroke="#cfd5df"/><rect x="30" y="112" width="58" height="18" rx="6" fill="#1d6fe0"/></svg>',
)}`;

/** One app the agent used, as the preview draws it. */
interface App {
  readonly name: string;
  readonly icon: string;
  readonly window: string;
  readonly width: number;
  readonly height: number;
}

const XCODE: App = { name: "Xcode", icon: XCODE_ICON, window: EDITOR, width: 640, height: 400 };

const SIMULATOR: App = {
  name: "Simulator",
  icon: SIMULATOR_ICON,
  window: PHONE,
  width: 236,
  height: 512,
};

const SAFARI: App = { name: "Safari", icon: SAFARI_ICON, window: EDITOR, width: 640, height: 400 };

const APPS = [XCODE, SIMULATOR, SAFARI] as const;

/** Where a scene is seen: the agent working or done, on the Mac it uses or elsewhere, wide or narrow. */
interface Seen {
  readonly working: boolean;
  readonly onThatMac: boolean;
  readonly narrow: boolean;
}

/** The newest window, at its own shape on a quiet ground, a press enlarging it. */
function Window({ app, narrow }: { app: App; narrow: boolean }): React.JSX.Element {
  return (
    <span className={`flex justify-center bg-muted ${narrow ? "w-full" : ""}`}>
      <PictureTile name={app.name} onOpen={ignore}>
        <img
          className={`block h-auto w-auto max-w-full ${narrow ? "max-h-cpo-narrow" : "max-h-cpo-tall"}`}
          src={app.window}
          width={app.width}
          height={app.height}
          alt=""
        />
      </PictureTile>
    </span>
  );
}

/** "Using Xcode" while the agent's newest call is on it, "Used Xcode" once it is done. */
function usingWords(app: App, working: boolean): string {
  return `${working ? "Using" : "Used"} ${app.name}`;
}

/** Show <App>, only on the Mac the agent uses. */
function ShowApp({
  app,
  seen,
  media = false,
}: {
  app: App;
  seen: Seen;
  media?: boolean;
}): ReactNode {
  if (!seen.onThatMac) return null;

  return (
    <IconButton
      icon={<ArrowUpRightIcon />}
      label={`Show ${app.name}`}
      size={BUTTON_SIZE.COMPACT}
      variant={media ? BUTTON_VARIANT.MEDIA : undefined}
      onClick={ignore}
    />
  );
}

/** Stop, while the agent works. */
function StopTurn({ seen, media = false }: { seen: Seen; media?: boolean }): ReactNode {
  if (!seen.working) return null;

  return (
    <IconButton
      icon={<StopIcon />}
      label="Stop"
      size={BUTTON_SIZE.COMPACT}
      variant={media ? BUTTON_VARIANT.MEDIA : undefined}
      onClick={ignore}
    />
  );
}

/** A preview's title bar: the app, what the agent is doing in it, and the controls. */
function TitleBar({
  app,
  seen,
  middle,
  end,
}: {
  app: App;
  seen: Seen;
  middle?: ReactNode;
  end: ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-ui-6 border-b border-border py-ui-4 ps-ui-8 pe-ui-4">
      <AppIcon src={app.icon} size={APP_ICON_SIZE.LINE} />
      <Text variant={TEXT_VARIANT.LABEL} truncate>
        {usingWords(app, seen.working)}
      </Text>
      {seen.working ? <WorkingMark /> : null}
      <span className="flex-1" />
      {middle}
      {end}
    </div>
  );
}

/** The preview's card, at its window's width, or the column's where it is narrow. */
function PreviewCard({
  narrow,
  children,
}: {
  narrow: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <Card
      look={CARD_LOOK.SURFACE}
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.FLUSH}
      shadow={CARD_SHADOW.SOFT}
      className={narrow ? "w-full" : "w-cpo-wide"}
    >
      {children}
    </Card>
  );
}

/** "+2 apps", a menu of every app used this turn, the one chosen showing its window. */
function OtherApps({ count }: { count: number }): React.JSX.Element {
  return (
    <Chip
      look={CHIP_LOOK.TOOLBAR}
      size={CHIP_SIZE.COMPACT}
      chevron
      aria-haspopup="menu"
      onClick={ignore}
    >
      <ChipName>{`+${String(count)}`}</ChipName>
    </Chip>
  );
}

// Option A: a window with a title bar; minimize to a pill, which brings it back.

function TitledWindow({ seen }: { seen: Seen }): React.JSX.Element {
  return (
    <PreviewCard narrow={seen.narrow}>
      <TitleBar
        app={XCODE}
        seen={seen}
        middle={<OtherApps count={APPS.length - 1} />}
        end={
          <>
            <ShowApp app={XCODE} seen={seen} />
            <IconButton
              icon={<Minimize2Icon />}
              label="Minimize"
              size={BUTTON_SIZE.COMPACT}
              onClick={ignore}
            />
            <StopTurn seen={seen} />
          </>
        }
      />
      <Window app={XCODE} narrow={seen.narrow} />
    </PreviewCard>
  );
}

function MinimizedPill({ seen }: { seen: Seen }): React.JSX.Element {
  return (
    <Chip look={CHIP_LOOK.PILL} aria-label="Show the preview" onClick={ignore}>
      <AppIcon src={XCODE.icon} size={APP_ICON_SIZE.LINE} />
      <ChipName>
        {seen.working ? usingWords(XCODE, true) : `Used ${String(APPS.length)} apps`}
      </ChipName>
      {seen.working ? <WorkingMark /> : null}
    </Chip>
  );
}

// Option B: picture in picture, its controls on the window; close it, and the box's foot brings it back.

function PictureInPicture({ seen }: { seen: Seen }): React.JSX.Element {
  return (
    <div className={`grid ${seen.narrow ? "w-full" : "w-cpo-wide"} pt-app-window-peek-twice`}>
      <Card
        look={CARD_LOOK.SURFACE}
        corner={CARD_CORNER.CONTROL}
        padding={CARD_PADDING.NONE}
        shadow={CARD_SHADOW.SOFT}
        className="col-start-1 row-start-1 -translate-y-app-window-peek-twice scale-90"
      >
        {null}
      </Card>
      <Card
        look={CARD_LOOK.SURFACE}
        corner={CARD_CORNER.CONTROL}
        padding={CARD_PADDING.NONE}
        shadow={CARD_SHADOW.SOFT}
        className="col-start-1 row-start-1 -translate-y-app-window-peek scale-95"
      >
        {null}
      </Card>
      <Card
        look={CARD_LOOK.SURFACE}
        corner={CARD_CORNER.CONTROL}
        padding={CARD_PADDING.FLUSH}
        shadow={CARD_SHADOW.SOFT}
        className="relative col-start-1 row-start-1"
      >
        <Window app={XCODE} narrow={seen.narrow} />
        <div className="absolute right-0 bottom-0 left-0 flex items-center gap-ui-6 bg-[linear-gradient(transparent,var(--color-veil))] pt-ui-24 pb-ui-4 ps-ui-8 pe-ui-4 text-on-veil">
          <AppIcon src={XCODE.icon} size={APP_ICON_SIZE.LINE} />
          <Text variant={TEXT_VARIANT.LABEL} className="text-on-veil" truncate>
            {usingWords(XCODE, seen.working)}
          </Text>
          {seen.working ? <WorkingMark /> : null}
          <span className="flex-1" />
          <ShowApp app={XCODE} seen={seen} media />
          <StopTurn seen={seen} media />
          <IconButton
            icon={<CloseIcon />}
            label="Close"
            size={BUTTON_SIZE.COMPACT}
            variant={BUTTON_VARIANT.MEDIA}
            onClick={ignore}
          />
        </div>
      </Card>
    </div>
  );
}

/** The chip in the box's foot a closed preview comes back from. */
function ReopenChip({ seen }: { seen: Seen }): React.JSX.Element {
  return (
    <Chip look={CHIP_LOOK.TOOLBAR} aria-label="Show the preview" onClick={ignore}>
      <AppIcon src={XCODE.icon} size={APP_ICON_SIZE.LINE} />
      <ChipName>{XCODE.name}</ChipName>
      {seen.working ? <WorkingMark /> : null}
    </Chip>
  );
}

// Option C: always there while the agent works, every app a tab of its own, gone as the turn ends.

function AlwaysThere({ seen }: { seen: Seen }): React.JSX.Element {
  return (
    <PreviewCard narrow={seen.narrow}>
      <TitleBar
        app={XCODE}
        seen={seen}
        middle={
          <span className="flex items-center">
            {APPS.map((app) => (
              <IconButton
                key={app.name}
                icon={<AppIcon src={app.icon} size={APP_ICON_SIZE.LINE} />}
                label={app.name}
                size={BUTTON_SIZE.COMPACT}
                pressed={app === XCODE}
                onClick={ignore}
              />
            ))}
          </span>
        }
        end={
          <>
            <ShowApp app={XCODE} seen={seen} />
            <StopTurn seen={seen} />
          </>
        }
      />
      <Window app={XCODE} narrow={seen.narrow} />
    </PreviewCard>
  );
}

// Option D: folds into its own title bar, and unfolds from it.

function Foldable({ seen, folded }: { seen: Seen; folded: boolean }): React.JSX.Element {
  return (
    <PreviewCard narrow={seen.narrow}>
      <TitleBar
        app={XCODE}
        seen={seen}
        middle={
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {`+${String(APPS.length - 1)} apps`}
          </Text>
        }
        end={
          <>
            <ShowApp app={XCODE} seen={seen} />
            <IconButton
              icon={folded ? <ChevronUpIcon /> : <ChevronDownIcon />}
              label={folded ? "Unfold" : "Fold"}
              size={BUTTON_SIZE.COMPACT}
              onClick={ignore}
            />
            {seen.working ? (
              <StopTurn seen={seen} />
            ) : (
              <IconButton
                icon={<CloseIcon />}
                label="Close"
                size={BUTTON_SIZE.COMPACT}
                onClick={ignore}
              />
            )}
          </>
        }
      />
      {folded ? null : <Window app={XCODE} narrow={seen.narrow} />}
    </PreviewCard>
  );
}

// The scene each is drawn in: a transcript's last lines, what floats over the box, and the box.

function Composer({ foot, working }: { foot?: ReactNode; working: boolean }): React.JSX.Element {
  return (
    <ComposerFrame
      as={COMPOSER_ELEMENT.FORM}
      look={COMPOSER_LOOK.CARD}
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="catalog-composer">
        <Stack gap={GAP.CONTROL}>
          <Text tone={TEXT_TONE.MUTED}>Message the agent</Text>
          <Inline justify={JUSTIFY.BETWEEN}>
            <Inline gap={GAP.TIGHT}>
              <IconButton label="Attach files" icon={<PlusIcon />} onClick={ignore} />
              {foot}
            </Inline>
            <IconButton
              label={working ? "Stop" : "Send"}
              variant={BUTTON_VARIANT.INK}
              submit={working ? SUBMIT_STATE.STREAMING : SUBMIT_STATE.READY}
              onClick={ignore}
            />
          </Inline>
        </Stack>
      </div>
    </ComposerFrame>
  );
}

function Scene({
  id,
  caption,
  narrow,
  over,
  foot,
  working = true,
}: {
  working?: boolean;
  id: string;
  caption: string;
  narrow: boolean;
  over?: ReactNode;
  foot?: ReactNode;
}): React.JSX.Element {
  return (
    <figure id={id} className={`cpo-scene ${narrow ? "cpo-narrow" : "cpo-wide"}`}>
      <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {caption}
      </Text>
      <div className="cpo-room">
        <Text tone={TEXT_TONE.MUTED}>Clicked Build in Xcode</Text>
        <Text tone={TEXT_TONE.MUTED}>Looked at Simulator</Text>
        <div className={`cpo-over ${narrow ? "" : "cpo-over-end"}`}>{over}</div>
        <Composer foot={foot} working={working} />
      </div>
    </figure>
  );
}

const WORKING_HERE = { working: true, onThatMac: true, narrow: false } as const;
const WORKING_ELSEWHERE = { working: true, onThatMac: false, narrow: false } as const;
const DONE_HERE = { working: false, onThatMac: true, narrow: false } as const;
const NARROW_WORKING = { working: true, onThatMac: false, narrow: true } as const;
const NARROW_DONE = { working: false, onThatMac: false, narrow: true } as const;

function OptionA(): React.JSX.Element {
  return (
    <div className="cpo-row" id="option-a">
      <div className="cpo-line">
        <Scene
          id="a-wide"
          narrow={false}
          caption="Working, on the Mac it uses"
          over={<TitledWindow seen={WORKING_HERE} />}
        />
        <Scene
          id="a-minimized"
          narrow={false}
          caption="Minimized"
          over={<MinimizedPill seen={WORKING_HERE} />}
        />
        <Scene
          working={false}
          id="a-done"
          narrow={false}
          caption="Done: minimizes itself until the next turn"
          over={<MinimizedPill seen={DONE_HERE} />}
        />
      </div>
      <div className="cpo-line">
        <Scene
          id="a-narrow"
          narrow
          caption="Narrow, another device"
          over={<TitledWindow seen={NARROW_WORKING} />}
        />
        <Scene
          id="a-narrow-min"
          narrow
          caption="Narrow, minimized"
          over={<MinimizedPill seen={NARROW_WORKING} />}
        />
      </div>
    </div>
  );
}

function OptionB(): React.JSX.Element {
  return (
    <div className="cpo-row" id="option-b">
      <div className="cpo-line">
        <Scene
          id="b-wide"
          narrow={false}
          caption="Working, on the Mac it uses"
          over={<PictureInPicture seen={WORKING_HERE} />}
        />
        <Scene
          id="b-closed"
          narrow={false}
          caption="Closed: the box's foot brings it back"
          foot={<ReopenChip seen={WORKING_HERE} />}
        />
        <Scene
          working={false}
          id="b-done"
          narrow={false}
          caption="Done: stays until closed or the next turn"
          over={<PictureInPicture seen={DONE_HERE} />}
        />
      </div>
      <div className="cpo-line">
        <Scene
          id="b-narrow"
          narrow
          caption="Narrow, another device"
          over={<PictureInPicture seen={NARROW_WORKING} />}
        />
        <Scene
          id="b-narrow-closed"
          narrow
          caption="Narrow, closed"
          foot={<ReopenChip seen={NARROW_WORKING} />}
        />
      </div>
    </div>
  );
}

function OptionC(): React.JSX.Element {
  return (
    <div className="cpo-row" id="option-c">
      <div className="cpo-line">
        <Scene
          id="c-wide"
          narrow={false}
          caption="Working, on the Mac it uses"
          over={<AlwaysThere seen={WORKING_HERE} />}
        />
        <Scene
          id="c-elsewhere"
          narrow={false}
          caption="Working, another device"
          over={<AlwaysThere seen={WORKING_ELSEWHERE} />}
        />
        <Scene
          working={false}
          id="c-done"
          narrow={false}
          caption="Done: gone, the transcript keeps the windows"
        />
      </div>
      <div className="cpo-line">
        <Scene id="c-narrow" narrow caption="Narrow" over={<AlwaysThere seen={NARROW_WORKING} />} />
        <Scene working={false} id="c-narrow-done" narrow caption="Narrow, done" />
      </div>
    </div>
  );
}

function OptionD(): React.JSX.Element {
  return (
    <div className="cpo-row" id="option-d">
      <div className="cpo-line">
        <Scene
          id="d-wide"
          narrow={false}
          caption="Working, on the Mac it uses"
          over={<Foldable seen={WORKING_HERE} folded={false} />}
        />
        <Scene
          id="d-folded"
          narrow={false}
          caption="Folded"
          over={<Foldable seen={WORKING_HERE} folded />}
        />
        <Scene
          working={false}
          id="d-done"
          narrow={false}
          caption="Done: folds itself, Close takes it away"
          over={<Foldable seen={DONE_HERE} folded />}
        />
      </div>
      <div className="cpo-line">
        <Scene
          id="d-narrow"
          narrow
          caption="Narrow, another device"
          over={<Foldable seen={NARROW_WORKING} folded={false} />}
        />
        <Scene
          working={false}
          id="d-narrow-done"
          narrow
          caption="Narrow, done"
          over={<Foldable seen={NARROW_DONE} folded />}
        />
      </div>
    </div>
  );
}

function ComputerPreviewOptions(): React.JSX.Element {
  return (
    <div className="cpo-options">
      <OptionA />
      <OptionB />
      <OptionC />
      <OptionD />
    </div>
  );
}

export const COMPUTER_PREVIEW_OPTIONS_EXAMPLE: Example = {
  id: "computer-preview-options",
  title: "Computer preview options (throwaway)",
  Render: ComputerPreviewOptions,
};
