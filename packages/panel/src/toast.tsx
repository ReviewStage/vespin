/**
 * toast.tsx -- the window's passing notices, as state: what stands, for how long, and what each tells whoever showed it; Base UI's toast manager keeps them, and `@repo/ui`'s `Toast`, `ToastStack`, and `ToastActions` draw them.
 *
 * A toast answers an act whose control is gone by the time it lands: a copy
 * made from a menu that closed with the press, a note sent from a dialog
 * that closed with the send, a task archived from a menu, or a change
 * refused where nothing beside it is left to say so. Beside those it says
 * only what is rare enough to be worth the interruption, as a new version
 * waiting on its restart or the app updated to one (`update-toast.ts`); what happened elsewhere, an agent's
 * turn ended, an Inbox item posted, or an automation's run that failed, is
 * said by the window's own marks and counts instead. Each is a
 * card of its words, an optional second line under them, each cut at two
 * lines, and at most one action, such as Undo, at its end, beside a failure's copy.
 *
 * Their life is Base UI's (`ToastStack`): up to three stand at once, newest
 * at the bottom, the ones past that waiting aside until there is room; and
 * each stands for its own hold, all of them paused while the pointer is
 * over the stack or focus is in it, and leaves by itself once it runs out.
 * What the newest says is said aloud through the window's two regions, a
 * polite one for what was done or is asked, and an alert for what was
 * refused. A toast about a `subject`
 * one standing already has takes that one's place rather than stacking a
 * twin above it. Only one whose action is the one way back to something the
 * developer would otherwise lose, such as words a save left unsaved,
 * persists until it is dismissed, and one with no action persists only
 * while what it says still stands, until whoever showed it withdraws it.
 * One saying work is under way (`useWorkingToast`) stands until the work
 * settles, then turns in place into what came of it, done or failed, and
 * stands for that one's hold, rather than leaving and another arriving. One
 * with an action may always be dismissed before then, since that is how the
 * developer reaches what it stands over: by its action, by the × it shows
 * over its top-left corner under the pointer or focus, as a Mac's own
 * notifications do, by Escape while focus is in it, by a sideways swipe, or
 * by whoever showed it withdrawing what it is about. One with no action is
 * never pointed at, so clicks pass through it. The stack always stands in
 * the window's bottom-right corner, over whatever docks at its foot, a
 * plan's call bar or an agent's composer; one with an action there can be
 * dismissed to reach End call or Send under it.
 *
 * A toast saying a failure carries the failure, which is reported as it is
 * shown (`failure-report.ts`), so no failure the panel says in a toast goes
 * unreported. One saying an unexpected failure offers the details of that
 * report to copy, by the window's copy button after its action, named "Copy
 * details", which answers on itself and leaves the toast and any action on
 * it standing, so a person can send them with a report of the problem. Its
 * glyph alone stands there, so the failure's words keep their room, and a
 * failure toast with nothing else to press takes the pointer for it, and so
 * may be dismissed. A refusal, whose words already say what happened, and a
 * window with nothing to report through offer no copy
 * (`reportShownFailure`). A failure that is not a refusal, shown while the
 * app does not reach the service, is reported and not shown at all, unless
 * it carries an action, because the Offline mark already says why
 * (`failureOfConnection`).
 *
 * The words are text like any other, so the session recording masks them
 * with the rest.
 */

import {
  createToastManager,
  type MarkProvider,
  STATUS_TONE,
  type StandingToast,
  TOAST_HOLD,
  Toast,
  ToastActions,
  type ToastCopy,
  ToastStack,
  type ToastTone,
} from "@repo/ui";
import { createStore, useSelector } from "@tanstack/react-store";
import { Duration } from "effect";
import { useEffect, useRef } from "react";
import { appPlatform } from "./app-platform.js";
import { failureOfConnection, reportShownFailure, type ShownFailure } from "./failure-report.js";

