import {
  Avatar,
  BUTTON_SIZE,
  BUTTON_VARIANT,
  Button,
  CHOICE_FLOW,
  CHOICE_LOOK,
  CHOICE_SELECT,
  Checkbox,
  CheckIcon,
  type ChoiceFlow,
  ChoiceList,
  type ChoiceLook,
  type ChoiceOption,
  type ChoiceSelect,
  ExternalIcon,
  GAP,
  GlyphSlot,
  Inline,
  MARK_PROVIDER,
  OPTION_MEDIA_KIND,
  OptionMedia,
  type OptionMediaKind,
  type OptionMediaPiece,
  PAGE_THUMB_FIT,
  PageThumb,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  SETTINGS_ROW_STATE,
  SettingsRowStateLine,
  SettingsSection,
  STATUS_TONE,
  Stack,
  SteppedBack,
  Text,
  TextLink,
} from "@repo/ui";
import { GLYPH, ICON_SIZE, ImageOffIcon } from "@repo/ui/icons";
import { useState } from "react";
import type { Example } from "../example";
import { CatalogSection } from "../section";

/**
 * choice-list.tsx -- a pick-one list with a recommended option and an
 * unavailable one, a pick-several list, both marked with their radios or
 * checkboxes and numbered, a yes and a no across, toned, pills, cards holding controls of their own, settings rows holding the same, rows with a mark before their words, an
 * unavailable list, a settled record of what was picked, a marked list
 * stepped back beside a step and its presses, as an ask taken back, a list
 * and its presses on a tint laid over the column's ground, as a post that
 * needs the reader draws its ask, and a narrow column of long words.
 */

const RETRIES: readonly ChoiceOption<string>[] = [
  {
    value: "three",
    label: "Retry 3 times over an hour",
    detail: "Most failures clear within the hour.",
    badge: "Recommended",
  },
  { value: "once", label: "Retry once", detail: "Fails fast, pages sooner." },
  {
    value: "queue",
    label: "Hold in the queue",
    detail: "Unavailable: the queue is full.",
    disabled: true,
  },
];

const CHANNELS: readonly ChoiceOption<string>[] = [
  { value: "email", label: "Email", detail: "To the account's own address." },
  { value: "slack", label: "Slack", detail: "To #alerts." },
  { value: "pager", label: "Pager", detail: "Wakes whoever is on call." },
];

const DECISIONS: readonly ChoiceOption<string>[] = [
  { value: "approve", label: "Approve", tone: STATUS_TONE.COMPLETE },
  { value: "decline", label: "Decline", tone: STATUS_TONE.DANGER },
];

const WORKSPACES: readonly ChoiceOption<string>[] = [
  { value: "acme", label: "Acme", detail: "12 members", mark: <Avatar name="Acme" decorative /> },
  {
    value: "northwind",
    label: "Northwind",
    detail: "Personal workspace",
    mark: <Avatar name="Northwind" decorative />,
  },
  {
    value: "globex",
    label: "Globex",
    detail: "No GitHub connected · cannot reach acme/api",
    mark: <Avatar name="Globex" decorative />,
    disabled: true,
  },
];

const LONG: readonly ChoiceOption<string>[] = [
  {
    value: "path",
    label: "Move packages/service/src/maintenance/maintenance-sweep.ts under the cron's own folder",
    detail: "Keeps the sweep beside the route that calls it, which the next reader looks in first.",
    badge: "Recommended",
  },
  { value: "keep", label: "Leave it where it is" },
];

const CREDENTIALS: readonly ChoiceOption<string>[] = [
  {
    value: "subscription",
    label: "Subscription",
    badge: "Recommended",
    after: (
      <span style={{ display: "inline-flex", width: 12, height: 12, marginLeft: 8 }}>
        <CheckIcon />
      </span>
    ),
    below: <Text>Connected as ada@example.com.</Text>,
  },
  {
    value: "key",
    label: "API key",
    aside: <TextLink href="https://example.com/keys">Get key</TextLink>,
    below: <Text>No key saved yet.</Text>,
    disabled: true,
  },
  {
    value: "desktop",
    label: "ChatGPT sign-in",
    detail: "Desktop only",
    disabled: true,
  },
];

