import { GLYPH_STATE } from "@repo/features/glyph-state";
import {
  BLOCK_TITLE,
  COMMAND_PROMPT,
  NO_OUTPUT,
  readableBlock,
  shownOutput,
  TOOL_BLOCK,
  TOOL_STATE,
  type ToolBlock,
  type ToolState,
} from "@repo/features/tool-call-block";
import {
  Badge,
  CARD_CORNER,
  CARD_LOOK,
  CARD_PADDING,
  Card,
  CODE_CARD_TITLE,
  CODE_ROW,
  CodeCard,
  type CodeRow,
  cn,
  DISCLOSURE_BODY,
  DisclosureBody,
  FAILURE_NOTE_TIME,
  FailureNote,
  GlyphSlot,
  LineSummary,
  NOTE_LINE_LOOK,
  NoteLine,
  OneLine,
  Tooltip,
  useDisclosurePreviewShown,
  useDisclosureState,
} from "@repo/ui";
import { UNREPORTED } from "@repo/ui/reported-failure";
import type { ReactNode } from "react";
import { copyThroughShell } from "../copy-feedback.js";
import { FIND_DETAIL, FindDetailFolds } from "../find-in-tab.js";
import { StateGlyph, stateEndMark } from "../state-glyph.js";
import { Fold, type FoldProps } from "./fold.js";

/**
 * tool.tsx -- AI Elements' Tool: one tool call as a compact row, with its input and its answer under it once opened.
 *
 * After the AI Elements registry (https://elements.ai-sdk.dev), restyled
 * to our tokens and folded on `fold.tsx`. The row is one line, and
 * the whole of it opens the call: the tool's icon, what the call did in
 * a few words, and where it stands, trailing the words so that only their
 * cut moves when the mark goes: the working mark while it runs and the
 * failed mark if it failed, each as an agent's tab draws it
 * (`state-glyph.tsx`); a call that ended well keeps no seat for one. A
 * call that says where it stands in words (`status`), as one held for an
 * answer says it waits and then how it was answered, says them muted at
 * the line's end, the working mark giving way to them while it is held. A
 * subject the body says whole, as a command's input is the command and a
 * read's its path, is the closed row's preview, and the open row says its
 * verb alone (`blockSays`), even while a find draws the body hidden. The
 * verb is in the full ink and the icon and the subject in the muted one,
 * so a reader scans what each call did and the subject reads as its
 * preview, fading where the line cuts it rather than ending on an
 * ellipsis. There is no chevron: the icon leads, a hover fill says the
 * line opens, and its hint says what a press does, as a line that opens a
 * tab says what it opens. The body under
 * it, set in under the words, is the call's input and its answer, each a
 * `CodeCard` headed "Input" and "Output" with the window's one Copy and its
 * one cut at 40 lines, so a long answer shows its first lines over "Show
 * all", and Copy copies the whole of it either way; a command is one
 * "Terminal" card instead, its prompt line over what it printed, as a shell
 * shows them. A Markdown block, as a memory's words, is no card but the
 * words drawn as the agent's reply is, by the drawing its caller hands
 * (`TranscriptWords`, so its links, chips, and pictures keep the reply's
 * rules), at the transcript's body size so its code spans match its prose. JSON reads as
 * words (`readableBlock`), an answer that only
 * acknowledges is left out, and an empty one says "No output". What the
 * words say is the caller's decision (`tasks/tool-call-model.ts`); how a
 * block of each kind is drawn is this file's. Its look is `.tool`'s
 * (tasks.css).
 */

/** What a patch's line does, by its first characters: a line added, one removed, or one that stands. */
function patchRow(line: string): CodeRow {
  if (line.startsWith("+")) return CODE_ROW.ADDED;

  if (line.startsWith("-")) return CODE_ROW.REMOVED;

  return CODE_ROW.CONTEXT;
}

/** What the hover over a call's folding line says a press does, by whether the fold stands open. */
const FOLD_HINT = {
  SHOW: "Show the call",
  HIDE: "Hide the call",
} as const;

/**
 * The call's label, in the full ink over the line's muted one, cut to the
 * line. Note that a chip after it gives way first (`shrink-0`), since a name
 * cut at its end still reads.
 */