/** How long a toast stands, by what it reports: `@repo/ui`'s, which a copy button's check reads too. */
export { TOAST_HOLD };

/** What a failure toast's copy button copies, as "Copy details" names it. */
const DETAILS_WHAT = "details";

/** A toast's one action: its button's label, and what a press of it does; one that opens a page names it as `href`, so it is drawn as a link, and its press opens it through the window's door. */
interface ToastAction {
  readonly label: string;
  readonly href?: string | undefined;
  readonly onPress: () => void;
  /** Whether its label is the app's own word ("Undo", "Open"), which a screen recording shows as it reads. */
  readonly replayUnmasked?: boolean | undefined;
}

/**
 * A toast's tone, and, where it says a failure, the failure it says, which
 * is reported as the toast is shown (`failure-report.ts`): a failure toast
 * cannot be built without it, so none reaches a screen unreported.
 */
type ToastSaying =
  | { readonly tone: Exclude<ToastTone, typeof STATUS_TONE.DANGER>; readonly failure?: never }
  | { readonly tone: typeof STATUS_TONE.DANGER; readonly failure: ShownFailure };

/**
 * A toast to show: its words, an optional second line under them, and its
 * tone, and either how long it stands before it leaves or the action it
 * carries, with its own hold, the action's where it names none, or, where
 * it `persists`, none at all, standing until it is dismissed: kept for an
 * action that is the one way back to something the developer would
 * otherwise lose, or, with no action, for what stands only as long as
 * whoever showed it says so, which withdraws it by its `subject`. Its `subject` is what it
 * is about, by which whoever showed it may withdraw it once it is stale.
 * One of `STATUS_TONE.WORKING` has no hold and no action: it stands until the
 * work it says is under way settles it (`useWorkingToast`). One of
 * `STATUS_TONE.DANGER` carries the failure it says (`ToastSaying`).
 */
export type ToastNotice = {
  readonly words: string;
  /** The glyph it leads with in place of its tone's, where what it says has one of its own (`Toast`'s `glyph`). */
  readonly glyph?: () => React.JSX.Element;
  /** The provider whose mark it leads with, where it is about one of the account's connections (`Toast`'s `mark`). */
  readonly mark?: MarkProvider;
  readonly detail?: string;
  readonly subject?: string;
  /** Whether its words and detail are the app's own, which a screen recording shows as they read; one that quotes a name, a person's words, or a refusal's words leaves this off. */
  readonly replayUnmasked?: boolean | undefined;
  /** What the developer sending it away, by its × or Escape, tells whoever showed it, so a question they set aside can be asked again. */
  readonly onDismiss?: () => void;
  /**
   * What it tells whoever showed it once it is gone, however it went: its
   * hold run out, pushed out, dismissed, withdrawn, or its action pressed.
   * Note that it is told once the toast's exit is done, after its action's
   * press has run, so an act its Undo stands over goes only once that Undo
   * can no longer be pressed.
   */
  readonly onGone?: () => void;
} & ToastSaying &
  (
    | { readonly hold: Duration.Duration; readonly action?: never; readonly persists?: never }
    | { readonly action: ToastAction; readonly hold?: Duration.Duration; readonly persists?: never }
    | { readonly action: ToastAction; readonly persists: true; readonly hold?: never }
    | {
        readonly subject: string;
        readonly persists: true;
        readonly action?: never;
        readonly hold?: never;
      }
    | {
        readonly tone: typeof STATUS_TONE.WORKING;
        readonly hold?: never;
        readonly action?: never;
        readonly persists?: never;
      }
  );

/** A notice as the stack keeps it: one saying a failure with the details of its report a person may copy. */
type KeptNotice = ToastNotice & { readonly details?: string | undefined };

/** What each toast carries on Base UI's manager: the notice it says. */
interface ToastData {
  readonly notice: KeptNotice;
}

