import { Toast as BaseToast, type ToastObject } from "@base-ui/react/toast";
import { Duration } from "effect";
import type { HTMLAttributes, ReactNode, Ref } from "react";
import { AlertIcon, CircleCheckIcon } from "../../icons/lucide-glyphs.js";
import { type MarkProvider, PROVIDER_MARK_SIZE, ProviderMark } from "../../marks/provider-mark.js";
import { ReplayWords } from "../../session-replay-marks.js";
import { STATUS_TONE } from "../../status-tone.js";
import { CARD_CORNER, CARD_LOOK, CARD_PADDING, CARD_SHADOW, Card } from "../card/card.js";
import {
  INLINE_REF_LOOK,
  INLINE_REF_NAME,
  InlineRef,
  type InlineRefName,
} from "../inline-ref/inline-ref.js";
import { INLINE_REF_FIT } from "../inline-ref/inline-ref-fit.js";
import { SpinnerRing } from "../spinner/spinner.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * toast.tsx -- one passing notice, drawn on Base UI's toast: a glyph for what it reports, its words, an optional second line under them, and at most one action, beside a failure's copy, at its end.
 *
 * A toast is a card of its words, each cut at two lines, naming the thing it
 * is about, where it names one, as a pill in their line (`chip`), wrapping
 * with them or kept whole by the rules every mention in running words
 * keeps, led by the glyph its
 * tone picks, in its tone's ink: a check for what was done, an alert for
 * what was refused or needs the developer, and the spinner's ring for work
 * still under way; or by a `glyph` of its own where what it says has one
 * that names it better, an archive's box or a copy's sheets, in the muted
 * ink but for a refusal's, so color is left to how it went; or by
 * a provider's `mark`, in the brand's own ink rather than the tone's, where
 * what it says is about one of the account's connections.
 * A working toast turns into what came of the work in place, its tone,
 * words, and actions changed on the same card.
 *
 * Its life is Base UI's (`Toast.Root` over the stack's manager,
 * `ToastStack`): its hold, its pause while the pointer is over the stack or
 * focus is in it, Escape and a sideways swipe to send it away, its arrival,
 * departure, and place in the stack, and its words said aloud through the
 * viewport's live regions, a refusal urgently, its words naming it and its
 * second line describing it. One with no action is never
 * pointed at, so clicks pass through it; one with an action or a copy
 * (`ToastActions`, passed as `actions`) takes the pointer.
 *
 * The toast takes no class or style; where it stands is the stack's. It is
 * drawn in Tailwind utilities over the theme; `toast.css` keeps what those
 * cannot say: its place and motion, which read Base UI's custom properties
 * and states, and what answers the pointer, which reads the screen's hover.
 */

/** What a toast reports, of the status tones: the act done, the act refused, something asked of the developer, or work still under way. */
export type ToastTone =
  | typeof STATUS_TONE.COMPLETE
  | typeof STATUS_TONE.DANGER
  | typeof STATUS_TONE.ATTENTION
  | typeof STATUS_TONE.WORKING;

/**
 * How long a toast stands before it leaves by itself, whatever it reports:
 * Base UI's default hold. A confirmation drawn on its own control, a
 * `CopyButton`'s check, stands for it too, so a copy answered on its button
 * and one answered by a toast last the same.
 */
export const TOAST_HOLD = Duration.seconds(5);

/** The ink a provider's mark stands in: the words' own, since a brand mark is no tone's glyph. */
const MARK_INK = "text-foreground";

/** The ink each tone's own glyph is drawn in: its tone's for what was done, what was refused, and what needs the developer, and the muted ink for work not done yet, which a toast says no louder than its words. */
const GLYPH_INK = {
  [STATUS_TONE.COMPLETE]: "text-tone-ink",
  [STATUS_TONE.DANGER]: "text-tone-ink",
  [STATUS_TONE.ATTENTION]: "text-tone-ink",
  [STATUS_TONE.WORKING]: "text-muted-foreground",
} as const satisfies Record<ToastTone, string>;

/** The ink a glyph of the toast's own is drawn in: a refusal's tone, and otherwise the muted ink, since a glyph naming the act (an archive, a copy) says what was done rather than how it went. */
const OWN_GLYPH_INK = {
  [STATUS_TONE.COMPLETE]: "text-muted-foreground",
  [STATUS_TONE.DANGER]: "text-tone-ink",
  [STATUS_TONE.ATTENTION]: "text-muted-foreground",
  [STATUS_TONE.WORKING]: "text-muted-foreground",
} as const satisfies Record<ToastTone, string>;

/** The ink a toast's lead is drawn in: a provider's mark in the words' own, a glyph of its own as `OWN_GLYPH_INK` says, and its tone's glyph in its tone's. */
function leadInk(tone: ToastTone, own: boolean, mark: boolean): string {
  if (mark) return MARK_INK;

  return own ? OWN_GLYPH_INK[tone] : GLYPH_INK[tone];
}

/**
 * The card's own layout, its ground, edge, corner, and shadow a raised
 * `Card`'s (`ToastFrame`): its glyph, its words' first line, and its action share a first
 * row as tall as a control, each centered on it; its words wrap at the card's
 * own line. One with an action button ends a step closer to it.
 */
const TOAST_CARD =
  "ui-toast flex items-start gap-icon-gap px-list-inset py-row-inset has-[.ui-button:not(.ui-toast-dismiss_.ui-button)]:pr-toast-gap";

/** The toast drawn as a card, as Base UI's root renders it: raised, at a dialog's corner, on a toast's shadow, holding what Base UI hands it. */
function ToastFrame({
  children,
  ...props
}: HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> | undefined }): React.JSX.Element {
  return (
    <Card
      {...props}
      look={CARD_LOOK.RAISED}
      corner={CARD_CORNER.DIALOG}
      shadow={CARD_SHADOW.TOAST}
      padding={CARD_PADDING.NONE}
    >
      {children}
    </Card>
  );
}