const TOOL_LABEL_CLASS = "tool-label min-w-0 overflow-hidden whitespace-nowrap text-foreground";

/**
 * The body under an open line, set in past its icon to the line's words,
 * where a call's body, a model's reasoning, and a call's pictures stand
 * (`--transcript-gutter`, tasks.css): `@repo/ui`'s tinted card holding what a
 * call sent, a hairline between its blocks, or cards of their own one over
 * the next with no frame around them.
 */
const TOOL_BODY_CLASS = "tool-body my-tight-gap mr-0 ml-transcript-gutter";

export type ToolProps = Omit<FoldProps, "className">;

/** One call, folded under its line: a detail of the transcript, which a find may leave out (`FIND_DETAIL`). */
export function Tool({ children, ...props }: ToolProps): ReactNode {
  return (
    <FindDetailFolds>
      <Fold className="tool text-caption-inline" {...FIND_DETAIL} {...props}>
        {children}
      </Fold>
    </FindDetailFolds>
  );
}

/**
 * Where the call stands: the working mark while it runs, in the line's
 * muted ink, or the failed mark if it failed, each the one an agent's tab
 * wears and named as it is. A call that ended well draws nothing, no empty
 * seat and no gap beside it, since that is every call's end and a mark on
 * each says nothing. Note that the failed mark gives no hint of its own,
 * because a subagent's row already hangs one over the whole line.
 */
export function ToolStateMark({ state }: { state: ToolState }): ReactNode {
  if (state === TOOL_STATE.OUTPUT_AVAILABLE) return null;

  if (state === TOOL_STATE.OUTPUT_ERROR) return stateEndMark(GLYPH_STATE.FAILED, false);

  return <StateGlyph state={GLYPH_STATE.WORKING} />;
}

export interface ToolHeaderProps {
  state: ToolState;
  /** The tool's icon, drawn at 16px. */
  icon: ReactNode;
  /** What the call did, in the full ink: its verb, or what a described command is for; none for a line that is its subject alone. */
  label: string | undefined;
  /** What the call was done to, in the muted ink after the label; none for a call that has no one input a reader looks for first. */
  subject: string | undefined;
  /** Who the call was about, as a chip after the label and before the subject, as a call about one coding agent names the agent; none for the rest. */
  chip?: ReactNode | undefined;
  /** Whether the subject is code (a command, a path), set in mono, rather than words. */
  subjectIsCode?: boolean;
  /** Whether the body says the subject whole, as a command's or a read's does (`blockSays`), so an open row drops it. */
  subjectInBody?: boolean;
  /** Where the call ran, as a quiet tag at the line's end, for a call that ran somewhere other than its tab says ("On your Mac", or whose Mac by their disc and name); none for the rest. */
  place?: ReactNode | undefined;
  /** Where the call stands in a word or two of the muted ink at the line's end, as a held call's "Waiting for approval" and its answer's "Allowed"; none for the rest. */
  status?: string | undefined;
  /** Whether the call is held, not working, so the working mark gives way to its status. */
  paused?: boolean | undefined;
}

/**
 * What a call's line says: its icon, what it did, who it was about where it
 * names someone by their chip, and where it stands. Note that the chip
 * gives way before the label does, since a name cut at its end still reads,
 * and that the subject after it takes only what is left. A failure's mark
 * stands right after the label, by what failed, rather than at the line's
 * far end, where a reader scanning the verbs would miss it; the working
 * mark keeps the end, where it moves nothing as the call settles.
 */