/** A toast the host keeps, by its id on the manager, from its showing until its exit is done: its notice, and whether it is on its way out. */
interface Kept {
  readonly notice: KeptNotice;
  readonly leaving: boolean;
}

/** What Base UI calls a toast with no hold of its own, whose hold starts once it settles: one saying work is under way. */
const WORKING_TYPE = "loading";

/** The tones said in the polite region: all but a refusal, which is an alert. */
const POLITE_TONES: ReadonlySet<ToastTone> = new Set([
  STATUS_TONE.COMPLETE,
  STATUS_TONE.ATTENTION,
  STATUS_TONE.WORKING,
]);

/** The tone said in the alert region: a refusal. */
const ALERT_TONES: ReadonlySet<ToastTone> = new Set([STATUS_TONE.DANGER]);

/** What the dismiss button is called, for whoever cannot see its ×. */
const DISMISS_LABEL = "Dismiss";

/** What the stack is called, as a landmark among the window's regions. */
const STACK_LABEL = "Notifications";

/** The window's toasts, as Base UI keeps them: whoever shows one adds it here, from inside React or out. */
const toastManager = createToastManager<ToastData>();

/** The toasts the host keeps, by id, which a withdrawal, a settling, and `useToastStanding` read. */
const keptStore = createStore<ReadonlyMap<string, Kept>>(new Map());

/** The toasts the host itself is closing, withdrawn or dismissed by their ×, whose close is told to no one as a dismissal. */
const closingByHost = new Set<string>();

/** The hold a notice stands for, in milliseconds: its own, the Undo hold where it carries an action and names none, or none (`0`) where it persists or says work is under way. */
function timeoutOf(notice: ToastNotice): number {
  if (notice.persists === true || notice.tone === STATUS_TONE.WORKING) return 0;
  return Duration.toMillis(notice.hold ?? TOAST_HOLD.UNDO);
}

/** Keeps `kept` for the toast `id`, or forgets it. */
function keep(id: string, kept: Kept | undefined): void {
  keptStore.setState((was) => {
    const next = new Map(was);
    if (kept === undefined) next.delete(id);
    else next.set(id, kept);
    return next;
  });
}

/** Marks the toast `id` on its way out, and tells whoever showed one that persists that the developer sent it away, where the host did not close it itself. */
function closed(id: string, notice: KeptNotice): void {
  const byHost = closingByHost.delete(id);
  if (keptStore.state.get(id)?.notice === notice) keep(id, { notice, leaving: true });
  if (!byHost && timeoutOf(notice) === 0) notice.onDismiss?.();
}

/** Forgets the toast `id` once its exit is done, and tells whoever showed it that it is gone. */
function removed(id: string, notice: KeptNotice): void {
  if (keptStore.state.get(id)?.notice === notice) keep(id, undefined);
  notice.onGone?.();
}

/** What Base UI is handed for a notice: its hold, whether it waits on work, the notice, and what its close and exit tell the host. */
function toastOptions(id: string, notice: KeptNotice) {
  return {
    timeout: timeoutOf(notice),
    type: notice.tone === STATUS_TONE.WORKING ? WORKING_TYPE : undefined,
    data: { notice },
    onClose: () => closed(id, notice),
    onRemove: () => removed(id, notice),
  };
}

/**
 * Keeps `notice` as the toast `id`, telling the one it replaces, if any,
 * that it is gone, since the manager turns that toast into this one in place
 * and never ends it.
 */
function replace(id: string, notice: KeptNotice): void {
  const was = keptStore.state.get(id);
  keep(id, { notice, leaving: false });
  if (was !== undefined && was.notice !== notice) was.notice.onGone?.();
}

/** Closes the toast `id` as the host's own act, which no one is told is a dismissal. */
function closeByHost(id: string): void {
  const kept = keptStore.state.get(id);
  if (kept === undefined || kept.leaving) return;
  closingByHost.add(id);
  toastManager.close(id);
}

