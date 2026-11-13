/**
 * call-controls.tsx -- a call's controls: Talk, which starts one; its two mutes; the one red End call; the status a message box's foot shows while a call stands; the composer's row of them; and the bar that lays the mutes and End call out beside the call's status.
 *
 * Every place a call is steered from draws these, so a mute and the way to
 * hang up wear the same words, glyphs, and colors wherever they stand. Each
 * takes what it shows and the press it hands back, and decides nothing:
 * whether a call stands, what its status says, and what a press asks of the
 * voice are the owner's. End call is the one red control, on the danger fill
 * with the hang-up glyph (`GLYPH.END_CALL`), because ending a call cannot be
 * undone; a mute is quiet while off and lit in neutral gray while on, its
 * glyph struck through, since muting is no failure. A live call wears the
 * working blue. No mute names a chord, since the app has no chord for one.
 */

import { PRODUCT_NAME } from "@repo/features/product-name";
import { GLYPH } from "../../icons/glyph-registry.js";
import {
  MicrophoneIcon,
  MicrophoneOffIcon,
  SpeakerIcon,
  SpeakerOffIcon,
  WaveformIcon,
} from "../../icons/lucide-glyphs.js";
import { STATUS_TONE } from "../../status-tone.js";
import {
  BUTTON_CORNERS,
  BUTTON_VARIANT,
  type ButtonCorners,
  IconButton,
} from "../button/button.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";
import { TIME_LOOK, Time } from "../time/time.js";
import { Tooltip } from "../tooltip/hint.js";
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";
import { WorkingMark } from "../working-mark/working-mark.js";

/** What a reader is told while the agent works; the sighted read the mark and the line. */
const AGENT_WORKING_LABEL = `${PRODUCT_NAME} is working on it`;

/** What the group of a call's controls in a message box is named for a reader, since no line there names the call. */
const CALL_CONTROLS_LABEL = `Call with ${PRODUCT_NAME}`;

/** The agent's line's words, subject-free like the voice's: what it says with no command pending, and what leads the command it runs. */
const AGENT_THINKING = "Thinking";
const AGENT_WORKING = "Working";

/** Talk's name for a reader and its hover: what it does, or, with no OpenAI API key saved, what a call needs first. */
export const TALK_LABEL = {
  TALK: "Talk",
  KEY_MISSING: "Add an OpenAI API key",
} as const;

/** Each call control's name for a reader and its hover, by whether it is on. */
export const CALL_CONTROL_LABEL = {
  MUTE_MICROPHONE: "Mute microphone",
  UNMUTE_MICROPHONE: "Unmute microphone",
  MUTE_SPEAKER: "Mute speaker",
  UNMUTE_SPEAKER: "Unmute speaker",
  END_CALL: "End call",
} as const;

/** Where a call stands, as its status in a message box's foot says it: coming up, up, or on its way down. */
export const CALL_STAGE = {
  CONNECTING: "connecting",
  LIVE: "live",
  ENDING: "ending",
} as const;

export type CallStage = (typeof CALL_STAGE)[keyof typeof CALL_STAGE];

/** What a call's status in a message box's foot says: coming up, live, muted, or on its way down. */
export const CALL_LIVE_WORD = {
  CONNECTING: "Connecting…",
  LIVE: "On call",
  MUTED: "Muted",
  ENDING: "Ending…",
} as const;

/** What a mute silences: the caller's microphone, or the voice on this device alone. */
export const CALL_DEVICE = {
  MICROPHONE: "microphone",
  SPEAKER: "speaker",
} as const;

export type CallDevice = (typeof CALL_DEVICE)[keyof typeof CALL_DEVICE];

/** Each device's mute: its names off and on, and its glyphs off and on. */
const MUTE = {
  [CALL_DEVICE.MICROPHONE]: {
    mute: CALL_CONTROL_LABEL.MUTE_MICROPHONE,
    unmute: CALL_CONTROL_LABEL.UNMUTE_MICROPHONE,
    Live: MicrophoneIcon,
    Muted: MicrophoneOffIcon,
  },
  [CALL_DEVICE.SPEAKER]: {
    mute: CALL_CONTROL_LABEL.MUTE_SPEAKER,
    unmute: CALL_CONTROL_LABEL.UNMUTE_SPEAKER,
    Live: SpeakerIcon,
    Muted: SpeakerOffIcon,
  },
} as const;