export function ToolLine({
  state,
  icon,
  label,
  subject,
  chip,
  subjectIsCode = true,
  place,
  status,
  paused = false,
}: Pick<
  ToolHeaderProps,
  "state" | "icon" | "label" | "subject" | "chip" | "subjectIsCode" | "place" | "status" | "paused"
>): ReactNode {
  const trailing = subject !== undefined || chip !== undefined;
  const failed = state === TOOL_STATE.OUTPUT_ERROR;

  return (
    <>
      <GlyphSlot>{icon}</GlyphSlot>
      {/* Note that the label keeps its space, so the line still reads as one sentence to find, copy, and a screen reader, though the flex gap sets it. */}
      <span className="flex min-w-0 flex-1 items-baseline gap-tight-gap">
        {label === undefined ? null : (
          <OneLine
            className={chip === undefined ? TOOL_LABEL_CLASS : `${TOOL_LABEL_CLASS} shrink-0`}
          >
            {/* Note that a verb drops its colon where nothing follows it, as an open row's whose body says its subject. */}
            {trailing ? `${label} ` : label.replace(/:$/u, "")}
          </OneLine>
        )}
        {failed ? (
          <span className="flex flex-none self-center">
            <ToolStateMark state={state} />
          </span>
        ) : null}
        {chip === undefined ? null : (
          <span className="tool-chip flex min-w-0 max-w-tool-chip flex-initial whitespace-nowrap">
            {chip}
            {subject === undefined ? null : " "}
          </span>
        )}
        {subject === undefined ? null : (
          <span
            className="tool-subject min-w-0 flex-1 overflow-hidden whitespace-nowrap data-code:font-mono data-code:text-caption-inline"
            data-code={subjectIsCode ? "" : undefined}
          >
            {subject}
          </span>
        )}
      </span>
      {place === undefined ? null : (
        <span className="tool-place flex flex-none">
          {" "}
          <Badge>{place}</Badge>
        </span>
      )}
      {status === undefined ? null : (
        <span className="tool-status flex-none whitespace-nowrap text-muted-foreground">
          {" "}
          {status}
        </span>
      )}
      {failed || paused ? null : <ToolStateMark state={state} />}
    </>
  );
}

/**
 * A call's folding line, which opens and closes its fold, hanging the hint
 * that says so, as a line that opens a tab hangs what it opens; the caller
 * draws what stands in it, and finds it by the marks it hands.
 */
export function ToolSummary({
  children,
  ...marks
}: {
  children: ReactNode;
  [mark: `data-${string}`]: string | undefined;
}): ReactNode {
  const { open } = useDisclosureState();

  return (
    <Tooltip label={open ? FOLD_HINT.HIDE : FOLD_HINT.SHOW}>
      <LineSummary {...marks}>{children}</LineSummary>
    </Tooltip>
  );
}

/** The one line a call shows: what it did, and where it stands. */
export function ToolHeader({
  state,
  icon,
  label,
  subject,
  chip,
  subjectIsCode = true,
  subjectInBody = false,
  place,
  status,
  paused,
}: ToolHeaderProps): ReactNode {
  const previewed = useDisclosurePreviewShown(subjectInBody);

  return (
    <ToolSummary>
      <ToolLine
        state={state}
        icon={icon}
        label={label}
        subject={previewed ? subject : undefined}
        chip={chip}
        subjectIsCode={subjectIsCode}
        place={place}
        status={status}
        paused={paused}
      />
    </ToolSummary>
  );
}

/** The body under an open row: a card holding the blocks, a hairline between them, clipped to its corners, so what is in it rings inside itself. */
export function ToolContent({
  name,
  bare = false,
  children,
}: {
  /** The class its place names what it holds by, beside the body's own. */
  name?: string | undefined;
  /** Whether what it holds are cards of their own (`CodeCard`), which stand one over the next with no frame around them. */
  bare?: boolean;
  children: ReactNode;
}): ReactNode {
  if (bare) {
    return (
      <DisclosureBody inset={DISCLOSURE_BODY.NONE}>
        <div className={cn(TOOL_BODY_CLASS, "flex flex-col gap-tight-gap", name)} data-bare="">
          {children}
        </div>
      </DisclosureBody>
    );
  }

  return (
    <DisclosureBody inset={DISCLOSURE_BODY.NONE}>
      <Card
        look={CARD_LOOK.TINT}
        corner={CARD_CORNER.CONTROL}
        padding={CARD_PADDING.FLUSH}
        className={cn(TOOL_BODY_CLASS, "[&>*+*]:border-t [&>*+*]:border-border", name)}
      >
        {children}
      </Card>
    </DisclosureBody>
  );
}

/** How a Markdown block's words are drawn: as the transcript draws a reply's, which the caller hands, so this file keeps no Markdown rules of its own. */
export type ToolMarkdown = (text: string) => ReactNode;

