import {
  type AgentOverviewPullRequest,
  CHECK_SUMMARY,
  MERGE_STATE,
  PULL_REQUEST_STATE,
  type PullRequestMerging,
  REVIEW_DECISION,
} from "@repo/features/agent-wire";
import {
  isLivePullRequest,
  isMergeWrite,
  MERGE_ACTION,
  MERGE_BUSY_WORDS,
  MERGE_METHOD_WORDS,
  MERGE_PRESS_WORDS,
  MERGE_WORDS,
  type MergeAction,
  type MergeWrite,
  mergeActionFor,
  mergeSentence,
  QUEUE_WARNING,
} from "@repo/features/pull-request-model";
import {
  MERGE_METHOD,
  type MergeMethod,
  PULL_REQUEST_ACTION,
} from "@repo/features/pull-request-write-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  BUTTON_VARIANT,
  Button,
  type ButtonVariant,
  ChipName,
  CONFIRM_LOSS,
  ConfirmDialog,
  type DialogQuestion,
  SPINNER_SIZE,
  SpinnerRing,
  SplitButton,
  STATUS_TONE,
  StaticChip,
  type StatusTone,
  Tooltip,
  useConfirmDialog,
  useMenu,
  VISUALLY_HIDDEN_UNDER,
  VisuallyHidden,
} from "@repo/ui";
import { Schema } from "effect";
import { CircleXIcon, GitMergeIcon, TriangleAlertIcon, UserRoundIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { ActionMenu, type MenuAction } from "../desktop/action-menu.js";
import { confirmFailure } from "../failure-report.js";
import { keptKey, useKept } from "../use-kept.js";
import type { PullRequestWrites } from "./pull-request-writes.js";

/**
 * merge-box.tsx -- the merge control at the end of an open pull request's title row, as stage-cli's merge status is: a chip saying what holds the merge up, and beside it the one press that may be made now.
 *
 * The chip is a status badge at the pill's size, in the tone of where the
 * merge stands, its glyph and its word: Checking, Conflicts, Behind,
 * Review required, Changes requested, Blocked, Ready. Its hint, and a
 * reader, have GitHub's fuller sentence ("A required review is missing").
 * It stands only where it says what nothing else on the page does: a pull
 * request ready to merge shows the press alone, a draft nothing, its pill
 * saying Draft, one in the merge queue only Remove from queue, its pill
 * saying Queued and its place, as stage-cli's does, one with auto-merge on
 * no chip of its own, Disable auto-merge saying it is on, and one held up by
 * its checks alone no chip, since the Checks tab under the
 * header says how they went in its glyph and its color. A narrow header draws the chip's glyph alone,
 * its word still read, but under a finger, a phone's, which has no hover to
 * raise its hint, the word stays drawn; a tap on the chip opens its sentence.
 *
 * The press is the one thing that may be done from where the pull request
 * stands (`mergeActionOf`), each a change the service makes on GitHub as
 * the member pressing it (`pull-request-writes.tsx`):
 *
 * - ready to merge, the method chosen as its words ("Squash and merge"), a
 *   split button whose chevron chooses among the methods the repository
 *   allows, merging at once, as stage-cli's does;
 * - on a base merged through a merge queue, Merge when ready, which turns
 *   auto-merge on with no method, so GitHub adds it to the queue once it is
 *   ready, as `gh pr merge --auto` does;
 * - with checks still running and auto-merge allowed, Enable auto-merge by
 *   the method chosen, its chevron choosing it too;
 * - with auto-merge on, Disable auto-merge;
 * - in the merge queue, Remove from queue, asked first, since leaving the
 *   queue may hold up the pull requests behind it.
 *
 * The method is kept per repository across launches, in this window's own
 * storage as the sidebar's folds are (`folded-groups.ts`); the first the
 * repository allows stands until one is chosen. A merge and auto-merge name
 * the head the overview read, so GitHub refuses either against a head
 * pushed since. While a change is out the press stands busy, and where
 * GitHub refuses it the tab's write note says why, in GitHub's words.
 */

const storedMethods = Schema.fromJsonString(
  Schema.Record(Schema.String, Schema.Literals(Object.values(MERGE_METHOD))),
);

/** Where the method chosen is kept, by repository. */
const KEPT = { METHODS: keptKey("app.pullRequestMergeMethods", storedMethods) } as const;

/** The method chosen for the repository, kept across launches: the one last chosen where the repository still allows it, else the first it allows. */
function useMergeMethod(
  repository: string | null,
  allowed: readonly MergeMethod[],
): readonly [MergeMethod | undefined, (method: MergeMethod) => void] {
  const [kept, , change] = useKept(KEPT.METHODS, {});
  const chosen = repository === null ? undefined : kept[repository];
  const method = chosen !== undefined && allowed.includes(chosen) ? chosen : allowed[0];
  const choose = (next: MergeMethod) => {
    if (repository === null) return;
    // Note that the record is read again before it is written, so another window's method for another repository is kept.
    change((held) => ({ ...held, [repository]: next }));
  };
  return [method, choose];
}

/** The chip's face: its word, its tone, and its glyph. */
interface ChipFace {
  readonly label: string;
  readonly tone: StatusTone;
  readonly icon: ReactNode;
}

/** Each chip's glyph, saying its state again beside its word. */
const CHIP_GLYPHS = {
  CHECKING: <SpinnerRing size={SPINNER_SIZE.INLINE} />,
  HELD: <CircleXIcon aria-hidden="true" />,
  BEHIND: <TriangleAlertIcon aria-hidden="true" />,
  REVIEW: <UserRoundIcon aria-hidden="true" />,
  READY: <GitMergeIcon aria-hidden="true" />,
} as const;

function chip(label: string, tone: StatusTone, icon: ReactNode): ChipFace {
  return { label, tone, icon };
}

/** What a merge GitHub says is blocked is held up by, as the chip says it; none where it waits on its checks, which the Checks tab says. */
function blockedChip(merging: PullRequestMerging | undefined): ChipFace | undefined {
  if (merging?.review === REVIEW_DECISION.CHANGES_REQUESTED) {
    return chip("Changes requested", STATUS_TONE.DANGER, CHIP_GLYPHS.HELD);
  }
  if (merging?.review === REVIEW_DECISION.REVIEW_REQUIRED) {
    return chip("Review required", STATUS_TONE.ATTENTION, CHIP_GLYPHS.REVIEW);
  }
  if (merging?.checks === CHECK_SUMMARY.FAILING || merging?.checks === CHECK_SUMMARY.PENDING) {
    return undefined;
  }
  return chip("Blocked", STATUS_TONE.DANGER, CHIP_GLYPHS.HELD);
}

/**
 * The chip for where the pull request stands and what the press offers, or
 * none where it would only say what the press, the pill, or the Checks tab
 * already does: a merge ready and offered, auto-merge on, a draft, one in the
 * merge queue, or one waiting on its checks. With auto-merge on, a chip
 * still says what holds the merge up.
 */
function chipOf(
  pullRequest: AgentOverviewPullRequest,
  action: MergeAction | undefined,
): ChipFace | undefined {
  const { merge, merging } = pullRequest;
  if ((merging?.queued ?? null) !== null) return undefined;
  if (pullRequest.state === PULL_REQUEST_STATE.DRAFT || merge === MERGE_STATE.DRAFT) {
    return undefined;
  }
  switch (merge) {
    case MERGE_STATE.UNKNOWN:
      return chip("Checking", STATUS_TONE.WORKING, CHIP_GLYPHS.CHECKING);
    case MERGE_STATE.CONFLICTS:
      return chip("Conflicts", STATUS_TONE.DANGER, CHIP_GLYPHS.HELD);
    case MERGE_STATE.BEHIND:
      return chip("Behind", STATUS_TONE.ATTENTION, CHIP_GLYPHS.BEHIND);
    case MERGE_STATE.BLOCKED:
      return blockedChip(merging);
    default:
      return action === undefined
        ? chip("Ready", STATUS_TONE.COMPLETE, CHIP_GLYPHS.READY)
        : undefined;
  }
}

/**
 * The chip: its glyph in its tone and its word, GitHub's sentence in its hint
 * and for a reader. Note that it is a static chip at the control's size, with
 * no edge, so it stands level with the presses beside it while reading as a
 * status rather than a press.
 */
function MergeChip({ face, sentence }: { face: ChipFace; sentence: string }): React.JSX.Element {
  return (
    <Tooltip label={sentence}>
      <span className="merge-chip inline-flex min-w-0">
        <StaticChip tone={face.tone} hideWordsUnder={VISUALLY_HIDDEN_UNDER.SNUG}>
          {face.icon}
          <ChipName>{face.label}</ChipName>
        </StaticChip>
        <VisuallyHidden>{`: ${sentence}`}</VisuallyHidden>
      </span>
    </Tooltip>
  );
}

/** The chevron's menu of the methods the repository allows, the one chosen checked. */
function methodItems(
  methods: readonly MergeMethod[],
  method: MergeMethod | undefined,
  busy: boolean,
  choose: (method: MergeMethod) => void,
): readonly MenuAction[] {
  return methods.map((each) => ({
    label: MERGE_METHOD_WORDS[each],
    checked: each === method,
    disabled: busy,
    onSelect: () => choose(each),
  }));
}

/** A press as `Button` takes it busy: the ring and what it is doing, while its own change is out. */
function busyProps(busyLabel: string | undefined) {
  return busyLabel === undefined ? {} : { busy: true, busyLabel };
}

/**
 * A press by the method chosen: a split button whose chevron opens the
 * methods the repository allows, the chosen one checked, where it allows
 * more than one; else the press alone.
 */
function MethodPress({
  variant,
  words,
  methods,
  method,
  busy,
  busyLabel,
  onChoose,
  onPress,
}: {
  variant: ButtonVariant;
  words: string;
  methods: readonly MergeMethod[];
  method: MergeMethod | undefined;
  /** Whether any change to the pull request is out. */
  busy: boolean;
  /** What the press says while its own change is out. */
  busyLabel: string | undefined;
  onChoose: (method: MergeMethod) => void;
  onPress: () => void;
}): React.JSX.Element {
  const menu = useMenu(methods.length > 1);
  const icon = variant === BUTTON_VARIANT.PRIMARY ? <GitMergeIcon aria-hidden="true" /> : undefined;
  if (methods.length < 2) {
    return (
      <Button
        variant={variant}
        icon={icon}
        disabled={busy && busyLabel === undefined}
        onClick={onPress}
        {...busyProps(busyLabel)}
      >
        {words}
      </Button>
    );
  }
  return (
    <>
      <SplitButton
        variant={variant}
        icon={icon}
        disabled={busy && busyLabel === undefined}
        onClick={onPress}
        {...busyProps(busyLabel)}
        menu={{ label: MERGE_WORDS.CHOOSE_METHOD, ...menu.trigger() }}
      >
        {words}
      </SplitButton>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          replayUnmasked
          label={MERGE_WORDS.CHOOSE_METHOD}
          menu={menu.drawn}
          groups={[methodItems(methods, method, busy, onChoose)]}
          onClose={menu.close}
        />
      )}
    </>
  );
}