/**
 * A call's two lines as its bar draws them: the voice's word ("Listening",
 * "Speaking"), and the agent's line while it works, with the command it runs
 * where it has one.
 */
export interface CallStatus {
  readonly voiceWord: string;
  readonly agent: { readonly action: string | undefined } | undefined;
}

/** A mute as its owner hands it: whether it is on, and its press. */
export interface CallMuteState {
  readonly muted: boolean;
  readonly onPress: () => void;
}

/**
 * Talk, the waveform beside Dictate, which opens a call into the agent. With
 * no OpenAI API key saved (`keyMissing`) it reads as unavailable and says
 * what a call needs, yet still takes a press, which is the owner's to answer,
 * as Dictate's own does: open the settings the key is saved in. `disabled`
 * takes every press away, as while a draft's agent is still starting.
 */
export function TalkButton({
  keyMissing = false,
  disabled = false,
  onPress,
}: {
  keyMissing?: boolean | undefined;
  disabled?: boolean | undefined;
  onPress: () => void;
}): React.JSX.Element {
  const label = keyMissing ? TALK_LABEL.KEY_MISSING : TALK_LABEL.TALK;
  const refused = keyMissing && !disabled;

  return (
    <Tooltip label={label}>
      <IconButton
        icon={<WaveformIcon />}
        label={label}
        disabled={disabled || keyMissing}
        focusableWhenDisabled={refused}
        onRefused={refused ? onPress : undefined}
        onClick={onPress}
      />
    </Tooltip>
  );
}

/**
 * A mute the call offers, round in the call bar and square in an agent's
 * composer row: named for what the press will do, and its glyph struck
 * through, lit in neutral gray, while muted.
 */
export function CallMute({
  device,
  muted,
  corners = BUTTON_CORNERS.ROUND,
  onPress,
}: {
  device: CallDevice;
  muted: boolean;
  corners?: ButtonCorners | undefined;
  onPress: () => void;
}): React.JSX.Element {
  const mute = MUTE[device];
  const label = muted ? mute.unmute : mute.mute;

  return (
    <Tooltip label={label}>
      <IconButton
        variant={BUTTON_VARIANT.QUIET}
        corners={corners}
        icon={muted ? <mute.Muted /> : <mute.Live />}
        label={label}
        pressed={muted}
        onClick={onPress}
      />
    </Tooltip>
  );
}

/** End call: the one red control, round, wearing the hang-up glyph, wherever a call is steered from. */
export function EndCallButton({ onPress }: { onPress: () => void }): React.JSX.Element {
  return (
    <Tooltip label={CALL_CONTROL_LABEL.END_CALL}>
      <IconButton
        variant={BUTTON_VARIANT.DANGER}
        corners={BUTTON_CORNERS.ROUND}
        icon={<GLYPH.END_CALL />}
        label={CALL_CONTROL_LABEL.END_CALL}
        onClick={onPress}
      />
    </Tooltip>
  );
}

/** What a call's status is drawn from: a call coming up or going down, which has no count yet or any more, or one that is up. */
export type CallLiveProps =
  | { stage: typeof CALL_STAGE.CONNECTING | typeof CALL_STAGE.ENDING }
  | {
      stage: typeof CALL_STAGE.LIVE;
      /** Epoch milliseconds the call started, which its count runs from. */
      startedAt: number;
      /** Whether the call's microphone is muted. */
      muted: boolean;
      /** The moment the count stands still at; none counts each second. */
      now?: number | undefined;
    };

/**
 * A call's status in a message box's foot, on one line in the caption's
 * type. In a narrow box's foot it gives way before the call's controls or
 * the send do: first a live call's word (`liveWordClass`), the mark and the
 * count saying the call is up, while "Connecting…" and "Ending…", which
 * have no count to say it and are narrower for it, keep theirs; and then the
 * whole, where the box folds its own presses into its ⋯, the mutes' struck
 * glyphs and End call still saying a call stands (`ComposerFoot`'s
 * container). Note that each width is off-scale: 496px, where the foot's
 * live word stops fitting, and 376px, where its live mark does.
 */
const LIVE =
  "ui-call-live flex flex-none items-center gap-ui-6 text-caption whitespace-nowrap text-muted-foreground @max-[376px]/ui-composer-foot:hidden";

