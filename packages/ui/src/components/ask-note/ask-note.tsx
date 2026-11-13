import { useState } from "react";
import { DENY_NOTE_WORDS } from "../approval-actions/approval-actions.js";
import { TextField } from "../text-field/text-field.js";

/**
 * ask-note.tsx -- the words a developer may hand an agent with a Deny on an ask put to them as a modal (`CommandAsk`, `AppAsk`), so the agent knows what to do instead.
 *
 * One field under the ask, optional, in the words a held call's denial
 * uses (`DENY_NOTE_WORDS`). Deny sends what it holds, trimmed, or nothing
 * where it holds none, and says so in its press ("Deny with note"); Enter
 * in the field denies with the words, as a held call's field does. A Deny
 * by Escape or the dimmed window sends none, since nothing was meant by it.
 */

/** What Deny says once the field holds words. */
const DENY_WITH_NOTE = "Deny with note";

/** The note an ask's Deny sends, and the field it is typed in. */
export interface AskNote {
  /** The words to send with a Deny, trimmed; none where the field holds none. */
  readonly note: string | undefined;
  /** What Deny says: "Deny", or "Deny with note" once the field holds words. */
  readonly denyLabel: string;
  /** Sets the words, as the field types them. */
  readonly setWords: (words: string) => void;
  readonly words: string;
}

/** The note an ask's Deny sends, held while the ask stands. */
export function useAskNote(): AskNote {
  const [words, setWords] = useState("");
  const trimmed = words.trim();
  const note = trimmed === "" ? undefined : trimmed;

  return {
    note,
    denyLabel: note === undefined ? DENY_NOTE_WORDS.DENY : DENY_WITH_NOTE,
    setWords,
    words,
  };
}

/** The field the note is typed in, Enter denying with it. */
export function AskNoteField({
  note,
  maxLength,
  onDeny,
}: {
  note: AskNote;
  /** The most characters it takes. */
  maxLength: number;
  /** Denies with the words the field holds. */
  onDeny: () => void;
}): React.JSX.Element {
  return (
    <TextField
      label={DENY_NOTE_WORDS.LABEL}
      placeholder={DENY_NOTE_WORDS.PLACEHOLDER}
      value={note.words}
      onChange={note.setWords}
      maxLength={maxLength}
      onEnter={onDeny}
    />
  );
}