/** The question Remove from queue asks first, as stage-cli's does. */
const DEQUEUE_QUESTION: DialogQuestion = {
  title: MERGE_WORDS.DEQUEUE_QUESTION,
  body: QUEUE_WARNING,
  verb: MERGE_WORDS.DEQUEUE,
  running: MERGE_BUSY_WORDS[PULL_REQUEST_ACTION.DEQUEUE],
  loss: CONFIRM_LOSS.AFFECTS_OTHERS,
  replayUnmasked: true,
};

/**
 * Where the merge stands, for an open pull request or a draft, as its
 * overview read it: the chip, which leads the title row's controls rather
 * than standing between them, so the presses stand together. Nothing for
 * one merged or closed, or where the chip has nothing to say.
 */
export function MergeStatus({
  pullRequest,
}: {
  pullRequest: AgentOverviewPullRequest;
}): React.JSX.Element | null {
  if (!isLivePullRequest(pullRequest)) return null;
  const action = mergeActionFor(pullRequest);
  const face = chipOf(pullRequest, action);
  if (face === undefined) return null;
  return <MergeChip face={face} sentence={mergeSentence(pullRequest, action)} />;
}

/**
 * The merge control for an open pull request or a draft, as its overview
 * read it: the press, and the question leaving the queue asks first; where
 * the merge stands is `MergeStatus`'s. Nothing for one merged or closed, or
 * where no press may be made.
 */