/** The word, in the text's ink while live, and quiet while muted, never red, or while the call comes up or goes down. */
function liveWordClass(props: CallLiveProps): string {
  if (props.stage !== CALL_STAGE.LIVE) return "ui-call-live-word text-muted-foreground";
  const ink = props.muted ? "text-muted-foreground" : "text-foreground";

  return `ui-call-live-word ${ink} @max-[496px]/ui-composer-foot:hidden`;
}

/** The mark a call's status leads with: the live tone while up, the struck microphone while muted, and the quiet tone either side of it. */
function CallLiveMark({ props }: { props: CallLiveProps }): React.JSX.Element {
  if (props.stage === CALL_STAGE.LIVE && props.muted) {
    return (
      <span className="ui-call-live-muted flex flex-none [&>svg]:size-icon-12" aria-hidden="true">
        <MicrophoneOffIcon />
      </span>
    );
  }

  const tone = props.stage === CALL_STAGE.LIVE ? STATUS_TONE.WORKING : STATUS_TONE.NEUTRAL;

  return (
    <span
      className="ui-call-live-mark size-ui-6 flex-none rounded-ui-full bg-tone-ink"
      data-tone={tone}
      aria-hidden="true"
    />
  );
}

/** The word a call's status says, by its stage and, while it is up, whether it is muted. */
function callLiveWord(props: CallLiveProps): string {
  if (props.stage !== CALL_STAGE.LIVE) {
    return props.stage === CALL_STAGE.CONNECTING
      ? CALL_LIVE_WORD.CONNECTING
      : CALL_LIVE_WORD.ENDING;
  }

  return props.muted ? CALL_LIVE_WORD.MUTED : CALL_LIVE_WORD.LIVE;
}

/**
 * A call's status where a message box steers it. While the call is up it
 * is a live mark and "On call", or while the microphone is muted the
 * struck microphone and "Muted" in the quiet ink, since muting is no
 * failure and red is for danger alone, and how long the call has run,
 * counted each second. While it comes up or goes down it is the quiet
 * mark and "Connecting…" or "Ending…", with no count, since no call runs
 * yet or any more. Given a `now` the count stands still at it.
 */
export function CallLive(props: CallLiveProps): React.JSX.Element {
  return (
    <span
      className={LIVE}
      data-stage={props.stage}
      data-muted={String(props.stage === CALL_STAGE.LIVE && props.muted)}
    >
      <CallLiveMark props={props} />
      <span className={liveWordClass(props)}>{callLiveWord(props)}</span>
      {props.stage === CALL_STAGE.LIVE ? (
        <Time
          at={props.startedAt}
          look={TIME_LOOK.DURATION}
          now={props.now}
          className="ui-call-live-time"
        />
      ) : null}
    </span>
  );
}

/**
 * The call's place in an agent's composer row, beside Send, while a call
 * into the agent stands: its status, then the speaker and the microphone,
 * square, each struck through and lit while muted, and End call apart from
 * them on its red disc, so muting never hangs up.
 */
export function CallComposerControls({
  live,
  microphone,
  speaker,
  onEnd,
}: {
  live: CallLiveProps;
  microphone: CallMuteState;
  speaker: CallMuteState;
  onEnd: () => void;
}): React.JSX.Element {
  return (
    <fieldset
      className="ui-call-composer-controls m-0 flex min-w-0 flex-none items-center gap-tight-gap border-0 p-0"
      aria-label={CALL_CONTROLS_LABEL}
    >
      <CallLive {...live} />
      <CallMute
        device={CALL_DEVICE.SPEAKER}
        corners={BUTTON_CORNERS.SQUARE}
        muted={speaker.muted}
        onPress={speaker.onPress}
      />
      <CallMute
        device={CALL_DEVICE.MICROPHONE}
        corners={BUTTON_CORNERS.SQUARE}
        muted={microphone.muted}
        onPress={microphone.onPress}
      />
      <EndCallButton onPress={onEnd} />
    </fieldset>
  );
}

/**
 * The call bar's own row, laid out as a composer's controls are: the call's
 * two lines at its left and its controls at its right. Its least height
 * holds both lines, so it never moves as the agent's line comes and goes,
 * but where it is too narrow for the call on one row. It answers its own
 * width, as the sidebar's card, the floating card, and the floating window
 * draw it, each at a width of its own.
 */
const BAR =
  "ui-call-bar @container/ui-call-bar mx-auto my-0 flex min-h-call-row max-w-page-measure flex-wrap items-center gap-x-block-gap gap-y-control-gap";

