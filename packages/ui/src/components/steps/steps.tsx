import { type ReactNode, type Ref, useState } from "react";
import { CheckIcon } from "../../icons/lucide-glyphs.js";
import type { ShownError } from "../../reported-failure.js";
import { SecretField } from "../secret-field/secret-field.js";
import { TEXT_VARIANT, Text } from "../text/text.js";
import { VisuallyHidden } from "../visually-hidden/visually-hidden.js";
import { WaitingLine } from "../waiting-line/waiting-line.js";

/**
 * steps.tsx -- a short setup told as numbered steps that check off as each is done: run this, then paste what it printed.
 *
 * A setup a person carries out partly elsewhere, in a terminal or on a
 * provider's page, reads as an ordered list: each step a number in a small
 * disc, its words beside it, and what it needs (a command to copy, a link,
 * a field) under them. The step to do now (`STEP_STATE.CURRENT`) draws its
 * disc in the accent's ink; one done (`STEP_STATE.DONE`) turns its number to
 * the check on the complete fill, and a reader hears it said done; one still
 * to come (`STEP_STATE.TO_DO`) stands muted. No step is ever locked, so a
 * person who already holds what a step makes goes straight to the next. It
 * is a list rather than a control: what presses there are inside a step are
 * its caller's. It is drawn in the Tailwind theme's utilities.
 *
 * Two setups are drawn whole here, so every page that asks for one draws it
 * alike. `OutsideSteps` is what a person does outside the app (run a
 * command, open a page, enter a code) and, under the steps, the wait for the
 * app to see it happen (`WaitingLine`): a host joining, an agent connecting,
 * a sign-in landing. `PasteSteps` is a secret got elsewhere and pasted here,
 * an API key's or a token's: getting it, which checks off once its command
 * is copied or its page opened, then the field (`SecretField`), which a paste
 * saves as it lands and Enter, the steps being a form, saves as typed.
 */

/** Where a step stands: still to come, the one to do now, or done. */
export const STEP_STATE = {
  TO_DO: "to_do",
  CURRENT: "current",
  DONE: "done",
} as const;

export type StepState = (typeof STEP_STATE)[keyof typeof STEP_STATE];

/** What a step's disc is drawn in, for each state. */
const DISC = {
  [STEP_STATE.TO_DO]: "border border-border-strong text-muted-foreground",
  [STEP_STATE.CURRENT]: "border border-accent-ink text-accent-ink",
  [STEP_STATE.DONE]: "bg-complete text-primary-foreground [&_svg]:text-primary-foreground",
} as const satisfies Record<StepState, string>;

/** What a reader hears after a step done. */
const DONE = "Done";

/** Steps, one under another, in the order they are done. */
export function Steps({ children }: { children: ReactNode }): React.JSX.Element {
  return <ol className="m-0 flex list-none flex-col gap-field-gap p-0">{children}</ol>;
}

/** Step `number`: its disc, what to do, and what it needs under that. */
export function Step({
  number,
  title,
  state,
  children,
}: {
  /** Its place in the order, from 1. */
  number: number;
  /** What to do, as a short sentence: "Run this in a terminal"; none where what the step needs names it, a field by its label. */
  title?: ReactNode;
  state: StepState;
  /** What the step needs: a command to copy, a link, a field. */
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-ui-12" data-state={state}>
      <span
        className={`inline-grid size-ui-20 flex-none place-items-center rounded-full text-caption tabular-nums [&_svg]:size-ui-12 ${DISC[state]}`}
        aria-hidden="true"
      >
        {state === STEP_STATE.DONE ? <CheckIcon /> : number}
      </span>
      <div className="flex min-w-0 flex-col gap-ui-8">
        {title === undefined ? null : (
          <Text variant={TEXT_VARIANT.LABEL}>
            {title}
            {state === STEP_STATE.DONE ? <VisuallyHidden>{` (${DONE})`}</VisuallyHidden> : null}
          </Text>
        )}
        {children}
      </div>
    </li>
  );
}

/**
 * Steps a person carries out outside the app, and, while the app waits to
 * see the last of them happen, what it waits on under them.
 */
export function OutsideSteps({
  waiting,
  children,
}: {
  /** What the app waits on, "Waiting for a host to join"; none where it waits on nothing. */
  waiting?: string | undefined;
  /** The steps, each a `Step`. */
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-ui-8">
      <Steps>{children}</Steps>
      {waiting === undefined ? null : <WaitingLine>{waiting}</WaitingLine>}
    </div>
  );
}

/** A pasted secret's first step: what to do to get it, and what it needs, told once it is done. */
export interface PasteFirstStep {
  readonly title: ReactNode;
  readonly body: (done: () => void) => ReactNode;
}

/**
 * A secret got elsewhere and pasted here: its first step, then the field,
 * current once the first is done. The field's words and what it says are the
 * caller's, which holds the paste and saves it.
 */
export function PasteSteps({
  first,
  fieldRef,
  label,
  placeholder,
  saved = false,
  busy = false,
  busyWords,
  error,
  value,
  onChange,
  onSave,
  onEscape,
}: {
  first: PasteFirstStep;
  /** The way to the field, for a surface that hands it focus. */
  fieldRef?: Ref<HTMLInputElement> | undefined;
  /** What the field is called, which says what to paste. */
  label: string;
  placeholder: string;
  /** Whether a secret is already held, which the empty field says in its place. */
  saved?: boolean | undefined;
  /** Whether a save is out, which stills the field. */
  busy?: boolean | undefined;
  /** What the field says while a save is out: "Checking the key". */
  busyWords?: string | undefined;
  /** Why the last save kept nothing, and the failure beneath. */
  error?: ShownError | undefined;
  value: string;
  onChange: (value: string) => void;
  /** Saves `value`: what a paste left in the field as it lands, or what was typed on Enter. */
  onSave: (value: string) => void;
  onEscape?: (() => void) | undefined;
}): React.JSX.Element {
  const [firstDone, setFirstDone] = useState(false);
  return (
    <form
      className="m-0 flex min-w-0 flex-col"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSave(value);
      }}
    >
      <Steps>
        <Step
          number={1}
          title={first.title}
          state={firstDone ? STEP_STATE.DONE : STEP_STATE.CURRENT}
        >
          {first.body(() => setFirstDone(true))}
        </Step>
        <Step number={2} state={firstDone ? STEP_STATE.CURRENT : STEP_STATE.TO_DO}>
          <SecretField
            ref={fieldRef}
            label={label}
            description={busy ? busyWords : undefined}
            error={error}
            saved={saved}
            placeholder={placeholder}
            disabled={busy}
            value={value}
            onChange={onChange}
            onPasted={onSave}
            onEscape={onEscape}
          />
        </Step>
      </Steps>
    </form>
  );
}
