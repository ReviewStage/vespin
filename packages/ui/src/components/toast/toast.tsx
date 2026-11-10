import { Toast as BaseToast, type ToastObject } from "@base-ui/react/toast";
import { Duration } from "effect";
import type { ReactNode } from "react";
import { AlertIcon, CircleCheckIcon, InboxIcon } from "../../icons/lucide-glyphs.js";
import { type MarkProvider, PROVIDER_MARK_SIZE, ProviderMark } from "../../marks/provider-mark.js";
import { ReplayWords } from "../../session-replay-marks.js";
import { STATUS_TONE } from "../../status-tone.js";
import { SpinnerRing } from "../spinner/spinner.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../text/text.js";

/**
 * toast.tsx -- one passing notice, drawn on Base UI's toast: a glyph for what it reports, its words, an optional second line under them, and at most one action, beside a failure's copy, at its end.
 *
 * A toast is a card of its words, each cut at two lines, led by the glyph its
 * tone picks: a check for what was done, an alert for what was refused, the
 * Inbox's tray for an ask, and the spinner's ring for work still under way;
 * or by a `glyph` of its own, in its tone's ink, where what it says has a
 * glyph that names it better, as the speaker names the Mac's sound; or by
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

/** The ink each glyph is drawn in: its tone's for what was done and what was refused, and the muted ink for an ask, which is the developer's to answer, and for work not done yet, which a toast says no louder than its words. */
const GLYPH_INK = {
  [STATUS_TONE.COMPLETE]: "text-tone-ink",
  [STATUS_TONE.DANGER]: "text-tone-ink",
  [STATUS_TONE.ATTENTION]: "text-muted-foreground",
  [STATUS_TONE.WORKING]: "text-muted-foreground",
} as const satisfies Record<ToastTone, string>;

/**
 * The card: its glyph, its words' first line, and its action share a first
 * row as tall as a control, each centered on it; its words wrap at the card's
 * own line. One with an action ends a step closer to it.
 */
const TOAST_CARD =
  "ui-toast flex items-start gap-icon-gap rounded-toast border border-border-strong bg-background px-list-inset py-row-inset shadow-toast data-[action=true]:pr-toast-gap";

/** The cell its glyph stands in, centered on its first row. */
const TOAST_GLYPH =
  "ui-toast-glyph mt-toast-glyph-inset flex size-control-icon flex-none [&_svg]:size-full";

/** Its words and the line under them, a title's step apart, the column standing as far below its last line as above its first. */
const TOAST_TEXT =
  "ui-toast-text flex min-w-0 flex-1 flex-col gap-toast-line-gap py-toast-text-inset";

/** The glyph a toast leads with: a check for what was done, an alert for what was refused, the Inbox's tray for an ask, and the spinner's ring for work under way. */
function ToneGlyph({ tone }: { tone: ToastTone }): React.JSX.Element {
  switch (tone) {
    case STATUS_TONE.COMPLETE:
      return <CircleCheckIcon />;
    case STATUS_TONE.DANGER:
      return <AlertIcon />;
    case STATUS_TONE.ATTENTION:
      return <InboxIcon />;
    case STATUS_TONE.WORKING:
      return <SpinnerRing />;
  }
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
  words: string;
  /** A second line under the words. */
  detail?: string | undefined;
  /** Whether its words and detail are the app's own, which a screen recording shows as they read; a toast that quotes a person's words, a name, or a refusal's words leaves them masked. */
  replayUnmasked?: boolean | undefined;
  /** Its action and dismiss, as `ToastActions` draws them; a toast with none is never pointed at. */
  actions?: ReactNode;
}): React.JSX.Element {
  const Lead = glyph;
  return (
    <BaseToast.Root
      toast={toast}
      swipeDirection={SWIPE_AWAY}
      className={TOAST_CARD}
      data-tone={tone}
      data-action={actions === undefined ? undefined : "true"}
    >
      <span
        className={`${TOAST_GLYPH} ${mark === undefined ? GLYPH_INK[tone] : MARK_INK}`}
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
        <BaseToast.Title render={<span className="ui-toast-words line-clamp-2 wrap-anywhere" />}>
          <Text variant={TEXT_VARIANT.SECTION} as={TEXT_ELEMENT.SPAN}>
            <ReplayWords unmasked={replayUnmasked}>{words}</ReplayWords>
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
