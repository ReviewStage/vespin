import { SERVER_HANDED } from "@repo/features/agent-servers-model";
import { AGENT_STATUS, type AgentSummary } from "@repo/features/agent-wire";
import { INBOX_BOUNDS, type InboxField } from "@repo/features/inbox-wire";
import type { FieldControl } from "@repo/ui";
import { useEffect } from "react";
import { useIntegrationStatuses } from "../integration-statuses.js";
import { PANEL_SPAN } from "../panel-spans.js";
import { MessageField, useMessageBox } from "./message-box.js";
import type { SkillSource } from "./skill-picker.js";

/**
 * inbox-form-text.tsx -- a text field of an Inbox form, written in the composer's own field, as the item's box is.
 *
 * The field is the message box's (`message-box.tsx`), alone in a frame
 * sized as a text field: an `@` opens what the
 * words may mention, written in as its link and drawn as its chip, and a
 * `/` opens the repository's skills; it is drawn at a field's size under
 * the field's name rather than as a card. What it holds is the field's
 * value, links and all, so a mention reaches the agent as a note's does.
 * Enter sends the item's answer, or takes the keyboard to what it lacks,
 * as Enter anywhere in the item does, Shift+Enter is a new line, and
 * Escape leaves the field, in a form of several fields as in one. A press on the field's name takes the caret
 * into it, as a label's press does for an input. Like the box, it never takes the caret as the
 * item opens, because K and J step the list.
 */

/** What a form's own text field is handed: the field, the ids its name is read by, and what it holds. */
export interface FormTextProps {
  readonly field: InboxField;
  readonly control: FieldControl;
  readonly value: string;
  readonly disabled: boolean;
  /** Hands the field's words back, nothing for an empty field. */
  readonly onChange: (typed: string | undefined) => void;
}

/** What every text field of an item's form is written with: whom the words go to, what they may name, and the item's send. */
export interface FormTextDoors {
  /** The item's agent, which the `@` list does not offer; none where the words go to no agent. */
  readonly self: string | undefined;
  /** The item's agent as its holder's read lists it, whose servers' switches a server's chip reads. */
  readonly agent: AgentSummary | undefined;
  /** Where the item's repository's skills are read from; nothing where none can be. */
  readonly skills: SkillSource | undefined;
  /** The words a dictation is likely to say (`dictation-keywords.ts`). */
  readonly keywords: readonly string[];
  /** Sends the item's answer, or takes the keyboard to what it lacks. */
  readonly onEnter: () => void;
}

/** One text field of a form as the composer's field, sized as a field. */
export function InboxFormText({
  field,
  control,
  value,
  disabled,
  onChange,
  doors,
}: FormTextProps & { doors: FormTextDoors }): React.JSX.Element {
  const statuses = useIntegrationStatuses();
  const { agent } = doors;
  const { labelId } = control;

  const box = useMessageBox({
    draft: value,
    setDraft: (typed) => onChange(typed === "" ? undefined : typed),
    placeholder: "",
    label: field.label,
    maxLength: INBOX_BOUNDS.MAX_FIELD_VALUE_CHARS,
    onSubmit: doors.onEnter,
    held: disabled,
    takesFiles: false,
    takesFocus: false,
    self: doors.self,
    skills: doors.skills,
    keywords: doors.keywords,
    // A server's chip says what the answer does with it, as the box's does.
    servers: {
      statuses,
      place: {
        disabled: agent?.disabledServers ?? [],
        handed: agent?.status === AGENT_STATUS.RUNNING ? SERVER_HANDED.STEERS : SERVER_HANDED.OPENS,
      },
    },
    aria: {
      "aria-labelledby": labelId,
      "aria-describedby": control["aria-describedby"],
      "aria-required": control["aria-required"] === true ? "true" : undefined,
    },
    keystrokeSpan: PANEL_SPAN.KEYSTROKE_INBOX_ANSWER,
  });

  // Note that a press on the field's name takes the caret into its words, as a label does for its input, since an editor is no labelable element.
  const { editor } = box;
  useEffect(() => {
    const name = document.getElementById(labelId);

    if (name === null) return;
    const focus = () => editor.current?.focus();
    name.addEventListener("click", focus);

    return () => name.removeEventListener("click", focus);
  }, [labelId, editor]);

  return (
    <MessageField
      box={box}
      className="inbox-field-composer"
      data-disabled={disabled ? "" : undefined}
    />
  );
}