/**
 * Reports the failure a notice says, where it says one, as it is shown or
 * a working toast turns into it, and answers the notice keeping the details
 * of that report to copy. A failure the connection already says
 * (`failureOfConnection`), on a notice with no action to lose, is reported
 * and not shown: it answers nothing.
 */
function reportSaid(notice: ToastNotice): KeptNotice | undefined {
  if (notice.tone !== STATUS_TONE.DANGER) return notice;
  const details = reportShownFailure(notice.failure, Date.now());
  if (notice.action === undefined && failureOfConnection(notice.failure)) return undefined;
  return { ...notice, details };
}

/**
 * Sends every toast standing or waiting away and forgets each one kept, so
 * none is shown again when a stack next stands. Note that the manager tells
 * each close at once, so none is told as a dismissal.
 */
export function forgetToasts(): void {
  for (const id of keptStore.state.keys()) closingByHost.add(id);
  toastManager.close();
  closingByHost.clear();
  keptStore.setState(() => new Map());
}

/**
 * Empties the stack as another account signs in, every toast standing or
 * waiting sent away, because what the last account was told is its own;
 * nothing on the window's first draw.
 */
export function useToastsOwner(account: string | undefined): void {
  const last = useRef(account);
  useEffect(() => {
    if (last.current === account) return;
    last.current = account;
    forgetToasts();
  }, [account]);
}

/**
 * Shows a toast from outside React: for a press whose answer lands after its
 * handler returned (`act.ts`'s `pressAct`). One about a `subject` already
 * standing takes that one's place in the stack rather than stacking beside it.
 */
export function showToast(notice: ToastNotice): void {
  const said = reportSaid(notice);
  if (said === undefined) return;
  const id = said.subject ?? crypto.randomUUID();
  replace(id, said);
  toastManager.add({ id, ...toastOptions(id, said) });
}

/** Shows a toast; the same function on every render. */
export function useToast(): (notice: ToastNotice) => void {
  return showToast;
}

/**
 * Shows a toast saying work is under way, with a spinner, and answers how to
 * settle it: the notice saying what came of the work, which the same card
 * turns into in place. Note that each call is its own subject, so two pieces
 * of work under way at once each settle their own card. The same function on
 * every render.
 */
export function useWorkingToast(): (words: string) => (notice: ToastNotice) => void {
  return showWorkingToast;
}

/**
 * The working toast about `subject` turned into `notice`, in place and for
 * that one's whole hold; where it no longer stands, as when it was sent
 * away, `notice` arrives anew. A failure the connection already says takes
 * the working toast away instead.
 */
function settleWork(subject: string, notice: ToastNotice): void {
  const said = reportSaid(notice);
  if (said === undefined) {
    closeByHost(subject);
    return;
  }
  const standing = keptStore.state.get(subject);
  if (standing === undefined || standing.leaving) {
    showToast(said);
    return;
  }
  replace(subject, said);
  toastManager.update(subject, toastOptions(subject, said));
}

/** Shows a toast saying work is under way, and answers how to settle it (`useWorkingToast`). */
function showWorkingToast(words: string): (notice: ToastNotice) => void {
  const subject = crypto.randomUUID();
  showToast({ words, tone: STATUS_TONE.WORKING, subject });
  return (notice: ToastNotice) => settleWork(subject, { ...notice, subject });
}

/** Withdraws every toast standing or waiting whose notice `about` picks. */
function withdrawWhere(about: (notice: ToastNotice) => boolean): void {
  for (const [id, kept] of keptStore.state) if (about(kept.notice)) closeByHost(id);
}

/** Withdraws every toast standing or waiting about `subject`, now stale; the same function on every render. */
export function useWithdrawToast(): (subject: string) => void {
  return withdrawToast;
}

/** Withdraws every toast standing or waiting about `subject` (`useWithdrawToast`), from outside React as `showToast` shows one. */
export function withdrawToast(subject: string): void {
  withdrawWhere((notice) => notice.subject === subject);
}

