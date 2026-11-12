import type { ReactNode } from "react";
import { ForwardIcon, PlusIcon } from "../../icons/lucide-glyphs.js";
import { CARD_CORNER, CARD_HOVER, CARD_PADDING, Card } from "../card/card.js";
import { CardPress } from "../card-press/card-press.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * suggestion-card.tsx -- something the app suggests starting, as a card of its own in a grid under a heading: what it is, what it does, and one press that starts it.
 *
 * Each card stands its glyph on a tile, a plus at its corner, its name, and
 * a line saying what it does, the whole card one press (`CardPress`) that
 * starts it, washed while the pointer rests on it. One that cannot be
 * started yet stands faded and takes no press. One that needs something
 * first, such as an integration connected, says so at its foot instead of
 * its plus: the thing's mark, what to do, and, where its press goes on to
 * do it, a chevron. The cards stand in a grid
 * that wraps as more are suggested (`SuggestionCards`), under a muted
 * heading that names the region, as the Automations list suggests the
 * automations a member may start from a preset.
 */

/** The cards suggested, in a grid that wraps, under `title`, which names the region. */
export function SuggestionCards({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <section className="ui-suggestions flex w-full flex-col gap-control-gap" aria-label={title}>
      <div className="ui-suggestions-head px-ui-2">
        <Text variant={TEXT_VARIANT.SECTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.H2}>
          {title}
        </Text>
      </div>
      <div className="ui-suggestion-cards grid grid-cols-suggestion-cards gap-block-gap">
        {children}
      </div>
    </section>
  );
}

/**
 * What a suggestion needs before it can start, said at the card's foot: the
 * mark of what it needs, such as an integration's, and the words saying
 * what to do, such as "Connect Sentry", or, for a reader who cannot, whom
 * to ask.
 */
export interface SuggestionNeeds {
  readonly mark: ReactNode;
  readonly words: string;
}

/**
 * One suggestion: `glyph` on its tile, `name` over `detail`, the whole card
 * pressed to start it, a plus at its corner. One that `needs` something
 * first stands no plus, and says what at its foot, under a hairline, with a
 * chevron where its press goes on to meet it.
 */
export function SuggestionCard({
  glyph,
  name,
  detail,
  needs,
  disabled = false,
  onPress,
}: {
  /** What it stands for, such as the glyph of what fires an automation. */
  glyph: ReactNode;
  name: string;
  /** What it does, in a line or two. */
  detail: string;
  /** What it needs before it can start, said at its foot; none where it can start as it is. */
  needs?: SuggestionNeeds | undefined;
  /** Whether it cannot be started yet, so it stands faded and takes no press. */
  disabled?: boolean | undefined;
  onPress: () => void;
}): React.JSX.Element {
  return (
    <Card
      corner={CARD_CORNER.CONTROL}
      padding={CARD_PADDING.COMPACT}
      hover={disabled ? CARD_HOVER.NONE : CARD_HOVER.WASH}
      className="ui-suggestion-card relative flex min-w-0 flex-col data-[disabled=true]:opacity-disabled"
      data-disabled={disabled ? "true" : undefined}
    >
      <CardPress disabled={disabled} onPress={() => onPress()}>
        <span className="flex h-full flex-col gap-item-gap">
          <span className="mb-item-gap flex items-start justify-between" aria-hidden="true">
            <span className="ui-suggestion-card-glyph flex size-ui-32 items-center justify-center rounded-control border border-border bg-muted text-muted-foreground [&_svg]:size-ui-16">
              {glyph}
            </span>
            {needs === undefined ? (
              <span className="flex size-ui-16 flex-none items-center justify-center text-muted-foreground [&_svg]:size-ui-16">
                <PlusIcon />
              </span>
            ) : null}
          </span>
          <Text variant={TEXT_VARIANT.LABEL} as={TEXT_ELEMENT.SPAN}>
            {name}
          </Text>
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED} as={TEXT_ELEMENT.SPAN}>
            {detail}
          </Text>
          {needs === undefined ? null : (
            <span className="ui-suggestion-card-needs mt-auto flex items-center gap-item-gap border-t border-border pt-control-gap">
              <span
                className="flex size-ui-16 flex-none items-center justify-center [&_svg]:size-ui-16"
                aria-hidden="true"
              >
                {needs.mark}
              </span>
              <span className="min-w-0 flex-1">
                <Text variant={TEXT_VARIANT.CAPTION} as={TEXT_ELEMENT.SPAN}>
                  {needs.words}
                </Text>
              </span>
              {disabled ? null : (
                <span
                  className="flex size-ui-16 flex-none items-center justify-center text-muted-foreground [&_svg]:size-ui-16"
                  aria-hidden="true"
                >
                  <ForwardIcon />
                </span>
              )}
            </span>
          )}
        </span>
      </CardPress>
    </Card>
  );
}