/** A rows list's credentials, as Settings › Agents draws them: the plan connected, the key with its own Add key. */
const CREDENTIAL_ROWS: readonly ChoiceOption<string>[] = [
  {
    value: "plan",
    label: "Claude plan",
    mark: <ProviderMark provider={MARK_PROVIDER.CLAUDE} size={PROVIDER_MARK_SIZE.ROW} />,
    state: (
      <SettingsRowStateLine state={SETTINGS_ROW_STATE.CONNECTED}>Connected</SettingsRowStateLine>
    ),
    aside: <Button variant={BUTTON_VARIANT.QUIET}>Disconnect</Button>,
  },
  {
    value: "key",
    label: "Anthropic API key",
    mark: (
      <GlyphSlot size={ICON_SIZE.LARGE}>
        <GLYPH.API_KEY />
      </GlyphSlot>
    ),
    aside: <Button variant={BUTTON_VARIANT.OUTLINE}>Add key</Button>,
    below: <Text>Create an API key, then paste it here.</Text>,
    disabled: true,
  },
];

/** A made-up screenshot `width` by `height`, its ground `fill`, with a bar and a block on it. */
function shot(width: number, height: number, fill: string): string {
  const bar = Math.max(6, Math.round(height * 0.08));

  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${fill}"/><rect x="6%" y="6%" width="50%" height="${bar}" rx="${bar / 2}" fill="#fff9"/><rect x="6%" y="24%" width="88%" height="60%" rx="8" fill="#fff5"/></svg>`,
  )}`;
}

const PAGE = `data:text/html,${encodeURIComponent("<body style='margin:0;font:48px sans-serif;background:#fff;padding:32px'><h1>Directions</h1><p>Three ways a turn could end.</p>")}`;

/** Nothing opens in the catalog. */
const OPEN = () => undefined;

/** A picture or a recording `width` by `height` as an option's tile, whole on its ground. */
function filed(
  caption: string | undefined,
  width: number,
  height: number,
  kind: OptionMediaKind = OPTION_MEDIA_KIND.PICTURE,
): OptionMediaPiece {
  const image = shot(width, height, `hsl(${(width * 7 + height) % 360} 60% 60%)`);
  const thumb = <PageThumb fit={PAGE_THUMB_FIT.CONTAIN} image={image} />;

  return { kind, caption, thumb, onOpen: OPEN };
}

/**
 * A choice between designs: each kind of media, then the shapes and the
 * states a tile meets (a tall phone shot, a wide banner, a small icon never
 * enlarged, no caption, a long one cut short, one still read, one gone),
 * an option with none, and None of these.
 */
const DESIGNS: readonly ChoiceOption<string>[] = [
  {
    value: "kinds",
    label: "Every kind",
    state: "A picture, a recording, a page, and a link.",
    badge: "Recommended",
    below: (
      <OptionMedia
        label="Every kind"
        pieces={[
          filed("On a desktop", 1440, 900),
          filed("Ticking two follow-ups", 1280, 720, OPTION_MEDIA_KIND.RECORDING),
          {
            kind: OPTION_MEDIA_KIND.PAGE,
            caption: "Done card directions",
            thumb: (
              <PageThumb frame={{ title: "Directions", src: PAGE, sandbox: "allow-scripts" }} />
            ),
            mark: <GLYPH.PAGE />,
            onOpen: OPEN,
          },
          {
            kind: OPTION_MEDIA_KIND.LINK,
            caption: "preview.example.com",
            thumb: <PageThumb glyph={<ExternalIcon />} />,
            onOpen: OPEN,
          },
        ]}
      />
    ),
  },
  {
    value: "shapes",
    label: "Shapes, captions, and states",
    state: "Tall, wide, a small icon, no caption, a long one, on its way, and gone.",
    below: (
      <OptionMedia
        label="Shapes, captions, and states"
        pieces={[
          filed("On a phone", 390, 844),
          filed("Banner, 4 to 1", 1600, 400),
          filed("App icon", 64, 64),
          filed(undefined, 1200, 800),
          filed("The whole flow from opening a thread to sending the answer", 1920, 1080),
          {
            kind: OPTION_MEDIA_KIND.PICTURE,
            caption: "On its way",
            thumb: <PageThumb />,
            onOpen: OPEN,
          },
          {
            kind: OPTION_MEDIA_KIND.PICTURE,
            caption: "Could not be read",
            thumb: <PageThumb glyph={<ImageOffIcon />} />,
            onOpen: OPEN,
          },
        ]}
      />
    ),
  },
  { value: "plain", label: "An option with no media", state: "Its card holds its words alone." },
  { value: "none", label: "None of these" },
];

function Held({
  options,
  start,
  legend,
  select,
  disabled = false,
  look,
  numbered,
  flow,
}: {
  options: readonly ChoiceOption<string>[];
  start: readonly string[];
  legend: string;
  select?: ChoiceSelect;
  disabled?: boolean;
  look?: ChoiceLook;
  numbered?: boolean;
  flow?: ChoiceFlow;
}): React.JSX.Element {
  const [value, setValue] = useState(start);

  return (
    <ChoiceList
      legend={legend}
      options={options}
      value={value}
      select={select}
      look={look}
      numbered={numbered}
      flow={flow}
      clearable
      disabled={disabled}
      onChange={setValue}
    />
  );
}

function ChoiceLists(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="choice-list-one" title="Pick one">
        <Held legend="Retries" options={RETRIES} start={["three"]} />
      </CatalogSection>
      <CatalogSection id="choice-list-many" title="Pick any that apply">
        <Held
          legend="Channels"
          options={CHANNELS}
          start={["email", "pager"]}
          select={CHOICE_SELECT.MANY}
        />
      </CatalogSection>
      <CatalogSection id="choice-list-marked" title="Marked and numbered">
        <Held
          legend="Retries"
          options={RETRIES}
          start={["three"]}
          look={CHOICE_LOOK.MARKED}
          numbered
        />
        <Held
          legend="Channels"
          options={CHANNELS}
          start={["email", "pager"]}
          select={CHOICE_SELECT.MANY}
          look={CHOICE_LOOK.MARKED}
          numbered
        />
      </CatalogSection>
      <CatalogSection id="choice-list-across" title="Across, toned">
        <Held
          legend="Decision"
          options={DECISIONS}
          start={["approve"]}
          look={CHOICE_LOOK.MARKED}
          flow={CHOICE_FLOW.ACROSS}
          numbered
        />
      </CatalogSection>
      <CatalogSection id="choice-list-pill" title="Pills">
        <Held
          legend="Effort"
          options={[
            { value: "medium", label: "medium" },
            { value: "high", label: "high" },
            { value: "xhigh", label: "xhigh", badge: "Recommended" },
          ]}
          start={["high"]}
          look={CHOICE_LOOK.PILL}
        />
      </CatalogSection>
      <CatalogSection id="choice-list-card" title="Cards holding controls">
        <Held
          legend="Credential"
          options={CREDENTIALS}
          start={["subscription"]}
          look={CHOICE_LOOK.CARD}
        />
      </CatalogSection>
      <CatalogSection id="choice-list-media" title="Cards carrying media">
        <Held
          legend="Designs"
          options={DESIGNS}
          start={["kinds"]}
          select={CHOICE_SELECT.MANY}
          look={CHOICE_LOOK.CARD}
        />
      </CatalogSection>
      <CatalogSection id="choice-list-rows" title="Settings rows holding controls">
        <SettingsSection title="Claude">
          <Held
            legend="New Claude agents use"
            options={CREDENTIAL_ROWS}
            start={["plan"]}
            look={CHOICE_LOOK.ROWS}
          />
        </SettingsSection>
      </CatalogSection>
      <CatalogSection id="choice-list-mark" title="With a mark">
        <Held legend="Workspace" options={WORKSPACES} start={["northwind"]} />
      </CatalogSection>
      <CatalogSection id="choice-list-disabled" title="Unavailable while sending">
        <Held legend="Retries" options={RETRIES} start={["once"]} disabled />
      </CatalogSection>
      <CatalogSection id="choice-list-settled" title="Settled">
        <ChoiceList
          legend="What was offered"
          options={RETRIES}
          value={["once"]}
          settled
          pickedNote="Your pick"
        />
      </CatalogSection>
      <CatalogSection id="choice-list-stepped-back" title="Stepped back, as an ask taken back">
        <SteppedBack>
          <Stack gap={GAP.CONTROL}>
            <ChoiceList
              legend="What was asked"
              options={RETRIES}
              value={[]}
              select={CHOICE_SELECT.ONE}
              look={CHOICE_LOOK.MARKED}
              readOnly
              onChange={() => undefined}
            />
            <Checkbox checked={false} readOnly onChange={() => undefined}>
              Open the repository's settings, then add the secret.
            </Checkbox>
            <Inline>
              <Button variant={BUTTON_VARIANT.OUTLINE} size={BUTTON_SIZE.COMPACT} readOnly>
                Mark done
              </Button>
              <Button variant={BUTTON_VARIANT.QUIET} size={BUTTON_SIZE.COMPACT} readOnly>
                Couldn't do it
              </Button>
            </Inline>
          </Stack>
        </SteppedBack>
      </CatalogSection>
      <CatalogSection id="choice-list-narrow" title="Narrow column, long words">
        <div className="catalog-narrow">
          <Held legend="Where the sweep lives" options={LONG} start={[]} />
        </div>
      </CatalogSection>
    </>
  );
}

export const CHOICE_LIST_EXAMPLE: Example = {
  id: "choice-list",
  title: "Choice list",
  Render: ChoiceLists,
};