/** A block as the card draws it: what its lines are, what Copy copies, and what each line does where it is a patch; Markdown as a reply's words instead, with no card. */
function BlockCard({
  block,
  title,
  data,
  markdown,
}: {
  block: ToolBlock;
  title: string;
  data: `data-${string}`;
  markdown: ToolMarkdown;
}): ReactNode {
  if (block.kind === TOOL_BLOCK.MARKDOWN) {
    return (
      <div className="tool-markdown min-w-0 text-body" {...{ [data]: "" }}>
        {markdown(block.text)}
      </div>
    );
  }

  const isCommand = block.kind === TOOL_BLOCK.COMMAND;

  return (
    <CodeCard
      title={title}
      titleIs={CODE_CARD_TITLE.WORDS}
      // Note that the prompt is drawn but never copied: Copy takes the command alone.
      code={isCommand ? `${COMMAND_PROMPT}${block.text}` : block.text}
      copied={block.text === "" ? undefined : block.text}
      rows={block.kind === TOOL_BLOCK.PATCH ? block.text.split("\n").map(patchRow) : undefined}
      data={{ [data]: "" }}
      copy={copyThroughShell}
    />
  );
}

/** What the call was given, read as words; nothing where it was given nothing. */
export function ToolInput({
  block,
  markdown,
}: {
  block: ToolBlock;
  markdown: ToolMarkdown;
}): ReactNode {
  const readable = readableBlock(block);

  if (readable.text === "") return null;

  return (
    <BlockCard
      block={readable}
      title={BLOCK_TITLE.INPUT}
      data="data-tool-input"
      markdown={markdown}
    />
  );
}

export interface ToolOutputProps {
  /** Nothing while the call has not answered. */
  block: ToolBlock | undefined;
  errorText: string | undefined;
  markdown: ToolMarkdown;
}

/** The error a call ended in, under its body. */
function ToolFailure({ errorText }: { errorText: string }): ReactNode {
  return (
    <div data-tool-output="">
      <FailureNote failure={UNREPORTED.TOOL} time={FAILURE_NOTE_TIME.PAST}>
        {errorText}
      </FailureNote>
    </div>
  );
}

/**
 * What the call answered, read as words and cut at 40 lines by its card, or
 * the error it ended in, or a muted line where it answered nothing; nothing
 * while it has answered neither, or where it only acknowledged the call.
 */
export function ToolOutput({ block, errorText, markdown }: ToolOutputProps): ReactNode {
  if (errorText !== undefined) return <ToolFailure errorText={errorText} />;
  const readable = block === undefined ? undefined : shownOutput(block);

  if (readable === undefined) return null;

  if (readable.text.trim() === "") {
    return (
      <div data-tool-output="" data-empty="">
        <NoteLine look={NOTE_LINE_LOOK.INSET}>{NO_OUTPUT}</NoteLine>
      </div>
    );
  }

  return (
    <BlockCard
      block={readable}
      title={BLOCK_TITLE.OUTPUT}
      data="data-tool-output"
      markdown={markdown}
    />
  );
}

export interface ToolTerminalProps extends Omit<ToolOutputProps, "markdown"> {
  /** The command, a `TOOL_BLOCK.COMMAND` block. */
  input: ToolBlock;
}

/**
 * A command and what it printed as one card, as a shell shows them: the
 * prompt line, then its output, and the error it ended in under the card.
 * Note that Copy takes the command alone, without its prompt or output.
 */
export function ToolTerminal({ input, block, errorText }: ToolTerminalProps): ReactNode {
  const printed = block === undefined ? "" : readableBlock(block).text.trimEnd();
  const prompt = `${COMMAND_PROMPT}${input.text}`;

  return (
    <>
      <CodeCard
        title={BLOCK_TITLE.TERMINAL}
        titleIs={CODE_CARD_TITLE.WORDS}
        code={printed === "" ? prompt : `${prompt}\n${printed}`}
        copied={input.text === "" ? undefined : input.text}
        data={{ "data-tool-terminal": "" }}
        copy={copyThroughShell}
      />
      {errorText === undefined ? null : <ToolFailure errorText={errorText} />}
    </>
  );
}
