import { useRef, useState } from "react";
import { GLYPH } from "../../icons/glyph-registry.js";
import { BUTTON_VARIANT, Button } from "../button/button.js";
import { CHOICE_LOOK, ChoiceList } from "../choice-list/choice-list.js";
import { CODE_CARD_TITLE, CodeCard } from "../code-card/code-card.js";
import { DIALOG_ROLE, DIALOG_SIZE, Dialog } from "../dialog/dialog.js";
import { FILE_TEXT_EXTENT, FileText } from "../file-text/file-text.js";

/**
 * command-ask.tsx -- a command an agent asks to run on this Mac, put to the developer as a modal over the window: the command in its Shell card, how often to allow it, then Deny and Run.
 *
 * The window asks the way a permission prompt does: it dims, a card asks
 * its question over the exact command, mono and whole in the Shell card a
 * transcript draws a call in, wrapping rather than running sideways and
 * scrolling past a few lines so a long one never fills the card or hides
 * past its edge. Under it, a choice of how often: Always allow, picked and
 * marked Recommended, which sets This Mac's setting to Always allow so
 * later commands run without asking, or Just this once. Run answers with
 * the choice, so trusting the Mac is one press, and Deny sits before it.
 * The subtitle, not the command, is the card's description, since a
 * payload of thousands of characters would be read out before the answers;
 * the command stands as its own named region instead.
 * Focus lands on Deny, so a key already pressed runs nothing; Escape and a
 * press on the dimmed window deny too, since a prompt waved away must not
 * run the command.
 * Whoever owns the card holds it mounted while the ask stands and passes
 * `open` as the ask goes, answered or timed out, so the card fades out
 * (`Dialog`'s `open`), taking it down once it says it is gone.
 */

/** What the card is titled. */
const TITLE = "Run on this Mac?";

/** What the card says is asking. */
const SUBTITLE = "An agent wants to run a command.";

/** The label a reader is given for the command's region. */
const COMMAND_LABEL = "The command";

/** How often Run lets a command through: this one and every later one, or this one alone. */
const ALLOW_SCOPE = {
  ALWAYS: "always",
  ONCE: "once",
} as const;

type AllowScope = (typeof ALLOW_SCOPE)[keyof typeof ALLOW_SCOPE];

/** The choice of how often, Always allow first and recommended. */
const SCOPE_OPTIONS = [
  {
    value: ALLOW_SCOPE.ALWAYS,
    label: "Always allow",
    detail: "Agents run commands on this Mac without asking",
    badge: "Recommended",
  },
  { value: ALLOW_SCOPE.ONCE, label: "Just this once" },
] as const;

export function CommandAsk({
  open,
  command,
  onAllowOnce,
  onAllowAlways,
  onDeny,
  onExited,
  copy,
}: {
  /** Whether the ask stands; falling, the card fades out before it goes. */
  open: boolean;
  /** The shell command, as the agent wrote it. */
  command: string;
  /** Run it this once: Run, with Just this once picked. */
  onAllowOnce: () => void;
  /** Run it, and every later command without asking: Run, with Always allow picked. */
  onAllowAlways: () => void;
  /** Do not run it, which Escape and the dimmed window also answer. */
  onDeny: () => void;
  /** Its fade has run and the card is gone, which its owner takes the ask down on. */
  onExited?: (() => void) | undefined;
  /** The caller's platform act that puts words on the clipboard, for the Shell card's Copy. */
  copy: (text: string) => Promise<void>;
}): React.JSX.Element {
  const deny = useRef<HTMLButtonElement | null>(null);
  const [scope, setScope] = useState<readonly AllowScope[]>([ALLOW_SCOPE.ALWAYS]);
  // Note that a pick taken back leaves no scope, which runs once rather than widening.
  const run = scope[0] === ALLOW_SCOPE.ALWAYS ? onAllowAlways : onAllowOnce;

  return (
    <Dialog
      open={open}
      role={DIALOG_ROLE.ALERT_DIALOG}
      size={DIALOG_SIZE.WIDE}
      title={TITLE}
      subtitle={SUBTITLE}
      initialFocus={deny}
      onDismiss={onDeny}
      onExited={onExited}
      actions={
        <>
          <Button ref={deny} variant={BUTTON_VARIANT.QUIET} onClick={onDeny}>
            Deny
          </Button>
          <Button variant={BUTTON_VARIANT.PRIMARY} onClick={run}>
            Run
          </Button>
        </>
      }
    >
      <CodeCard
        glyph={<GLYPH.TERMINAL />}
        title="Shell"
        titleIs={CODE_CARD_TITLE.WORDS}
        body={<FileText text={command} label={COMMAND_LABEL} extent={FILE_TEXT_EXTENT.BRIEF} />}
        copied={command}
        copy={copy}
      />
      <ChoiceList
        legend="How often to allow"
        look={CHOICE_LOOK.MARKED}
        options={SCOPE_OPTIONS}
        value={scope}
        onChange={setScope}
      />
    </Dialog>
  );
}
