import { type ReactNode, useState } from "react";
import { ReplayUnmask } from "../../session-replay-marks.js";
import { BUTTON_SIZE, BUTTON_VARIANT, Button } from "../button/button.js";
import { Dialog } from "../dialog/dialog.js";
import { DIALOG_TONE, DialogActions } from "../dialog/dialog-actions.js";
import {
  HoverCard,
  HoverCardHead,
  HoverCardRule,
  HoverCardScroll,
} from "../hover-card/hover-card.js";
import { Tooltip } from "../tooltip/hint.js";

/**
 * reply-button.tsx -- a button an agent put in its reply, beside the line it is about, which starts a new agent on a brief it wrote or sends its words to a running agent once pressed.
 *
 * It stands inline in the reply's words, an outline button at a chip's
 * size led by what it does, the glyph its owner hands it: the agent's for a
 * start, the paper plane for a send. Under a pointer, resting on it hangs a card saying what a
 * press does and where (`where`: the repository, branch, and model a start
 * runs on, or the agent a send goes to) over the whole brief, scrolling past
 * the card's height, and a press runs it. Where the reader has no pointer to
 * rest (`confirmFirst`: a finger, or a phone's width), a press opens that
 * card in a dialog named by the label, with Cancel and the act's own button
 * at its foot, so the brief is read before anything starts. While its press runs it is busy
 * and takes no other. What it becomes once pressed, the chip of the agent it
 * reached, is its owner's to draw.
 */

/** What a press does: start a new agent, or send to one running. */
export const REPLY_BUTTON_KIND = {
  START: "start",
  SEND: "send",
} as const;

export type ReplyButtonKind = (typeof REPLY_BUTTON_KIND)[keyof typeof REPLY_BUTTON_KIND];

/** The card's head and the confirming act's words, by what a press does. */
const KIND_WORDS = {
  [REPLY_BUTTON_KIND.START]: { head: "Starts a new agent", act: "Start agent", busy: "Starting" },
  [REPLY_BUTTON_KIND.SEND]: { head: "Sends a message", act: "Send", busy: "Sending" },
} as const satisfies Record<ReplyButtonKind, { head: string; act: string; busy: string }>;

/** What a press does, where, and the brief whole, as the card and the popover both say it. */
function ReplyButtonCard({
  kind,
  glyph,
  where,
  brief,
}: {
  kind: ReplyButtonKind;
  glyph: ReactNode;
  where: string;
  brief: string;
}): React.JSX.Element {
  return (
    <HoverCard>
      <ReplayUnmask>
        <HoverCardHead glyph={glyph} name={KIND_WORDS[kind].head} sub={where} />
      </ReplayUnmask>
      <HoverCardRule />
      <HoverCardScroll>
        <p className="ui-reply-button-brief m-0 whitespace-pre-wrap">{brief}</p>
      </HoverCardScroll>
    </HoverCard>
  );
}

export function ReplyButton({
  label,
  kind,
  glyph,
  where,
  brief,
  pressing = false,
  confirmFirst = false,
  onPress,
}: {
  /** The button's words, as the agent labeled it. */
  label: string;
  kind: ReplyButtonKind;
  /** What the button and its card are led by: the agent's glyph for a start, the paper plane for a send. */
  glyph: ReactNode;
  /** Where a press runs, one line: a start's repository, branch, and model, or the agent a send goes to. */
  where: string;
  /** The brief a start hands its new agent, or the words a send sends, whole. */
  brief: string;
  /** Whether its press runs now, which it takes no other press during. */
  pressing?: boolean | undefined;
  /** Whether a press opens the brief with the act's own button under it rather than running at once: a reader with no pointer to rest on it. */
  confirmFirst?: boolean | undefined;
  onPress: () => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const button = (
    <Button
      size={BUTTON_SIZE.COMPACT}
      variant={BUTTON_VARIANT.OUTLINE}
      icon={glyph}
      busy={pressing}
      busyLabel={KIND_WORDS[kind].busy}
      aria-haspopup={confirmFirst ? "dialog" : undefined}
      onClick={() => (confirmFirst ? setOpen(!open) : onPress())}
    >
      {label}
    </Button>
  );
  if (!confirmFirst) {
    return (
      <Tooltip
        label={label}
        card={<ReplyButtonCard kind={kind} glyph={glyph} where={where} brief={brief} />}
      >
        {button}
      </Tooltip>
    );
  }
  return (
    <>
      {button}
      <Dialog
        open={open}
        title={label}
        onDismiss={() => setOpen(false)}
        actions={
          <DialogActions
            onCancel={() => setOpen(false)}
            act={{
              verb: KIND_WORDS[kind].act,
              tone: DIALOG_TONE.PRIMARY,
              running: KIND_WORDS[kind].busy,
              busy: pressing,
              onPress: () => {
                setOpen(false);
                onPress();
              },
            }}
          />
        }
      >
        <ReplyButtonCard kind={kind} glyph={glyph} where={where} brief={brief} />
      </Dialog>
    </>
  );
}