/** Withdraws every toast standing or waiting whose action runs `onPress`, once pressing it would do nothing: an Undo whose entry has left the undo stack (`undo-stack.ts`). */
export function withdrawToastActing(onPress: () => void): void {
  withdrawWhere((notice) => notice.action?.onPress === onPress);
}

/** Whether a toast about `subject` stands in sight, not on its way out; the same answer while the stack holds it. */
export function useToastStanding(subject: string): boolean {
  return useSelector(keptStore, (kept) =>
    [...kept.values()].some((toast) => !toast.leaving && toast.notice.subject === subject),
  );
}

/** Sends the toast `id` away by the developer's hand, its × or its action, telling whoever showed it once. */
function dismiss(id: string, notice: KeptNotice): void {
  const kept = keptStore.state.get(id);
  // Note that a toast on its way out still draws its controls, so only the first dismissal is told.
  if (kept === undefined || kept.leaving) return;
  closeByHost(id);
  notice.onDismiss?.();
}

/** What a toast says aloud: its words, then its second line. */
function spoken(notice: ToastNotice): string {
  return notice.detail === undefined ? notice.words : `${notice.words}. ${notice.detail}`;
}

/** What the newest toast of one of `tones` still standing says aloud, or nothing. */
function newestSaying(kept: ReadonlyMap<string, Kept>, tones: ReadonlySet<ToastTone>): string {
  const newest = [...kept.values()].findLast(
    (toast) => !toast.leaving && tones.has(toast.notice.tone),
  );
  return newest === undefined ? "" : spoken(newest.notice);
}

/** One toast the manager keeps: the ui card, its notice's words, and its action, copy, and ×. */
function ToastCard({ toast }: { toast: StandingToast<ToastData> }): React.JSX.Element | null {
  const notice = toast.data?.notice;
  if (notice === undefined) return null;
  const { action, details } = notice;
  const copy: ToastCopy | undefined =
    details === undefined
      ? undefined
      : { text: details, what: DETAILS_WHAT, copy: (text) => appPlatform().copyText(text) };
  const acts = action !== undefined || copy !== undefined;
  return (
    <Toast
      toast={toast}
      tone={notice.tone}
      glyph={notice.glyph}
      mark={notice.mark}
      words={notice.words}
      detail={notice.detail}
      replayUnmasked={notice.replayUnmasked}
      actions={
        !acts ? undefined : (
          <ToastActions
            {...(action === undefined
              ? {}
              : { label: action.label, href: action.href, onPress: action.onPress })}
            copy={copy}
            dismissLabel={DISMISS_LABEL}
            onDismiss={() => dismiss(toast.id, notice)}
            replayUnmasked={action?.replayUnmasked}
          />
        )
      }
    />
  );
}

/**
 * The toasts standing, in the window's bottom-right corner, and the regions
 * that say them, which the panel's other live words are said through too.
 * Mounted once, by the window's root, showing what was asked for before it
 * stood. Note that the toasts it kept go with it, so a window
 * that mounts it again never draws a stale one.
 */
export function ToastHost(): React.JSX.Element {
  const polite = useSelector(keptStore, (kept) => newestSaying(kept, POLITE_TONES));
  const alert = useSelector(keptStore, (kept) => newestSaying(kept, ALERT_TONES));
  useEffect(() => {
    // Note that the manager reaches the stack only once it stands, which is after its children's effects, so a toast a sibling showed as the window first drew is shown again here.
    for (const [id, kept] of keptStore.state) {
      if (!kept.leaving) toastManager.add({ id, ...toastOptions(id, kept.notice) });
    }
    return forgetToasts;
  }, []);
  return (
    <ToastStack manager={toastManager} label={STACK_LABEL} polite={polite} alert={alert}>
      {(toast) => <ToastCard key={toast.id} toast={toast} />}
    </ToastStack>
  );
}