export function MergeControl({
  pullRequest,
  repository,
  shown,
  writes,
}: {
  pullRequest: AgentOverviewPullRequest;
  /** The agent's repository, which the method chosen is kept by. */
  repository: string | null;
  /** Whether the panel the control stands in is on screen; a question asked goes with it. */
  shown: boolean;
  writes: PullRequestWrites;
}): React.JSX.Element | null {
  const { merging } = pullRequest;
  const methods = merging?.methods ?? [];
  const [method, choose] = useMergeMethod(repository, methods);
  // Whether Remove from queue is being asked about; the question goes once a read finds it out of the queue, so it never asks to dequeue what no longer stands in it.
  const [asked, setAsked] = useState(false);
  const inQueue = (merging?.queued ?? null) !== null;
  const confirm = useConfirmDialog(
    { subject: asked && inQueue, surfaceOpen: shown },
    writes.confirmAct({ action: PULL_REQUEST_ACTION.DEQUEUE }),
    confirmFailure(FAILURE_SURFACE.PULL_REQUEST_DEQUEUE),
  );
  // Note that a question left behind as its panel hides is let go whole, so the panel comes back asking nothing; one already answered finishes.
  if ((!shown || !inQueue) && asked && !confirm.busy) setAsked(false);

  if (!isLivePullRequest(pullRequest)) return null;
  const action = mergeActionFor(pullRequest);
  const pending = isMergeWrite(writes.pending) ? writes.pending : undefined;
  const busy = writes.pending !== undefined;
  const headSha = merging?.headSha ?? "";
  const askDequeue = () => {
    setAsked(true);
    confirm.ask();
  };
  const busyAs = (write: MergeWrite) => (pending === write ? MERGE_BUSY_WORDS[write] : undefined);
  const plain = (variant: ButtonVariant, words: string, write: MergeWrite, onPress: () => void) => (
    <Button
      variant={variant}
      disabled={busy && busyAs(write) === undefined}
      onClick={onPress}
      {...busyProps(busyAs(write))}
    >
      {words}
    </Button>
  );
  const press = (): React.JSX.Element | null => {
    switch (action) {
      case MERGE_ACTION.MERGE:
        if (method === undefined) return null;
        return (
          <MethodPress
            variant={BUTTON_VARIANT.PRIMARY}
            words={MERGE_PRESS_WORDS[method]}
            methods={methods}
            method={method}
            busy={busy}
            busyLabel={busyAs(PULL_REQUEST_ACTION.MERGE)}
            onChoose={choose}
            onPress={() =>
              void writes.write({ action: PULL_REQUEST_ACTION.MERGE, method, headSha })
            }
          />
        );
      case MERGE_ACTION.ENABLE_AUTO_MERGE:
        if (method === undefined) return null;
        return (
          <MethodPress
            variant={BUTTON_VARIANT.OUTLINE}
            words={MERGE_WORDS.ENABLE_AUTO_MERGE}
            methods={methods}
            method={method}
            busy={busy}
            busyLabel={busyAs(PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE)}
            onChoose={choose}
            onPress={() =>
              void writes.write({ action: PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE, method, headSha })
            }
          />
        );
      case MERGE_ACTION.MERGE_WHEN_READY:
        return plain(
          BUTTON_VARIANT.PRIMARY,
          MERGE_WORDS.MERGE_WHEN_READY,
          PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE,
          () => void writes.write({ action: PULL_REQUEST_ACTION.ENABLE_AUTO_MERGE, headSha }),
        );
      case MERGE_ACTION.DISABLE_AUTO_MERGE:
        return plain(
          BUTTON_VARIANT.OUTLINE,
          MERGE_WORDS.DISABLE_AUTO_MERGE,
          PULL_REQUEST_ACTION.DISABLE_AUTO_MERGE,
          () => void writes.write({ action: PULL_REQUEST_ACTION.DISABLE_AUTO_MERGE }),
        );
      case MERGE_ACTION.DEQUEUE:
        return plain(BUTTON_VARIANT.OUTLINE, MERGE_WORDS.DEQUEUE, PULL_REQUEST_ACTION.DEQUEUE, () =>
          askDequeue(),
        );
      default:
        return null;
    }
  };
  const drawn = press();
  if (drawn === null && !asked) return null;
  return (
    <span className="merge-control flex min-h-control min-w-0 items-center gap-control-gap">
      {drawn}
      <ConfirmDialog open confirm={confirm} question={DEQUEUE_QUESTION} />
    </span>
  );
}