/** The cell its glyph stands in, centered on its first row. */
const TOAST_GLYPH =
  "ui-toast-glyph mt-toast-glyph-inset flex size-control-icon flex-none [&_svg]:size-full";

/** Its words and the line under them, a title's step apart, the column standing as far below its last line as above its first. */
const TOAST_TEXT =
  "ui-toast-text flex min-w-0 flex-1 flex-col gap-toast-line-gap py-toast-text-inset";

/** The glyph a toast leads with: a check for what was done, an alert for what was refused or needs the developer, each in its tone's ink, and the spinner's ring for work under way. */
function ToneGlyph({ tone }: { tone: ToastTone }): React.JSX.Element {
  switch (tone) {
    case STATUS_TONE.COMPLETE:
      return <CircleCheckIcon />;
    case STATUS_TONE.DANGER:
    case STATUS_TONE.ATTENTION:
      return <AlertIcon />;
    case STATUS_TONE.WORKING:
      return <SpinnerRing />;
  }
}

/**
 * What a toast is about, drawn as a pill in its words as a mention is in
 * running words: the thing's glyph, its name, what kind of thing it is,
 * which a screen reader hears before the name, and what its name is, which
 * says whether it wraps with the words (a title) or is kept whole (a pull
 * request's key), as every mention's does.
 */
export interface ToastChip {
  readonly glyph: ReactNode;
  readonly label: string;
  readonly kind?: string | undefined;
  readonly name?: InlineRefName | undefined;
}

/** Its words' line, cut at two lines, or three where they name a thing as a pill, which wraps with them, so the words after a long name are still read. */
function wordsClass(named: boolean): string {
  return `ui-toast-words wrap-anywhere ${named ? "line-clamp-3" : "line-clamp-2"}`;
}

/** Which ways a toast is swiped away: off either side, as it stands at the window's edge. */
const SWIPE_AWAY: ("left" | "right")[] = ["right", "left"];

/** One toast, the one Base UI keeps as `toast`: its tone, words and detail, and the actions at its end, if it has any. */
export function Toast({
  toast,
  tone,
  glyph,
  mark,
  words,
  chip,
  afterChip,
  detail,
  replayUnmasked = false,
  actions,
}: {
  /** The toast as the stack's manager keeps it, which the stack hands each toast it draws. */
  toast: ToastObject<object>;
  tone: ToastTone;
  /** The glyph it leads with in place of its tone's, where what it says has one of its own. */
  glyph?: (() => React.JSX.Element) | undefined;
  /** The provider whose mark it leads with in place of its tone's glyph, where what it says is about that provider's connection. */
  mark?: MarkProvider | undefined;
  /** Its words, or where it names what it is about, its words up to that pill. */
  words: string;
  /** What it is about, drawn as a pill after `words`, in their line: the task, agent, Inbox item, or pull request it names. */
  chip?: ToastChip | undefined;
  /** Its words after the pill, where the sentence goes on past it ("Marked [task] done"). */
  afterChip?: string | undefined;
  /** A second line under the words. */
  detail?: string | undefined;
  /** Whether its words and detail are the app's own, which a screen recording shows as they read; a toast that quotes a person's words, a name, or a refusal's words leaves them masked. */
  replayUnmasked?: boolean | undefined;
  /** Its ×, beside its action and copy where it has them, as `ToastActions` draws them. */
  actions: ReactNode;
}): React.JSX.Element {
  const Lead = glyph;

  return (
    <BaseToast.Root
      toast={toast}
      swipeDirection={SWIPE_AWAY}
      render={(frame) => <ToastFrame {...frame} />}
      className={TOAST_CARD}
      data-tone={tone}
    >
      <span
        className={`${TOAST_GLYPH} ${leadInk(tone, glyph !== undefined, mark !== undefined)}`}
        aria-hidden="true"
      >
        {mark !== undefined ? (
          <ProviderMark provider={mark} size={PROVIDER_MARK_SIZE.SLOT} />
        ) : Lead !== undefined ? (
          <Lead />
        ) : (
          <ToneGlyph tone={tone} />
        )}
      </span>
      <span className={TOAST_TEXT}>
        <BaseToast.Title render={<span className={wordsClass(chip !== undefined)} />}>
          <Text variant={TEXT_VARIANT.SECTION} as={TEXT_ELEMENT.SPAN}>
            <ReplayWords unmasked={replayUnmasked}>{words}</ReplayWords>
            {chip === undefined ? null : (
              <>
                {" "}
                <ReplayWords unmasked={false}>
                  <InlineRef
                    look={INLINE_REF_LOOK.PILL}
                    fit={INLINE_REF_FIT.FLOW}
                    name={chip.name ?? INLINE_REF_NAME.NAME}
                    glyph={chip.glyph}
                    label={chip.label}
                    kind={chip.kind}
                    hint={false}
                  />
                </ReplayWords>
              </>
            )}
            {afterChip === undefined ? null : (
              <ReplayWords unmasked={replayUnmasked}>{` ${afterChip}`}</ReplayWords>
            )}
          </Text>
        </BaseToast.Title>
        {detail === undefined ? null : (
          <BaseToast.Description
            render={<span className="ui-toast-detail line-clamp-2 wrap-anywhere" />}
          >
            <Text variant={TEXT_VARIANT.CAPTION} as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED}>
              <ReplayWords unmasked={replayUnmasked}>{detail}</ReplayWords>
            </Text>
          </BaseToast.Description>
        )}
      </span>
      {actions}
    </BaseToast.Root>
  );
}