/**
 * The call's two lines, each cut short on one line, so a long command never
 * wraps the row or pushes the controls, and the mark is never cut. Too
 * narrow for the status beside the controls (the sidebar's card at its
 * narrowest, an off-scale 210px), the status takes a row of its own, the
 * voice's word whole, and the controls stand under it at the right.
 */
const STATUS =
  "ui-call-bar-status flex min-w-0 flex-1 flex-col gap-ui-2 whitespace-nowrap @max-[210px]/ui-call-bar:basis-full";

/**
 * The agent's line, in the caption's muted voice. Narrower than an
 * off-scale 280px, a call card's controls at its head's step, the working
 * mark goes, the line's own words saying the agent works, so its command
 * keeps the mark's room.
 */
const AGENT =
  "ui-call-bar-agent flex min-w-0 items-center gap-control-gap text-caption text-muted-foreground";

const AGENT_MARK = "ui-call-bar-agent-mark flex @max-[280px]/ui-call-bar:hidden";
const AGENT_ACTION = "ui-call-bar-agent-action font-mono";

/**
 * End call stands apart from the two mutes, so muting never hangs up; at a
 * call card's narrowest the controls close up to a card head's own step, so
 * its mutes and End call stand under its way back.
 */
const CONTROLS =
  "ui-call-bar-controls ml-auto flex flex-none items-center gap-control-gap @max-[280px]/ui-call-bar:gap-tight-gap";

const MUTES = "ui-call-bar-mutes flex flex-none items-center gap-tight-gap";

/**
 * The call's two lines: the voice's word, and the agent's while it works:
 * "Thinking", or "Working" and the command it runs. Where `titled`, the
 * command carries its whole words as the system's own hint, for the floating
 * window, which is too small to hold a tooltip.
 */
function CallStatusLines({
  status,
  muted,
  titled,
}: {
  status: CallStatus | undefined;
  muted: boolean;
  titled: boolean;
}): React.JSX.Element {
  const agent = status?.agent;

  return (
    <span className={STATUS}>
      <Text
        as={TEXT_ELEMENT.SPAN}
        variant={TEXT_VARIANT.INHERIT}
        truncate
        className="ui-call-bar-voice data-[muted=true]:text-muted-foreground"
        data-muted={String(muted)}
      >
        {status?.voiceWord}
      </Text>
      {agent === undefined ? null : (
        <span className={AGENT}>
          <span className={AGENT_MARK}>
            <WorkingMark />
          </span>
          <Text
            as={TEXT_ELEMENT.SPAN}
            variant={TEXT_VARIANT.INHERIT}
            truncate
            title={titled ? agent.action : undefined}
          >
            {agent.action === undefined ? (
              AGENT_THINKING
            ) : (
              <>
                {AGENT_WORKING} · <span className={AGENT_ACTION}>{agent.action}</span>
              </>
            )}
          </Text>
          <VisuallyHidden role="status">{AGENT_WORKING_LABEL}</VisuallyHidden>
        </span>
      )}
    </span>
  );
}

/**
 * The strip of a call's controls, laid out the way a composer's own are:
 * the call's status at the left, and at the right the speaker and
 * microphone mutes, round, each struck through and lit while on, and End
 * call beside them, apart from both so muting never hangs up. A narrow bar
 * stacks its status over its controls rather than cutting the voice's word
 * (`STATUS`).
 */
export function CallBar({
  status,
  microphone,
  speaker,
  onEnd,
  titled = false,
}: {
  /** The call's status, absent while the voice names none, which draws the controls alone. */
  status: CallStatus | undefined;
  microphone: CallMuteState;
  speaker: CallMuteState;
  onEnd: () => void;
  /** Whether the agent's command carries its whole words as the system's hint, where no tooltip fits. */
  titled?: boolean | undefined;
}): React.JSX.Element {
  return (
    <footer className={BAR}>
      <CallStatusLines status={status} muted={microphone.muted} titled={titled} />
      <div className={CONTROLS}>
        <div className={MUTES}>
          <CallMute device={CALL_DEVICE.SPEAKER} muted={speaker.muted} onPress={speaker.onPress} />
          <CallMute
            device={CALL_DEVICE.MICROPHONE}
            muted={microphone.muted}
            onPress={microphone.onPress}
          />
        </div>
        <EndCallButton onPress={onEnd} />
      </div>
    </footer>
  );
}
